<#
    Kostenwaechter fuer die Livestream-VM.

    Problem: Eine vergessene, laufende Windows-VM verbrennt das 300-Dollar-
    Guthaben in gut drei Wochen. Dieses Skript faehrt die VM automatisch
    herunter -- zweifach abgesichert:

      1. Harte Obergrenze:  X Stunden nach dem Start ist Schluss, egal was laeuft.
      2. Leerlauf:          Keine RDP-Verbindung mehr fuer X Minuten -> Shutdown.

    Einmalig auf der VM in einer Administrator-PowerShell ausfuehren:

        powershell -ExecutionPolicy Bypass -File kostenwaechter.ps1 -Installieren

    Danach laeuft er bei jedem Start der VM automatisch mit.
#>

[CmdletBinding()]
param(
    [switch]$Installieren,
    [int]$MaxStunden = 0,        # 0 = aus den GCP-Metadaten lesen
    [int]$LeerlaufMinuten = 20
)

$ErrorActionPreference = 'Stop'
$TaskName   = 'Kostenwaechter-Livestream'
$SkriptPfad = $MyInvocation.MyCommand.Path

function Schreibe-Log {
    param([string]$Text)
    $zeile = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Text
    Write-Host $zeile
    try { Add-Content -Path 'C:\kostenwaechter.log' -Value $zeile -ErrorAction SilentlyContinue } catch { }
}

function Lies-MaxStundenAusMetadaten {
    # Der Wert kommt aus --metadata max-runtime-hours=... beim Anlegen der VM.
    try {
        $wert = Invoke-RestMethod -TimeoutSec 5 `
            -Headers @{ 'Metadata-Flavor' = 'Google' } `
            -Uri 'http://metadata.google.internal/computeMetadata/v1/instance/attributes/max-runtime-hours'
        if ($wert -as [int]) { return [int]$wert }
    } catch {
        Schreibe-Log "Metadaten nicht lesbar ($($_.Exception.Message)) -- nehme 5 Stunden."
    }
    return 5
}

function Zaehle-AktiveRdpSitzungen {
    # 'rdp-tcp#N' taucht nur bei tatsaechlich verbundenen Sitzungen auf.
    # Bewusst ueber den Sitzungsnamen statt ueber die Statusspalte, damit das
    # auf deutschem wie englischem Windows gleich funktioniert.
    try {
        $ausgabe = & query session 2>$null
        if (-not $ausgabe) { return 0 }
        return @($ausgabe | Select-String -Pattern 'rdp-tcp#\d+').Count
    } catch {
        return 0
    }
}

function Installiere-Aufgabe {
    $aktion = New-ScheduledTaskAction -Execute 'powershell.exe' `
        -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$SkriptPfad`""
    $ausloeser = New-ScheduledTaskTrigger -AtStartup
    $konto     = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -RunLevel Highest
    $optionen  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)

    Register-ScheduledTask -TaskName $TaskName -Action $aktion -Trigger $ausloeser `
        -Principal $konto -Settings $optionen -Force | Out-Null

    Schreibe-Log "Aufgabe '$TaskName' eingerichtet -- laeuft ab jetzt bei jedem VM-Start."
    Write-Host ''
    Write-Host 'Installiert. Zum Testen ohne Neustart:' -ForegroundColor Green
    Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
    Write-Host ''
    Write-Host 'Wieder entfernen:' -ForegroundColor Yellow
    Write-Host "  Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
}

function Starte-Ueberwachung {
    if ($MaxStunden -le 0) { $MaxStunden = Lies-MaxStundenAusMetadaten }

    $start       = Get-Date
    $schluss     = $start.AddHours($MaxStunden)
    $leerSeit    = $null
    $gewarnt     = $false

    Schreibe-Log "Start. Harte Grenze: $MaxStunden h (um $($schluss.ToString('HH:mm'))). Leerlauf-Grenze: $LeerlaufMinuten min."

    while ($true) {
        Start-Sleep -Seconds 60
        $jetzt = Get-Date

        # --- 1. Harte Obergrenze ---
        if ($jetzt -ge $schluss) {
            Schreibe-Log "Maximale Laufzeit von $MaxStunden h erreicht -- fahre herunter."
            try { & msg * /TIME:30 "Kostenwaechter: Maximale Laufzeit erreicht. Die VM faehrt jetzt herunter." } catch { }
            Start-Sleep -Seconds 30
            Stop-Computer -Force
            return
        }

        $verbleibend = [int]($schluss - $jetzt).TotalMinutes
        if (-not $gewarnt -and $verbleibend -le 10) {
            $gewarnt = $true
            Schreibe-Log "Noch $verbleibend Minuten bis zum Zwangs-Shutdown."
            try { & msg * /TIME:60 "Kostenwaechter: Die VM faehrt in $verbleibend Minuten herunter. Stream jetzt beenden." } catch { }
        }

        # --- 2. Leerlauf ---
        $sitzungen = Zaehle-AktiveRdpSitzungen
        if ($sitzungen -gt 0) {
            if ($leerSeit) { Schreibe-Log "Wieder verbunden -- Leerlaufzaehler zurueckgesetzt." }
            $leerSeit = $null
            continue
        }

        if (-not $leerSeit) {
            $leerSeit = $jetzt
            Schreibe-Log "Keine RDP-Verbindung mehr. Shutdown in $LeerlaufMinuten Minuten, falls niemand zurueckkommt."
            continue
        }

        if (($jetzt - $leerSeit).TotalMinutes -ge $LeerlaufMinuten) {
            Schreibe-Log "$LeerlaufMinuten Minuten ohne Verbindung -- fahre herunter."
            Stop-Computer -Force
            return
        }
    }
}

if ($Installieren) { Installiere-Aufgabe } else { Starte-Ueberwachung }
