$projectPath = 'C:\Users\Drift king\Desktop\Moodtrack\moodtrack\frontend'
$powershellPath = 'C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe'
$watchdogLog = Join-Path $projectPath '.watchdog.log'

function Write-WatchdogLog([string] $message) {
  $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  Add-Content -LiteralPath $watchdogLog -Value "[$timestamp] $message"
}

function Start-HiddenScript(
  [string] $scriptName,
  [string] $stdoutName,
  [string] $stderrName
) {
  $scriptPath = Join-Path $projectPath "scripts\$scriptName"
  $stdoutPath = Join-Path $projectPath $stdoutName
  $stderrPath = Join-Path $projectPath $stderrName
  $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""

  Start-Process -FilePath $powershellPath -ArgumentList $arguments -WorkingDirectory $projectPath -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -WindowStyle Hidden | Out-Null
}

function Test-LocalSite {
  try {
    $response = Invoke-WebRequest -Uri 'http://127.0.0.1:5173/' -UseBasicParsing -TimeoutSec 5
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Get-AceStepProcesses {
  return Get-CimInstance Win32_Process | Where-Object {
    ($_.Name -eq 'uv.exe' -and $_.CommandLine -like '*run acestep-api*') -or
    ($_.Name -match '^python.*\.exe$' -and $_.CommandLine -like '*ACE-Step-1.5*api_server*')
  }
}

function Get-TunnelProcesses {
  return Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -like '*quick-start*127.0.0.1:5173*' -or
    $_.CommandLine -like '*cloudflared*url:http://127.0.0.1:5173*'
  }
}

function Save-TunnelUrl {
  $tunnelLog = Join-Path $projectPath '.tunnel.err.log'
  if (-not (Test-Path -LiteralPath $tunnelLog)) { return }

  $match = Select-String -Path $tunnelLog -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -AllMatches | Select-Object -Last 1
  if ($match -and $match.Matches.Count -gt 0) {
    Set-Content -LiteralPath (Join-Path $projectPath '.tunnel-url.txt') -Value $match.Matches[-1].Value
  }
}

Write-WatchdogLog 'MoodTrack watchdog started.'

while ($true) {
  try {
    if (-not (Test-LocalSite)) {
      Write-WatchdogLog 'Local site was unavailable; restarting it.'
      Start-HiddenScript 'start-dev.ps1' '.vite-demo.log' '.vite-demo.err.log'
      Start-Sleep -Seconds 6
    }

    if (-not (Get-AceStepProcesses)) {
      Write-WatchdogLog 'ACE-Step API was unavailable; restarting it.'
      Start-HiddenScript 'start-ace-step.ps1' '.ace-step.out.log' '.ace-step.err.log'
      Start-Sleep -Seconds 10
    }

    if (-not (Get-TunnelProcesses)) {
      Write-WatchdogLog 'Public tunnel was unavailable; restarting it.'
      Start-HiddenScript 'start-tunnel.ps1' '.tunnel.log' '.tunnel.err.log'
      Start-Sleep -Seconds 10
    }

    Save-TunnelUrl
  } catch {
    Write-WatchdogLog "Watch cycle failed: $($_.Exception.Message)"
  }

  Start-Sleep -Seconds 20
}
