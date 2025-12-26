param(
  [ValidateSet('txt','json','csv')][string]$Format = 'txt',
  [string]$OutFile = ''
)

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$configPath = Join-Path $root 'config\app.config.json'

if (-not (Test-Path $configPath)) {
  Write-Error "Config file not found: $configPath"
  exit 1
}

$config = Get-Content $configPath | ConvertFrom-Json
$apiPort = if ($config.apiPort) { $config.apiPort } else { 9090 }
$apiBase = "http://127.0.0.1:$apiPort"

$endpoint = switch ($Format) {
  'txt' { 'enodes.txt' }
  'json' { 'enodes.json' }
  'csv' { 'enodes.csv' }
}

$dataDir = Join-Path $root 'data'
New-Item -ItemType Directory -Path $dataDir -Force | Out-Null

if (-not $OutFile) {
  $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $OutFile = Join-Path $dataDir "enodes-$timestamp.$Format"
}

$uri = "$apiBase/api/export/$endpoint"
Invoke-WebRequest -Uri $uri -OutFile $OutFile | Out-Null

Write-Host "Saved $Format export to $OutFile"


