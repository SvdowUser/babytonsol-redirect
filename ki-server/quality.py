"""Qualitätskontrolle für den Stock-Automaten.

Jedes Bild durchläuft drei Prüfungen:
  1. Ästhetik-Score  – LAION-Ästhetikmodell auf CLIP ViT-L/14 (1–10, wie "schön" ein Bild wirkt)
  2. Passt zum Titel – CLIP vergleicht Bild und Beschreibung
  3. Bild-KI-Gutachter – ein Vision-Modell (Ollama) sucht Fehler: verzerrte Dinge, Hände,
     Schrift/Logos, unnatürliche Details, und bewertet den Verkaufswert
Dazu ein Duplikat-Check gegen die zuletzt behaltenen Bilder.
"""

import base64
import io
import json
import logging
import urllib.request
from pathlib import Path

log = logging.getLogger("stock-bot")

CLIP_MODEL = "openai/clip-vit-large-patch14"
# LAION "improved aesthetic predictor" (sac+logos+ava1-l14-linearMSE), gespiegelt auf Hugging Face
AESTHETIC_REPO, AESTHETIC_FILE = "trl-lib/ddpo-aesthetic-predictor", "aesthetic-model.pth"

REVIEW_PROMPT = """You are a strict Adobe Stock reviewer. Look at this image very carefully.
It is supposed to show: "{title}"

Check for: distorted or melted objects, wrong anatomy (hands, fingers, faces, animals),
any visible text, letters, numbers, logos or watermarks, blurry or noisy areas,
unnatural lighting, objects floating or merging into each other, anything that looks fake.

Answer ONLY with JSON:
{{
  "defects": ["list every problem you see, empty if none"],
  "has_text_or_logo": true or false,
  "matches_description": true or false,
  "technical_quality": <1-10, 10 = flawless professional photo>,
  "commercial_value": <1-10, how likely a designer or company would buy this>
}}"""


class QualityChecker:
    def __init__(self, cfg, models_dir: Path, memory_file: Path):
        self.cfg = cfg
        self.models_dir = models_dir
        self.memory_file = memory_file
        self._clip = None
        self._memory = None

    # ----------------------------------------------------------------- Modelle laden

    def _load(self):
        if self._clip is not None:
            return
        import torch
        from torch import nn
        from transformers import CLIPModel, CLIPProcessor

        log.info("Lade Qualitätsmodelle (CLIP + Ästhetik) ...")
        model = CLIPModel.from_pretrained(CLIP_MODEL).eval()
        processor = CLIPProcessor.from_pretrained(CLIP_MODEL)

        from huggingface_hub import hf_hub_download

        weights = hf_hub_download(AESTHETIC_REPO, AESTHETIC_FILE)
        mlp = nn.Sequential(
            nn.Linear(768, 1024), nn.Dropout(0.2), nn.Linear(1024, 128), nn.Dropout(0.2),
            nn.Linear(128, 64), nn.Dropout(0.1), nn.Linear(64, 16), nn.Linear(16, 1))
        state = torch.load(weights, map_location="cpu")
        mlp.load_state_dict({k.replace("layers.", ""): v for k, v in state.items()})
        mlp.eval()
        self._clip = (torch, model, processor, mlp)

    def _embed(self, image, text):
        torch, model, processor, _ = self._clip
        with torch.no_grad():
            img = model.get_image_features(**processor(images=image, return_tensors="pt"))
            txt = model.get_text_features(**processor(text=[text], return_tensors="pt",
                                                      padding=True, truncation=True))
        # transformers >= 5 liefert ein Ausgabe-Objekt statt direkt den Tensor
        img = getattr(img, "pooler_output", img)
        txt = getattr(txt, "pooler_output", txt)
        img = img / img.norm(dim=-1, keepdim=True)
        txt = txt / txt.norm(dim=-1, keepdim=True)
        return img, txt

    # ----------------------------------------------------------------- Duplikate

    def _load_memory(self):
        if self._memory is None:
            torch = self._clip[0]
            self._memory = torch.load(self.memory_file) if self.memory_file.exists() else None
        return self._memory

    def is_duplicate(self, emb, threshold=0.93):
        memory = self._load_memory()
        if memory is None or len(memory) == 0:
            return False
        return float((memory @ emb.T).max()) >= threshold

    def remember(self, emb, keep=500):
        torch = self._clip[0]
        memory = self._load_memory()
        memory = emb if memory is None else torch.cat([memory, emb])[-keep:]
        self._memory = memory
        torch.save(memory, self.memory_file)

    # ----------------------------------------------------------------- Bild-KI-Gutachter

    def _vision_review(self, image, title):
        small = image.copy()
        small.thumbnail((1024, 1024))
        buf = io.BytesIO()
        small.convert("RGB").save(buf, "JPEG", quality=90)
        body = json.dumps({
            "model": self.cfg["VISION_MODEL"],
            "prompt": REVIEW_PROMPT.format(title=title),
            "images": [base64.b64encode(buf.getvalue()).decode()],
            "stream": False,
            "format": "json",
            "options": {"temperature": 0.1},
        }).encode()
        req = urllib.request.Request(self.cfg["OLLAMA_URL"] + "/api/generate", data=body,
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=900) as resp:
            return json.loads(json.loads(resp.read())["response"])

    # ----------------------------------------------------------------- Gesamturteil

    def evaluate(self, image, idea):
        """Gibt (bestanden, punktzahl, details, embedding) zurück."""
        self._load()
        torch, _, _, mlp = self._clip
        emb, txt = self._embed(image, idea["title"])
        with torch.no_grad():
            aesthetic = float(mlp(emb))
        clip_match = float((emb @ txt.T)) * 100

        details = {"aesthetic": round(aesthetic, 2), "clip_match": round(clip_match, 1)}
        reasons = []
        if aesthetic < float(self.cfg["MIN_AESTHETIC"]):
            reasons.append(f"Ästhetik zu niedrig ({aesthetic:.2f})")
        if clip_match < float(self.cfg["MIN_CLIP_MATCH"]):
            reasons.append(f"passt nicht zum Titel ({clip_match:.1f})")
        if self.is_duplicate(emb):
            reasons.append("zu ähnlich zu einem früheren Bild")

        # Den (langsamen) Gutachter nur fragen, wenn die schnellen Tests bestanden sind
        review = {}
        if not reasons:
            try:
                review = self._vision_review(image, idea["title"])
            except Exception as exc:
                log.warning("Bild-Gutachter nicht erreichbar: %s", exc)
                reasons.append("Gutachter-Fehler")
            else:
                tech = float(review.get("technical_quality", 0))
                value = float(review.get("commercial_value", 0))
                details.update(technical=tech, commercial=value,
                               defects=review.get("defects", [])[:5])
                if review.get("has_text_or_logo"):
                    reasons.append("Schrift/Logo im Bild")
                if review.get("matches_description") is False:
                    reasons.append("zeigt nicht das Motiv")
                if tech < float(self.cfg["MIN_TECH_SCORE"]):
                    reasons.append(f"technische Mängel ({tech:.0f}/10)")
                if value < float(self.cfg["MIN_COMMERCIAL_SCORE"]):
                    reasons.append(f"geringer Verkaufswert ({value:.0f}/10)")

        details["reasons"] = reasons
        score = aesthetic + clip_match / 10 + float(review.get("technical_quality", 0)) \
            + float(review.get("commercial_value", 0))
        return not reasons, score, details, emb
