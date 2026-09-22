#!/usr/bin/env bash
#
# Legt eine Windows-VM auf Google Cloud an, auf der TikTok LIVE Studio laufen kann.
# Gedacht zum Einfuegen in die Google Cloud Shell (shell.cloud.google.com) --
# laeuft auch im Handy-Browser.
#
#   bash setup-gcp-vm.sh
#
# Alles ueber Umgebungsvariablen anpassbar, z.B.:
#   ZONE=europe-west4-a bash setup-gcp-vm.sh

set -euo pipefail

VM_NAME="${VM_NAME:-livestudio}"
ZONE="${ZONE:-europe-west3-a}"          # Frankfurt: kuerzeste Latenz nach DE
MACHINE_TYPE="${MACHINE_TYPE:-e2-standard-4}"   # 4 vCPU, 16 GB -- LIVE Studio will min. 8 GB
DISK_SIZE="${DISK_SIZE:-80GB}"
IMAGE_FAMILY="${IMAGE_FAMILY:-windows-2022}"
IMAGE_PROJECT="windows-cloud"
MAX_HOURS="${MAX_HOURS:-5}"             # Zwangs-Shutdown nach X Stunden Laufzeit

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mFEHLER: %s\033[0m\n' "$*" >&2; exit 1; }

PROJECT_ID="$(gcloud config get-value project 2>/dev/null || true)"
[ -n "$PROJECT_ID" ] && [ "$PROJECT_ID" != "(unset)" ] \
  || die "Kein Projekt gesetzt. Erst:  gcloud config set project DEIN-PROJEKT-ID"

say "Projekt: $PROJECT_ID | Zone: $ZONE | Typ: $MACHINE_TYPE"

say "Compute-API aktivieren (dauert beim ersten Mal ~1 Minute)"
gcloud services enable compute.googleapis.com --project "$PROJECT_ID"

if gcloud compute instances describe "$VM_NAME" --zone "$ZONE" >/dev/null 2>&1; then
  say "VM '$VM_NAME' existiert bereits -- ueberspringe das Anlegen"
else
  say "VM anlegen"
  gcloud compute instances create "$VM_NAME" \
    --zone "$ZONE" \
    --machine-type "$MACHINE_TYPE" \
    --image-family "$IMAGE_FAMILY" \
    --image-project "$IMAGE_PROJECT" \
    --boot-disk-size "$DISK_SIZE" \
    --boot-disk-type pd-balanced \
    --metadata "max-runtime-hours=${MAX_HOURS}" \
    --tags rdp-zugang \
    --labels zweck=livestream
fi

# RDP-Regel nur anlegen, wenn sie fehlt. Standard ist hier bewusst OFFEN (0.0.0.0/0),
# weil sich die Handy-IP staendig aendert -- siehe Sicherheitshinweis in der README.
if gcloud compute firewall-rules describe erlaube-rdp >/dev/null 2>&1; then
  say "Firewall-Regel 'erlaube-rdp' existiert bereits"
else
  say "Firewall fuer RDP (Port 3389) oeffnen"
  gcloud compute firewall-rules create erlaube-rdp \
    --allow tcp:3389 \
    --target-tags rdp-zugang \
    --description "RDP-Zugang zur Livestream-VM"
fi

say "Windows-Passwort erzeugen (bitte sofort notieren -- wird nur EINMAL angezeigt)"
gcloud compute reset-windows-password "$VM_NAME" --zone "$ZONE" --user streamer

IP="$(gcloud compute instances describe "$VM_NAME" --zone "$ZONE" \
      --format='get(networkInterfaces[0].accessConfigs[0].natIP)')"

cat <<FERTIG

==========================================================
  FERTIG

  RDP-Adresse : $IP
  Benutzer    : streamer
  Passwort    : siehe oben

  Vom Handy verbinden mit der App "Windows App" von Microsoft
  (frueher "Remote Desktop", gibt es fuer Android und iOS).

  WICHTIG -- Kosten:
    VM stoppen, sobald du fertig bist:
      gcloud compute instances stop $VM_NAME --zone $ZONE

    Wieder starten:
      gcloud compute instances start $VM_NAME --zone $ZONE

    Eine laufende VM frisst dein 300-Dollar-Guthaben in ~25 Tagen.
    Gestoppt kostet nur die Festplatte (~8 Dollar im Monat).
==========================================================

FERTIG
