$projectPath = Split-Path -Parent $PSScriptRoot
$aceStepPath = Join-Path $projectPath 'services\ACE-Step-1.5'
$uvPath = 'C:\Users\Drift king\AppData\Roaming\Python\Python312\Scripts\uv.exe'

if (-not (Test-Path -LiteralPath $uvPath)) {
  throw "uv was not found at $uvPath"
}

if (-not (Test-Path -LiteralPath (Join-Path $aceStepPath 'pyproject.toml'))) {
  throw "ACE-Step 1.5 was not found at $aceStepPath"
}

$env:ACESTEP_API_HOST = '127.0.0.1'
$env:ACESTEP_API_PORT = '8001'
$env:ACESTEP_CONFIG_PATH = 'acestep-v15-turbo'
$env:ACESTEP_INIT_LLM = 'true'
$env:ACESTEP_LM_MODEL_PATH = 'acestep-5Hz-lm-1.7B'
$env:ACESTEP_LM_BACKEND = 'pt'
$env:ACESTEP_DEVICE = 'cuda'
$env:ACESTEP_BATCH_SIZE = '1'
$env:ACESTEP_DOWNLOAD_SOURCE = 'auto'

Set-Location -LiteralPath $aceStepPath
& $uvPath run acestep-api
exit $LASTEXITCODE
