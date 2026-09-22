#!/usr/bin/env bash
# Einrichtung des Stock-Automaten auf einem Oracle-Cloud-Server (Ubuntu, Ampere A1 / ARM).
# Aufruf im Ordner ki-server:   bash setup.sh
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
USER_NAME="$(whoami)"

echo "==> System-Pakete installieren"
sudo apt-get update
sudo apt-get install -y python3-venv python3-pip libimage-exiftool-perl git curl

echo "==> Auslagerungsspeicher (8 GB) als Sicherheitspuffer"
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 8G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo "==> Text-KI (Ollama) installieren"
if ! command -v ollama >/dev/null; then
  curl -fsSL https://ollama.com/install.sh | sh
fi
sudo systemctl enable --now ollama
MODEL="$(grep -E '^OLLAMA_MODEL=' "$DIR/config.env" 2>/dev/null | cut -d= -f2)"
ollama pull "${MODEL:-qwen2.5:3b}"

echo "==> Python-Umgebung mit Bild-KI installieren (dauert ein paar Minuten)"
python3 -m venv "$DIR/venv"
"$DIR/venv/bin/pip" install --upgrade pip
"$DIR/venv/bin/pip" install -r "$DIR/requirements.txt"

if [ ! -f "$DIR/config.env" ]; then
  cp "$DIR/config.example.env" "$DIR/config.env"
  echo "==> config.env angelegt – trag dort später deine Adobe-Daten ein."
fi

echo "==> Dienst einrichten (startet automatisch, auch nach Neustart)"
sed -e "s#__DIR__#$DIR#g" -e "s#__USER__#$USER_NAME#g" "$DIR/stock-bot.service" \
  | sudo tee /etc/systemd/system/stock-bot.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now stock-bot

echo
echo "Fertig! Der Automat läuft jetzt."
echo "  Live zuschauen:     journalctl -u stock-bot -f"
echo "  Fertige Bilder:     $DIR/data/pending/"
echo "  Einstellungen:      nano $DIR/config.env   (danach: sudo systemctl restart stock-bot)"
