# KI-Server: Stock-Automat

Ein kostenloser Oracle-Cloud-Server, auf dem eine **lokale KI** rund um die Uhr Stockfotos
erzeugt und sie zu **Adobe Stock** hochlädt. Dort sind die Käufer schon – du musst keine
Kunden suchen.

**Ehrliche Erwartung:** Die ersten Wochen passiert fast nichts (Prüfung durch Adobe, erste
Verkäufe dauern). Mit einigen hundert angenommenen Bildern sind **ein paar Euro pro Woche**
realistisch. Pro Verkauf bekommst du ca. 0,30–1 €.

## Was automatisch läuft

1. Text-KI (Ollama, `qwen2.5:3b`) denkt sich ein gefragtes Motiv aus + Titel + Stichwörter
2. Bild-KI (Stable Diffusion XL, kommerzielle Nutzung erlaubt) malt das Bild auf der CPU (ein paar Minuten pro Bild)
3. Hochskalieren auf über 4 Megapixel (Adobe-Mindestgröße)
4. Titel und Stichwörter werden in die Bilddatei geschrieben
5. Upload per SFTP zu Adobe Stock
6. Optional: Telegram-Nachricht, wenn Bilder bereitliegen

**Das Einzige, was du tun musst** (ca. 2 Minuten pro Woche): Im Adobe-Portal die neuen
Bilder markieren, **„Mit generativer KI erstellt“** anhaken und auf **Einreichen** klicken.
Das verlangt Adobe von Hand, dafür gibt es keine Schnittstelle.

---

## Schritt 1: Oracle-Server anlegen (einmalig, ca. 20 Minuten)

1. Auf <https://www.oracle.com/cloud/free/> registrieren. Region **Germany Central (Frankfurt)**.
   Eine Kreditkarte wird zur Bestätigung verlangt, für den Gratis-Tarif wird nichts abgebucht.
2. Im Menü: **Compute → Instances → Create Instance**
   - Image: **Ubuntu 22.04** (oder 24.04)
   - Shape: **Ampere → VM.Standard.A1.Flex**, **4 OCPUs, 24 GB RAM** (Always Free)
   - Boot-Volume: **200 GB** (Always Free erlaubt insgesamt 200 GB)
   - SSH-Schlüssel: „Generate key pair“ → **privaten Schlüssel herunterladen** und gut aufheben
3. Meldung „Out of capacity“? Das ist bei Frankfurt normal. Später nochmal versuchen, oft klappt es nachts.
4. Verbinden (am PC im Terminal bzw. PowerShell):
   ```
   ssh -i pfad/zum/schluessel.key ubuntu@<ÖFFENTLICHE-IP>
   ```

## Schritt 2: Automat installieren (ein Befehl)

Auf dem Server:
```
git clone -b claude/claude-300-euro-verdienst-i5ro4d https://github.com/SvdowUser/babytonsol-redirect.git
cd babytonsol-redirect/ki-server
bash setup.sh
```
Das dauert ca. 15–30 Minuten. Danach läuft der Automat, erst mal im **Testmodus**: Er
erzeugt Bilder, lädt aber noch nichts hoch.

Zuschauen: `journalctl -u stock-bot -f`
Beim ersten Start lädt er das Bildmodell (~7 GB), das dauert etwas.

## Schritt 3: Testbilder anschauen

Nach ein paar Stunden liegen Bilder in `ki-server/data/pending/`. Auf deinen PC holen:
```
scp -i pfad/zum/schluessel.key "ubuntu@<IP>:babytonsol-redirect/ki-server/data/pending/*.jpg" .
```
Sehen sie gut aus? Dann weiter mit Schritt 4. Wenn nicht, sag Bescheid, dann passen wir die Themen an.

## Schritt 4: Adobe Stock verbinden

1. Auf <https://contributor.stock.adobe.com> kostenlos als Anbieter registrieren (Steuerformular ausfüllen).
2. Im Portal: **Hochladen → FTP/SFTP-Zugangsdaten** anzeigen lassen.
3. Auf dem Server eintragen:
   ```
   nano ~/babytonsol-redirect/ki-server/config.env
   ```
   `ADOBE_SFTP_USER`, `ADOBE_SFTP_PASSWORD` ausfüllen und `UPLOAD_ENABLED=true` setzen.
4. Neu starten: `sudo systemctl restart stock-bot`

## Schritt 5 (optional): Telegram-Benachrichtigung

In Telegram **@BotFather** anschreiben → `/newbot` → Token kopieren. Deinem neuen Bot eine
Nachricht schicken, dann `https://api.telegram.org/bot<TOKEN>/getUpdates` im Browser
öffnen und die Zahl bei `"chat":{"id":` kopieren. Beides in `config.env` eintragen und neu starten.

---

## Wichtig

- **Qualität vor Masse.** Standard sind 15 Bilder pro Tag. Nicht stark erhöhen, Adobe lehnt
  Massenware ab und kann Konten sperren.
- **Einnahmen versteuern.** Sobald Geld reinkommt, ist das Einkommen.
- **Server nicht leer laufen lassen:** Oracle kann Gratis-Server zurückfordern, die 7 Tage kaum
  etwas tun. Der Automat hält ihn beschäftigt.

## Nützliche Befehle

| Was | Befehl |
|---|---|
| Live-Protokoll | `journalctl -u stock-bot -f` |
| Stoppen / Starten | `sudo systemctl stop stock-bot` / `sudo systemctl start stock-bot` |
| Nach Änderung an config.env | `sudo systemctl restart stock-bot` |
| Wie viele Bilder? | `ls data/pending data/uploaded \| wc -l` |

## Optional: Storj (Speicher vermieten)

Vermietet freien Speicher, bringt aber nur **Cent-Beträge** (bei 100 GB etwa 0,15–0,50 € im Monat, ausgezahlt in STORJ-Token).
Voraussetzungen: eine Ethereum-Wallet-Adresse (z. B. MetaMask) und in der Oracle-Konsole
unter **Networking → VCN → Security List** eine Regel für Port **28967 (TCP und UDP)**.
```
bash storj-setup.sh <WALLET-ADRESSE> <E-MAIL> 100GB
```
Das Skript führt dich durch Identität erzeugen → autorisieren → starten.
Den Stock-Automaten nicht vergessen: Bilder brauchen auch Platz, deshalb höchstens ~100 GB für Storj.
