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

if (-not $config.nodeBinaryPath -or -not (Test-Path $config.nodeBinaryPath)) {
  Write-Error "Set nodeBinaryPath in config to your ethernova.exe path."
  exit 1
}

$rpcPort = 8545
if ($config.rpcUrl) {
  try {
    $rpcUri = [System.Uri]$config.rpcUrl
    if ($rpcUri.Port) { $rpcPort = $rpcUri.Port }
  } catch {
    Write-Error "Invalid rpcUrl in config: $($config.rpcUrl)"
    exit 1
  }
}

$datadir = if ($config.datadir) { $config.datadir } else { Join-Path $root 'data\\node-data' }
$logDir = if ($config.logDir) { $config.logDir } else { Join-Path $root 'logs' }
$dataDir = Join-Path $root 'data'

New-Item -ItemType Directory -Path $datadir -Force | Out-Null
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
New-Item -ItemType Directory -Path $dataDir -Force | Out-Null

$bootnodesPath = Join-Path $root 'config\bootnodes.txt'
$bootnodes = @()
if (Test-Path $bootnodesPath) {
  $bootnodes = Get-Content $bootnodesPath |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ -and -not $_.StartsWith('#') }
}

$bootnodesArg = $null
if ($bootnodes.Count -gt 0) {
  $bootnodesArg = $bootnodes -join ','
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$logOut = Join-Path $logDir "node-$timestamp.out.log"
$logErr = Join-Path $logDir "node-$timestamp.err.log"

$p2pPort = if ($config.p2pPort) { [int]$config.p2pPort } else { 30303 }
$maxPeers = if ($config.maxPeers) { [int]$config.maxPeers } else { 200 }

function QuoteArg($value) {
  if ($null -eq $value) { return $value }
  if ($value -match '\s') { return \"`\"$value`\"\" }
  return $value
}

$arguments = @(
  '--http',
  '--http.addr', '127.0.0.1',
  '--http.port', $rpcPort,
  '--http.api', 'eth,net,web3,admin',
  '--port', $p2pPort,
  '--maxpeers', $maxPeers,
  '--datadir', (QuoteArg $datadir)
)

if ($bootnodesArg) {
  $arguments += @('--bootnodes', (QuoteArg $bootnodesArg))
}

try {
  $proc = Start-Process -FilePath $config.nodeBinaryPath `
    -ArgumentList $arguments `
    -RedirectStandardOutput $logOut `
    -RedirectStandardError $logErr `
    -PassThru `
    -NoNewWindow `
    -ErrorAction Stop
} catch {
  Write-Error "Failed to start node: $($_.Exception.Message)"
  exit 1
}

$pidPath = Join-Path $dataDir 'node.pid'
$proc.Id | Set-Content -Path $pidPath

Write-Host "Node started. PID $($proc.Id) -> $pidPath"
Write-Host "Logs: $logOut , $logErr"



