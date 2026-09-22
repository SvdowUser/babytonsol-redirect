#!/usr/bin/env bash
# Optional: Storj-Speicherknoten – vermietet freien Speicher, zahlt in STORJ-Token.
# Realistisch nur Cent-Beträge im Monat. Voraussetzungen siehe README (Abschnitt Storj).
# Aufruf:  bash storj-setup.sh <WALLET-ADRESSE> <E-MAIL> <SPEICHER, z.B. 100GB>
set -euo pipefail

WALLET="${1:?Wallet-Adresse fehlt}"
EMAIL="${2:?E-Mail fehlt}"
STORAGE="${3:-100GB}"
IP="$(curl -fsS https://api.ipify.org)"
BASE="$HOME/storj"
mkdir -p "$BASE/identity" "$BASE/data"

echo "==> Docker installieren"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
fi

echo "==> Port 28967 in der Server-Firewall öffnen"
sudo iptables -I INPUT -p tcp --dport 28967 -j ACCEPT
sudo iptables -I INPUT -p udp --dport 28967 -j ACCEPT
sudo apt-get install -y iptables-persistent && sudo netfilter-persistent save

ID_DIR="$BASE/identity/storagenode"
ID_BIN="$BASE/identity-bin"
if [ ! -x "$ID_BIN" ]; then
  ARCH="$(uname -m)"; [ "$ARCH" = "aarch64" ] && ARCH=arm64 || ARCH=amd64
  sudo apt-get install -y unzip
  curl -fsSL "https://github.com/storj/storj/releases/latest/download/identity_linux_${ARCH}.zip" -o /tmp/identity.zip
  unzip -o /tmp/identity.zip -d /tmp && mv /tmp/identity "$ID_BIN" && chmod +x "$ID_BIN"
fi
if [ ! -f "$ID_DIR/identity.cert" ]; then
  echo "==> Storj-Identität erzeugen (kann mehrere Stunden dauern!)"
  "$ID_BIN" create storagenode --identity-dir "$BASE/identity"
fi
if [ "$(grep -c BEGIN "$ID_DIR/ca.cert")" -lt 2 ]; then
  echo "Identität ist noch nicht autorisiert. Token von https://www.storj.io/host-a-node holen, dann:"
  echo "  $ID_BIN authorize storagenode <DEIN-TOKEN> --identity-dir $BASE/identity"
  echo "Danach dieses Skript erneut starten."
  exit 0
fi

echo "==> Knoten einmalig einrichten und starten"
if [ ! -f "$BASE/data/config.yaml" ]; then
  sudo docker run --rm -e SETUP="true" \
    --mount type=bind,source="$BASE/identity/storagenode",destination=/app/identity \
    --mount type=bind,source="$BASE/data",destination=/app/config \
    storjlabs/storagenode:latest
fi
sudo docker run -d --restart unless-stopped --stop-timeout 300 \
  -p 28967:28967/tcp -p 28967:28967/udp -p 127.0.0.1:14002:14002 \
  -e WALLET="$WALLET" -e EMAIL="$EMAIL" -e ADDRESS="$IP:28967" -e STORAGE="$STORAGE" \
  --mount type=bind,source="$BASE/identity/storagenode",destination=/app/identity \
  --mount type=bind,source="$BASE/data",destination=/app/config \
  --name storagenode storjlabs/storagenode:latest

echo "Storj-Knoten läuft. Dashboard (per SSH-Tunnel): http://127.0.0.1:14002"
