[CmdletBinding()]
param(
  [string]$PythonPath = 'E:\anaconda3\envs\gvmgen\python.exe'
)

$ErrorActionPreference = 'Stop'

$defaultProjectRef = 'hskupbnysmzraxghvsxp'
$defaultRegion = 'ap-southeast-2'
$defaultBucket = 'moodtrack-video-input'
$managedBlockStart = '# BEGIN MoodTrack managed S3 storage'
$managedBlockEnd = '# END MoodTrack managed S3 storage'
$temporaryEnvironmentNames = @(
  'MOODTRACK_SETUP_S3_ENDPOINT',
  'MOODTRACK_SETUP_S3_REGION',
  'MOODTRACK_SETUP_S3_ACCESS_KEY_ID',
  'MOODTRACK_SETUP_S3_SECRET_ACCESS_KEY',
  'MOODTRACK_SETUP_S3_BUCKET'
)

function Read-ValueWithDefault {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string]$DefaultValue
  )

  $value = Read-Host "$Label [$DefaultValue]"
  if ([string]::IsNullOrWhiteSpace($value)) {
    return $DefaultValue
  }
  return $value.Trim()
}

function ConvertFrom-SecureValue {
  param([Parameter(Mandatory = $true)][Security.SecureString]$SecureValue)

  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

function Assert-SingleLineValue {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [AllowEmptyString()][string]$Value
  )

  if ([string]::IsNullOrWhiteSpace($Value) -or $Value -match '[\r\n]') {
    throw "$Name must not be empty or contain a line break."
  }
}

function Write-ManagedEnvironmentBlock {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][hashtable]$Values
  )

  $managedNames = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($name in $Values.Keys) {
    [void]$managedNames.Add([string]$name)
  }

  $preservedLines = [Collections.Generic.List[string]]::new()
  $insideManagedBlock = $false
  if (Test-Path -LiteralPath $Path -PathType Leaf) {
    foreach ($line in [IO.File]::ReadAllLines($Path)) {
      if ($line.Trim() -eq $script:managedBlockStart) {
        $insideManagedBlock = $true
        continue
      }
      if ($insideManagedBlock) {
        if ($line.Trim() -eq $script:managedBlockEnd) {
          $insideManagedBlock = $false
        }
        continue
      }

      $match = [regex]::Match($line, '^\s*(?:export\s+)?(?<name>[A-Za-z_][A-Za-z0-9_]*)\s*=')
      if ($match.Success -and $managedNames.Contains($match.Groups['name'].Value)) {
        continue
      }
      $preservedLines.Add($line)
    }
  }

  while ($preservedLines.Count -gt 0 -and [string]::IsNullOrWhiteSpace($preservedLines[$preservedLines.Count - 1])) {
    $preservedLines.RemoveAt($preservedLines.Count - 1)
  }
  if ($preservedLines.Count -gt 0) {
    $preservedLines.Add('')
  }

  $preservedLines.Add($script:managedBlockStart)
  $preservedLines.Add('# Server-only credentials. Do not add VITE_ prefixes or commit this file.')
  foreach ($name in @(
    'S3_PROVIDER',
    'S3_ENDPOINT_URL',
    'S3_REGION',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
    'S3_BUCKET_NAME',
    'S3_PREFIX',
    'S3_PRESIGN_TTL_SECONDS',
    'S3_FORCE_PATH_STYLE',
    'GVMGEN_MAX_UPLOAD_MB'
  )) {
    $preservedLines.Add("$name=$($Values[$name])")
  }
  $preservedLines.Add($script:managedBlockEnd)

  $temporaryPath = "$Path.$PID.tmp"
  try {
    $utf8WithoutBom = [Text.UTF8Encoding]::new($false)
    [IO.File]::WriteAllLines($temporaryPath, $preservedLines, $utf8WithoutBom)
    Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
  }
  finally {
    if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
      Remove-Item -LiteralPath $temporaryPath -Force
    }
  }
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontendRoot = [IO.Path]::GetFullPath((Join-Path $scriptRoot '..'))
$environmentPath = Join-Path $frontendRoot '.env.gvmgen.local'
$savedEnvironment = @{}
$secretAccessKey = $null
$secureSecret = $null
$verificationScriptPath = $null

try {
  if (-not (Test-Path -LiteralPath $PythonPath -PathType Leaf)) {
    throw "GVMGen Python was not found: $PythonPath"
  }

  Write-Host 'MoodTrack Supabase S3 local setup'
  Write-Host 'First enable S3 and create an Access Key in Supabase Dashboard: Storage > Settings > S3.'
  Write-Host 'The Secret Access Key is read invisibly and written only to the private local environment file.'

  $projectRef = Read-ValueWithDefault -Label 'Project ref' -DefaultValue $defaultProjectRef
  $region = Read-ValueWithDefault -Label 'Region' -DefaultValue $defaultRegion
  $bucket = Read-ValueWithDefault -Label 'Private bucket' -DefaultValue $defaultBucket

  if ($projectRef -notmatch '^[a-z0-9]{20}$') {
    throw 'Invalid Project ref. Expected 20 lowercase letters or digits.'
  }
  if ($region -notmatch '^[a-z0-9][a-z0-9-]*[a-z0-9]$') {
    throw 'Invalid Region.'
  }
  if ($bucket -notmatch '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$') {
    throw 'Invalid Bucket name. Use lowercase letters, digits, and hyphens only.'
  }

  $endpoint = "https://$projectRef.storage.supabase.co/storage/v1/s3"
  $accessKeyId = (Read-Host 'S3 Access Key ID').Trim()
  $secureSecret = Read-Host 'S3 Secret Access Key (input is hidden)' -AsSecureString
  $secretAccessKey = ConvertFrom-SecureValue -SecureValue $secureSecret
  Assert-SingleLineValue -Name 'S3 Access Key ID' -Value $accessKeyId
  Assert-SingleLineValue -Name 'S3 Secret Access Key' -Value $secretAccessKey
  if ($accessKeyId -match '\s' -or $secretAccessKey -match '\s') {
    throw 'S3 credentials must not contain whitespace. Copy them again.'
  }

  Write-Host "Endpoint: $endpoint"
  Write-Host "Region:   $region"
  Write-Host "Bucket:   $bucket"
  $confirmation = Read-Host 'Verify the connection and create the private Bucket if missing? [Y/n]'
  if (-not [string]::IsNullOrWhiteSpace($confirmation) -and $confirmation.Trim() -notmatch '^(?i:y|yes)$') {
    Write-Host 'Cancelled; no configuration was written.'
    return
  }

  $setupValues = @{
    'MOODTRACK_SETUP_S3_ENDPOINT' = $endpoint
    'MOODTRACK_SETUP_S3_REGION' = $region
    'MOODTRACK_SETUP_S3_ACCESS_KEY_ID' = $accessKeyId
    'MOODTRACK_SETUP_S3_SECRET_ACCESS_KEY' = $secretAccessKey
    'MOODTRACK_SETUP_S3_BUCKET' = $bucket
  }
  foreach ($name in $temporaryEnvironmentNames) {
    $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    [Environment]::SetEnvironmentVariable($name, $setupValues[$name], 'Process')
  }

  $pythonVerifier = @'
import json
import os
import sys

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError


def emit(payload, status=0):
    print(json.dumps(payload, separators=(",", ":")))
    raise SystemExit(status)


try:
    endpoint = os.environ["MOODTRACK_SETUP_S3_ENDPOINT"]
    region = os.environ["MOODTRACK_SETUP_S3_REGION"]
    bucket = os.environ["MOODTRACK_SETUP_S3_BUCKET"]
    client = boto3.client(
        "s3",
        endpoint_url=endpoint,
        region_name=region,
        aws_access_key_id=os.environ["MOODTRACK_SETUP_S3_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["MOODTRACK_SETUP_S3_SECRET_ACCESS_KEY"],
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )
    bucket_names = {
        item.get("Name")
        for item in client.list_buckets().get("Buckets", [])
        if item.get("Name")
    }
    created = bucket not in bucket_names
    if created:
        # Supabase does not implement S3 ACL headers; newly created buckets are
        # private by default, so no public ACL is requested here.
        client.create_bucket(Bucket=bucket)
    client.head_bucket(Bucket=bucket)
    emit({"ok": True, "created": created})
except ClientError as error:
    response = error.response or {}
    code = str(response.get("Error", {}).get("Code", "client_error"))
    emit({"ok": False, "error_code": code}, 2)
except BotoCoreError as error:
    emit({"ok": False, "error_code": type(error).__name__}, 2)
except Exception as error:
    emit({"ok": False, "error_code": type(error).__name__}, 2)
'@

  # Windows PowerShell 5.1 can corrupt quotes in a multi-line string passed to
  # `python -c`. Execute the verifier from a short-lived UTF-8 file instead and
  # capture stdout/stderr without exposing credentials or turning native stderr
  # into a PowerShell NativeCommandError.
  $verificationScriptPath = Join-Path ([IO.Path]::GetTempPath()) (
    'moodtrack-supabase-verify-{0}.py' -f [Guid]::NewGuid().ToString('N')
  )
  $utf8WithoutBom = [Text.UTF8Encoding]::new($false)
  [IO.File]::WriteAllText($verificationScriptPath, $pythonVerifier, $utf8WithoutBom)

  $processInfo = [Diagnostics.ProcessStartInfo]::new()
  $processInfo.FileName = $PythonPath
  $processInfo.Arguments = '"{0}"' -f $verificationScriptPath.Replace('"', '\"')
  $processInfo.WorkingDirectory = $frontendRoot
  $processInfo.UseShellExecute = $false
  $processInfo.CreateNoWindow = $true
  $processInfo.RedirectStandardOutput = $true
  $processInfo.RedirectStandardError = $true

  $verificationProcess = [Diagnostics.Process]::new()
  $verificationProcess.StartInfo = $processInfo
  if (-not $verificationProcess.Start()) {
    throw 'Could not start the Supabase S3 verifier.'
  }
  $verificationText = $verificationProcess.StandardOutput.ReadToEnd().Trim()
  $verificationError = $verificationProcess.StandardError.ReadToEnd().Trim()
  $verificationProcess.WaitForExit()
  $verificationExitCode = $verificationProcess.ExitCode
  $verificationProcess.Dispose()

  try {
    $verification = $verificationText | ConvertFrom-Json -ErrorAction Stop
  }
  catch {
    $safeReason = if ($verificationError -match 'ModuleNotFoundError') {
      'boto3 is not installed in the selected Python environment'
    }
    elseif ($verificationError) {
      'the verifier could not start correctly'
    }
    else {
      'no verification result was returned'
    }
    throw "Supabase S3 verification failed: $safeReason."
  }
  if ($verificationExitCode -ne 0 -or -not $verification.ok) {
    $safeCode = if ($verification.error_code) { [string]$verification.error_code } else { 'unknown' }
    throw "Supabase S3 verification failed ($safeCode). Check S3 enablement, credentials, Project ref, and Region."
  }

  if ($verification.created) {
    Write-Host 'Bucket created. New Supabase Buckets are Private by default.'
  }
  else {
    Write-Host 'The Bucket already exists and the S3 connection succeeded.'
    Write-Warning 'The Supabase S3 API does not expose the public flag. Confirm in Dashboard that the Bucket is Private.'
    $privateConfirmation = Read-Host 'After confirming Public bucket is off in Dashboard, type PRIVATE to continue'
    if ($privateConfirmation.Trim() -cne 'PRIVATE') {
      throw 'The existing Bucket was not confirmed as Private; no local configuration was written.'
    }
  }

  Write-ManagedEnvironmentBlock -Path $environmentPath -Values @{
    'S3_PROVIDER' = 'supabase'
    'S3_ENDPOINT_URL' = $endpoint
    'S3_REGION' = $region
    'S3_ACCESS_KEY_ID' = $accessKeyId
    'S3_SECRET_ACCESS_KEY' = $secretAccessKey
    'S3_BUCKET_NAME' = $bucket
    'S3_PREFIX' = 'incoming'
    'S3_PRESIGN_TTL_SECONDS' = '900'
    'S3_FORCE_PATH_STYLE' = 'true'
    'GVMGEN_MAX_UPLOAD_MB' = '50'
  }

  Write-Host "Configuration was written safely: $environmentPath"
  Write-Host 'The Secret was not printed. Restart the video service, then check /gvmgen/health.'
}
finally {
  foreach ($name in $temporaryEnvironmentNames) {
    if ($savedEnvironment.ContainsKey($name)) {
      [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process')
    }
  }
  if ($verificationScriptPath -and (Test-Path -LiteralPath $verificationScriptPath -PathType Leaf)) {
    Remove-Item -LiteralPath $verificationScriptPath -Force -ErrorAction SilentlyContinue
  }
  $secretAccessKey = $null
  $secureSecret = $null
}
