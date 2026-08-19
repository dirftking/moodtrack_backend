param(
  [string] $ApiUrl = 'https://api.acemusic.ai',
  [string] $Model = 'acemusic/acestep-v15-turbo'
)

$projectPath = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $projectPath '.env.local'
$secureKey = Read-Host 'Paste ACEMusic API Key (input is hidden)' -AsSecureString
$keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)

try {
  $apiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
}

if ([string]::IsNullOrWhiteSpace($apiKey) -or $apiKey.Length -lt 8) {
  throw 'API Key is empty or invalid.'
}
if ($apiKey.Contains("`r") -or $apiKey.Contains("`n")) {
  throw 'API Key must not contain a newline.'
}

$lines = @(
  "ACESTEP_API_URL=$($ApiUrl.TrimEnd('/'))",
  "ACESTEP_API_KEY=$apiKey",
  "ACESTEP_MODEL=$Model"
)
Set-Content -LiteralPath $envPath -Value $lines -Encoding ascii

$apiKey = $null
Write-Host "ACE cloud configuration was written to $envPath"
Write-Host 'Restart the MoodTrack frontend to apply it.'
