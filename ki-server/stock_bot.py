#!/usr/bin/env python3
"""Stock-Automat: erzeugt Stockfotos mit lokaler KI und lädt sie zu Adobe Stock hoch.

Ablauf pro Durchgang:
  1. Text-KI (Ollama) denkt sich ein gefragtes Motiv aus -> Prompt, Titel, Stichwörter
  2. Bild-KI (Stable Diffusion XL, lokal auf der CPU) erzeugt das Bild
  3. Bild wird auf >= 4 Megapixel hochskaliert (Adobe-Mindestgröße)
  4. Titel + Stichwörter werden in die JPG-Datei geschrieben (IPTC/XMP)
  5. Upload per SFTP zu Adobe Stock

Läuft als Dauerschleife (systemd-Dienst). Einstellungen stehen in config.env.
"""

import json
import logging
import os
import random
import subprocess
import sys
import time
import urllib.request
from datetime import date
from pathlib import Path

BASE = Path(__file__).resolve().parent
DATA = BASE / "data"
PENDING = DATA / "pending"
UPLOADED = DATA / "uploaded"
STATE_FILE = DATA / "state.json"

log = logging.getLogger("stock-bot")

# Themen, die auf Stock-Plattformen gut laufen und die SDXL zuverlässig kann
# (keine Gesichter/Hände im Vordergrund, keine Marken).
THEMES = [
    "food and drinks", "healthy food flat lay", "abstract backgrounds", "textures and patterns",
    "nature landscapes", "flowers and plants", "home interior", "office workspace without people",
    "technology concepts", "business concepts with objects", "seasonal holidays decorations",
    "travel destinations without people", "animals and pets", "science and medicine objects",
    "sustainability and environment", "architecture", "sports equipment", "minimalist still life",
    "copy space backgrounds", "finance and money concepts",
]

# Adobe-Stock-Kategorien (Nummern laut Adobe-CSV-Format)
CATEGORIES = {
    1: "Animals", 2: "Buildings and Architecture", 3: "Business", 4: "Drinks",
    5: "The Environment", 6: "States of Mind", 7: "Food", 8: "Graphic Resources",
    9: "Hobbies and Leisure", 10: "Industry", 11: "Landscapes", 12: "Lifestyle",
    13: "People", 14: "Plants and Flowers", 15: "Culture and Religion", 16: "Science",
    17: "Social Issues", 18: "Sports", 19: "Technology", 20: "Transport", 21: "Travel",
}

NEGATIVE_PROMPT = (
    "text, watermark, logo, signature, letters, words, brand, trademark, blurry, lowres, "
    "jpeg artifacts, deformed, distorted, extra fingers, bad hands, bad anatomy, ugly, "
    "oversaturated, cartoon, frame, border"
)

BANNED_WORDS = {"ai", "generative", "midjourney", "stable diffusion", "sdxl", "photo", "image",
                "stock", "nike", "apple", "coca-cola", "disney", "iphone"}


# --------------------------------------------------------------------------- Konfiguration

def load_config():
    cfg = {
        "OLLAMA_URL": "http://127.0.0.1:11434",
        "OLLAMA_MODEL": "qwen2.5:3b",
        "SD_MODEL": "stabilityai/stable-diffusion-xl-base-1.0",
        "SD_STEPS": "25",
        "IMAGES_PER_DAY": "15",
        "UPLOAD_ENABLED": "false",
        "ADOBE_SFTP_HOST": "sftp.contributor.adobestock.com",
        "ADOBE_SFTP_USER": "",
        "ADOBE_SFTP_PASSWORD": "",
        "TELEGRAM_BOT_TOKEN": "",
        "TELEGRAM_CHAT_ID": "",
        "NOTIFY_EVERY": "20",
    }
    env_file = BASE / "config.env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            cfg[key.strip()] = value.strip().strip('"').strip("'")
    for key in cfg:
        if key in os.environ:
            cfg[key] = os.environ[key]
    return cfg


def load_state():
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    return {"day": "", "made_today": 0, "recent_titles": [], "uploaded_total": 0,
            "uploaded_since_notify": 0}


def save_state(state):
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(STATE_FILE)


# --------------------------------------------------------------------------- Text-KI

def ask_ollama(cfg, prompt):
    body = json.dumps({
        "model": cfg["OLLAMA_MODEL"],
        "prompt": prompt,
        "stream": False,
        "format": "json",
        "options": {"temperature": 0.9},
    }).encode()
    req = urllib.request.Request(cfg["OLLAMA_URL"] + "/api/generate", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as resp:
        return json.loads(json.loads(resp.read())["response"])


def clean_keywords(raw):
    seen, result = set(), []
    for kw in raw:
        kw = str(kw).strip().lower()
        if not kw or kw in seen or len(kw) > 40:
            continue
        if any(bad == kw or bad in kw.split() for bad in BANNED_WORDS):
            continue
        seen.add(kw)
        result.append(kw)
    return result[:45]


def make_idea(cfg, state):
    theme = random.choice(THEMES)
    recent = "; ".join(state["recent_titles"][-40:]) or "none"
    prompt = f"""You are an expert Adobe Stock contributor. Invent ONE commercially useful stock photo
in the theme "{theme}" that designers, bloggers and marketers often search for.
It must NOT show brands, logos, text, famous people or copyrighted characters.
Avoid people's faces and hands in close-up. It must be clearly different from these recent ones: {recent}

Answer ONLY with JSON in exactly this form:
{{
  "prompt": "detailed English prompt for a photorealistic image generator (subject, setting, lighting, camera, composition, 'professional stock photography')",
  "title": "descriptive English title, 5-15 words, no brand names",
  "keywords": ["30 to 45 relevant English single words or short phrases, most important first"],
  "category": <number 1-21 from this list: {json.dumps(CATEGORIES)}>
}}"""
    for attempt in range(3):
        try:
            idea = ask_ollama(cfg, prompt)
            idea["keywords"] = clean_keywords(idea.get("keywords", []))
            idea["title"] = str(idea.get("title", "")).strip()[:190]
            idea["category"] = int(idea.get("category", 8))
            if idea["category"] not in CATEGORIES:
                idea["category"] = 8
            if idea.get("prompt") and idea["title"] and len(idea["keywords"]) >= 15:
                return idea
            log.warning("Unbrauchbare Idee (Versuch %d): %s", attempt + 1, idea)
        except Exception as exc:  # Ollama kurz weg, kaputtes JSON, ...
            log.warning("Ideen-Fehler (Versuch %d): %s", attempt + 1, exc)
            time.sleep(10)
    return None


# --------------------------------------------------------------------------- Bild-KI

_pipe = None


def get_pipeline(cfg):
    global _pipe
    if _pipe is None:
        import torch
        from diffusers import StableDiffusionXLPipeline

        torch.set_num_threads(os.cpu_count() or 4)
        log.info("Lade Bildmodell %s (beim ersten Mal ca. 7 GB Download) ...", cfg["SD_MODEL"])
        _pipe = StableDiffusionXLPipeline.from_pretrained(
            cfg["SD_MODEL"], torch_dtype=torch.float32, use_safetensors=True, variant="fp16")
        _pipe.to("cpu")
        _pipe.set_progress_bar_config(disable=True)
    return _pipe


def make_image(cfg, idea):
    pipe = get_pipeline(cfg)
    width, height = random.choice([(1024, 1024), (1216, 832), (832, 1216), (1152, 896)])
    image = pipe(
        prompt=idea["prompt"],
        negative_prompt=NEGATIVE_PROMPT,
        num_inference_steps=int(cfg["SD_STEPS"]),
        guidance_scale=7.0,
        width=width,
        height=height,
    ).images[0]
    return upscale_to_min_megapixels(image, 4.2)


def upscale_to_min_megapixels(image, megapixels):
    from PIL import Image, ImageFilter

    w, h = image.size
    factor = max(1.0, (megapixels * 1_000_000 / (w * h)) ** 0.5)
    if factor > 1.0:
        image = image.resize((round(w * factor), round(h * factor)), Image.LANCZOS)
        image = image.filter(ImageFilter.UnsharpMask(radius=1.2, percent=60, threshold=2))
    return image


# --------------------------------------------------------------------------- Metadaten

def write_metadata(path, idea):
    args = ["exiftool", "-overwrite_original", "-q", "-codedcharacterset=utf8",
            f"-XMP-dc:Title={idea['title']}", f"-IPTC:ObjectName={idea['title'][:64]}",
            f"-IPTC:Caption-Abstract={idea['title']}", f"-XMP-dc:Description={idea['title']}"]
    for kw in idea["keywords"]:
        args += [f"-IPTC:Keywords={kw}", f"-XMP-dc:Subject={kw}"]
    args.append(str(path))
    subprocess.run(args, check=True)


def append_csv(path, idea):
    """Zusätzlich eine CSV im Adobe-Format (Backup, falls man sie im Portal hochladen will)."""
    import csv

    csv_path = DATA / "adobe_metadata.csv"
    new = not csv_path.exists()
    with csv_path.open("a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        if new:
            writer.writerow(["Filename", "Title", "Keywords", "Category", "Releases"])
        writer.writerow([path.name, idea["title"], ", ".join(idea["keywords"]), idea["category"], ""])


# --------------------------------------------------------------------------- Upload

def upload_pending(cfg, state):
    files = sorted(PENDING.glob("*.jpg"))
    if not files:
        return
    if cfg["UPLOAD_ENABLED"].lower() != "true" or not cfg["ADOBE_SFTP_USER"]:
        log.info("%d Bilder warten in %s (Upload ist ausgeschaltet)", len(files), PENDING)
        return

    import paramiko

    transport = paramiko.Transport((cfg["ADOBE_SFTP_HOST"], 22))
    try:
        transport.connect(username=cfg["ADOBE_SFTP_USER"], password=cfg["ADOBE_SFTP_PASSWORD"])
        sftp = paramiko.SFTPClient.from_transport(transport)
        for f in files:
            sftp.put(str(f), f.name)
            f.rename(UPLOADED / f.name)
            state["uploaded_total"] += 1
            state["uploaded_since_notify"] += 1
            log.info("Hochgeladen: %s", f.name)
        sftp.close()
    finally:
        transport.close()

    save_state(state)
    if state["uploaded_since_notify"] >= int(cfg["NOTIFY_EVERY"]):
        notify(cfg, f"📸 {state['uploaded_since_notify']} neue Bilder liegen bei Adobe Stock bereit.\n"
                    "Bitte im Portal (contributor.stock.adobe.com) alle markieren, "
                    "'Mit generativer KI erstellt' anhaken und einreichen.")
        state["uploaded_since_notify"] = 0
        save_state(state)


def notify(cfg, text):
    if not cfg["TELEGRAM_BOT_TOKEN"] or not cfg["TELEGRAM_CHAT_ID"]:
        return
    url = f"https://api.telegram.org/bot{cfg['TELEGRAM_BOT_TOKEN']}/sendMessage"
    body = json.dumps({"chat_id": cfg["TELEGRAM_CHAT_ID"], "text": text}).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=30).read()
    except Exception as exc:
        log.warning("Telegram-Nachricht fehlgeschlagen: %s", exc)


# --------------------------------------------------------------------------- Hauptschleife

def one_round(cfg, state):
    today = date.today().isoformat()
    if state["day"] != today:
        state["day"], state["made_today"] = today, 0
        save_state(state)

    if state["made_today"] >= int(cfg["IMAGES_PER_DAY"]):
        return False

    idea = make_idea(cfg, state)
    if not idea:
        return False
    log.info("Neues Motiv: %s", idea["title"])

    started = time.time()
    image = make_image(cfg, idea)
    name = f"{today}_{int(time.time())}.jpg"
    path = PENDING / name
    image.convert("RGB").save(path, "JPEG", quality=95)
    write_metadata(path, idea)
    append_csv(path, idea)
    log.info("Bild fertig in %.0f s: %s (%dx%d)", time.time() - started, name, *image.size)

    state["made_today"] += 1
    state["recent_titles"] = (state["recent_titles"] + [idea["title"]])[-100:]
    save_state(state)
    return True


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                        stream=sys.stdout)
    for d in (PENDING, UPLOADED):
        d.mkdir(parents=True, exist_ok=True)

    cfg = load_config()
    state = load_state()
    once = "--once" in sys.argv

    while True:
        made = False
        try:
            made = one_round(cfg, state)
            upload_pending(cfg, state)
        except Exception:
            log.exception("Fehler im Durchgang, versuche es später erneut")
            time.sleep(300)
        if once:
            break
        if not made:
            time.sleep(1800)  # Tageslimit erreicht oder Fehler -> in 30 min wieder schauen


if __name__ == "__main__":
    main()
