# TikTok-Livestream über eine Google-Cloud-Windows-VM

Setup für einen interaktiven TikTok-LIVE-Game-Stream ohne eigenen PC — vom Handy
aus gesteuert, finanziert aus dem 300-$-Startguthaben von Google Cloud.

## Warum dieser Weg

TikTok LIVE Studio braucht **keinen Stream-Key** — es meldet sich direkt mit dem
TikTok-Konto an. Das umgeht die größte Hürde: TikTok vergibt RTMP-Stream-Keys nach
eigenem Ermessen, viele berechtigte Konten bekommen nie einen.

Der Preis dafür: LIVE Studio läuft nur unter Windows und verlangt 4 Kerne und
8 GB RAM. Deshalb die Cloud-VM.

## Was hier drin liegt

| Datei | Zweck |
|---|---|
| `setup-gcp-vm.sh` | Legt die Windows-VM an. Läuft in der Google Cloud Shell, auch im Handy-Browser. |
| `kostenwaechter.ps1` | Fährt die VM automatisch herunter, damit das Guthaben nicht verbrennt. |
| `kosten.sh` | Rechnet aus, wie lange 300 $ bei deiner Nutzung reichen. |

## Die Kostenfalle — bitte zuerst lesen

Das Guthaben sind 300 $ mit **90 Tagen Gültigkeit**. Ob es reicht, entscheidet
einzig, ob die VM läuft, wenn du nicht streamst:

| Nutzung | Kosten | Guthaben reicht |
|---|---|---|
| 4 h/Tag, VM sonst gestoppt | ~65 $/Monat | **138 Tage** ✅ |
| Dauerbetrieb 24/7 | ~352 $/Monat | 26 Tage ❌ |

```bash
bash kosten.sh        # 4 h/Tag
bash kosten.sh 24     # Dauerbetrieb
bash kosten.sh 3 2.5  # 3 h/Tag bei 2,5 Mbit/s
```

Zwei Kostenposten werden fast immer übersehen:

- **Traffic kostet.** Google berechnet ausgehenden Datenverkehr (~0,12 $/GB).
  Bei Dauerbetrieb sind das allein ~114 $/Monat. Oracle hat 10 TB frei — Google nicht.
- **Die Festplatte kostet auch bei gestoppter VM** (~8 $/Monat). Nur das
  *Löschen* der VM beendet diese Kosten.

Deshalb der `kostenwaechter.ps1`: harte Obergrenze nach X Stunden Laufzeit plus
Shutdown nach 20 Minuten ohne RDP-Verbindung.

## Einrichtung

### 1. Google-Cloud-Konto (am Handy)

1. [console.cloud.google.com](https://console.cloud.google.com) → Konto anlegen,
   300 $ Guthaben aktivieren (Kreditkarte zur Verifizierung nötig, wird nicht belastet)
2. Neues Projekt anlegen, Projekt-ID notieren
3. **Wichtig:** Abrechnungskonto NICHT auf ein Bezahlkonto hochstufen. Solange du
   im Guthaben bleibst, wird nichts abgebucht.

### 2. Budget-Alarm setzen

Bevor irgendwas läuft. Billing → Budgets & alerts → Budget über 300 $, Alarm bei
50 %, 90 %, 100 %. Das ist dein Sicherheitsnetz.

### 3. VM anlegen

[shell.cloud.google.com](https://shell.cloud.google.com) öffnen (läuft im
Handy-Browser) und eingeben:

```bash
gcloud config set project DEINE-PROJEKT-ID
curl -sO https://raw.githubusercontent.com/SvdowUser/babytonsol-redirect/claude/minecraft-bot-permissions-cre253/tiktok-stream/setup-gcp-vm.sh
bash setup-gcp-vm.sh
```

Das Passwort wird **nur einmal** angezeigt — sofort notieren.

### 4. Vom Handy verbinden

Microsoft-App **„Windows App"** (früher „Remote Desktop") aus dem Store, IP-Adresse
und Zugangsdaten aus der Ausgabe eintragen.

### 5. Kostenwächter installieren

Auf der VM, in einer Administrator-PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File kostenwaechter.ps1 -Installieren
```

### 6. Software installieren

1. [TikTok LIVE Studio](https://www.tiktok.com/studio/download) — mit TikTok-Konto anmelden
2. [Livecade](https://livecade.io/) im Browser öffnen, Gratis-Konto, Spiel wählen,
   Overlay-URL kopieren
3. In LIVE Studio: Quelle hinzufügen → Browser → Overlay-URL einfügen
4. Ausgabe auf **720 × 1280, 30 fps, ~2,5–3 Mbit/s** stellen

## VM stoppen und starten

```bash
gcloud compute instances stop  livestudio --zone europe-west3-a   # nach jedem Stream!
gcloud compute instances start livestudio --zone europe-west3-a
gcloud compute instances delete livestudio --zone europe-west3-a  # beendet ALLE Kosten
```

## Bekannte Risiken

Ehrlich vorweg, damit nichts überrascht:

- **Keine GPU.** LIVE Studio empfiehlt NVENC oder Quick Sync. Auf der VM bleibt nur
  CPU-Encoding. Bei 720 × 1280 / 30 fps sollte das gehen, aber LIVE Studio ist eine
  GPU-beschleunigte Anwendung über RDP — es kann zäh laufen oder gar nicht starten.
  **Das ist der eigentliche Test dieses Setups.**
- **Unbeaufsichtigte Streams werden nicht monetarisiert.** TikTok schließt Inhalte,
  die überwiegend automatisiert ohne echte Creator-Präsenz laufen, von der
  Monetarisierung aus. Der Stream funktioniert nur, wenn du dabei bist und mit dem
  Chat interagierst.
- **Rechenzentrums-IP.** Der Stream kommt aus einem bekannten Google-IP-Bereich.
  In Kombination mit dem vorigen Punkt ist das ein Risiko für das Konto — und der
  Follower-Account ist das eigentliche Kapital. Im Zweifel ist ein gebrauchter PC
  für ~100 € der sicherere Weg.
- **RDP-Port offen.** `setup-gcp-vm.sh` öffnet Port 3389 für alle, weil sich die
  Handy-IP ständig ändert. Das Passwort von Google ist stark, aber sicherer ist
  eine Einschränkung auf deine IP:
  ```bash
  gcloud compute firewall-rules update erlaube-rdp --source-ranges DEINE.IP.HIER/32
  ```

## Wenn es nicht läuft

Fällt LIVE Studio wegen der fehlenden GPU aus, bleibt der kostenlose Weg:
Oracle-Linux-VM mit headless Chromium und ffmpeg, die das Livecade-Overlay per RTMP
ausgibt — zuerst nach Twitch, wo der Stream-Key sofort verfügbar ist.
