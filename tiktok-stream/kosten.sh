#!/usr/bin/env bash
#
# Wie lange reicht das 300-Dollar-Guthaben von Google Cloud?
#
#   bash kosten.sh              # Standard: 4 Stunden Stream pro Tag
#   bash kosten.sh 24           # Dauerbetrieb
#   bash kosten.sh 3 2.5        # 3 h/Tag bei 2,5 Mbit/s
#
# Alle Preise sind Schaetzwerte fuer europe-west3 (Frankfurt), Stand 2026.
# Vor dem Anlegen bitte im Google-Preisrechner gegenpruefen -- Preise aendern sich.

set -euo pipefail

STUNDEN_PRO_TAG="${1:-4}"
MBIT="${2:-3}"

GUTHABEN=300          # Dollar
TAGE_FENSTER=90       # Gueltigkeit des Guthabens

PREIS_VM=0.16         # e2-standard-4, Dollar pro Stunde
PREIS_LIZENZ=0.16     # Windows Server: 0,04 pro vCPU und Stunde, 4 vCPU
PREIS_DISK=8.00       # 80 GB pd-balanced, Dollar pro Monat -- faellt auch bei
                      # GESTOPPTER VM an, das ist der haeufigste Kostenirrtum
PREIS_EGRESS=0.12     # Dollar pro GB ausgehendem Traffic

awk -v h="$STUNDEN_PRO_TAG" -v mbit="$MBIT" -v guthaben="$GUTHABEN" \
    -v fenster="$TAGE_FENSTER" -v p_vm="$PREIS_VM" -v p_lic="$PREIS_LIZENZ" \
    -v p_disk="$PREIS_DISK" -v p_eg="$PREIS_EGRESS" '
BEGIN {
    std_monat = h * 30
    gb_pro_std = mbit / 8 * 3600 / 1024      # Mbit/s -> GB pro Stunde
    egress_gb  = gb_pro_std * std_monat

    vm     = std_monat * p_vm
    lizenz = std_monat * p_lic
    egress = egress_gb * p_eg
    monat  = vm + lizenz + p_disk + egress
    tag    = monat / 30

    printf "\n  Annahme: %.1f Stunden Stream pro Tag bei %.1f Mbit/s\n", h, mbit
    printf "  ------------------------------------------------------\n"
    printf "  VM (e2-standard-4)      %7.2f $/Monat\n", vm
    printf "  Windows-Lizenz          %7.2f $/Monat\n", lizenz
    printf "  Festplatte (immer!)     %7.2f $/Monat\n", p_disk
    printf "  Traffic (%6.0f GB)      %7.2f $/Monat\n", egress_gb, egress
    printf "  ------------------------------------------------------\n"
    printf "  Summe                   %7.2f $/Monat  (%.2f $/Tag)\n\n", monat, tag

    reicht = guthaben / tag
    printf "  %d $ Guthaben reichen fuer %.0f Tage.\n", guthaben, reicht

    if (reicht >= fenster) {
        printf "  -> Das Guthaben ueberdauert die %d Tage. Passt.\n\n", fenster
    } else {
        printf "  -> ACHTUNG: Guthaben ist nach %.0f von %d Tagen weg.\n", reicht, fenster
        printf "     Weniger Stunden pro Tag oder niedrigere Bitrate waehlen.\n\n"
    }
}'
