param(
  [string]$ConfigPath = (Join-Path $PSScriptRoot '..\config\app.config.json')
)

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$ConfigPath = Resolve-Path $ConfigPath

if (-not (Test-Path $ConfigPath)) {
  Write-Error "Config file not found: $ConfigPath"
  exit 1
}

$config = Get-Content $ConfigPath | ConvertFrom-Json

$dataDir = Join-Path $root 'data'
$logDir = if ($config.logDir) { $config.logDir } else { Join-Path $root 'logs' }
$collectorDir = Join-Path $root 'collector'

New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$logOut = Join-Path $logDir "collector-$timestamp.out.log"
$logErr = Join-Path $logDir "collector-$timestamp.err.log"

function QuoteArg($value) {
  if ($null -eq $value) { return $value }
  if ($value -match '\s') { return \"`\"$value`\"\" }
  return $value
}

try {
  $proc = Start-Process -FilePath 'node' `
    -ArgumentList @('server.js', '--config', (QuoteArg $ConfigPath), '--mode', 'all') `
    -WorkingDirectory $collectorDir `
    -RedirectStandardOutput $logOut `
    -RedirectStandardError $logErr `
    -PassThru `
    -NoNewWindow `
    -ErrorAction Stop
} catch {
  Write-Error "Failed to start collector: $($_.Exception.Message)"
  exit 1
}

$pidPath = Join-Path $dataDir 'collector.pid'
$proc.Id | Set-Content -Path $pidPath

Write-Host "Collector and web server started. PID $($proc.Id) -> $pidPath"
Write-Host "Logs: $logOut , $logErr"



