param(
  [string]$ProjectPath = (Split-Path -Parent $PSScriptRoot),
  [string]$PythonPath = 'E:\anaconda3\envs\gvmgen\python.exe',
  [int]$CheckIntervalSeconds = 20
)

$ErrorActionPreference = 'SilentlyContinue'
$healthUrl = 'http://127.0.0.1:8002/health'
$stdoutLog = Join-Path $ProjectPath '.gvmgen-service.log'
$stderrLog = Join-Path $ProjectPath '.gvmgen-service.err.log'

function Test-VideoService {
  try {
    $response = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 8
    return $response.ready -eq $true -and
      @('chunked', 'object-store') -contains $response.upload_mode -and
      $response.service_version -eq '3.0.0'
  } catch {
    return $false
  }
}

function Find-VideoServiceProcess {
  @(Get-CimInstance Win32_Process | Where-Object {
    $_.Name -match '^python(w)?\.exe$' -and
    $_.CommandLine -match 'uvicorn\s+services\.gvmgen_service:app' -and
    $_.CommandLine -match '(--port\s+8002|--port=8002)' -and
    $_.CommandLine -like "*--app-dir*$ProjectPath*"
  })
}

while ($true) {
  if (-not (Test-VideoService)) {
    $serviceProcesses = Find-VideoServiceProcess
    if ($serviceProcesses.Count -eq 0 -and (Test-Path -LiteralPath $PythonPath)) {
      Start-Process -FilePath $PythonPath `
        -ArgumentList @('-m', 'uvicorn', 'services.gvmgen_service:app', '--host', '127.0.0.1', '--port', '8002', '--app-dir', "`"$ProjectPath`"") `
        -WorkingDirectory $ProjectPath `
        -RedirectStandardOutput $stdoutLog `
        -RedirectStandardError $stderrLog `
        -WindowStyle Hidden
    }
  }
  Start-Sleep -Seconds $CheckIntervalSeconds
}
