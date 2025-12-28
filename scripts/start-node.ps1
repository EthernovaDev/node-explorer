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

$nodeStartBatPath = $config.nodeStartBatPath
if (-not [string]::IsNullOrWhiteSpace($nodeStartBatPath)) {
  if (-not (Test-Path $nodeStartBatPath)) {
    Write-Error "nodeStartBatPath not found: $nodeStartBatPath"
    exit 1
  }
} elseif (-not $config.nodeBinaryPath -or -not (Test-Path $config.nodeBinaryPath)) {
  Write-Error "Set nodeBinaryPath in config to your ethernova.exe path or set nodeStartBatPath."
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

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$logOut = Join-Path $logDir "node-$timestamp.out.log"
$logErr = Join-Path $logDir "node-$timestamp.err.log"

if (-not [string]::IsNullOrWhiteSpace($nodeStartBatPath)) {
  $batArgs = @()
  if ($config.nodeStartBatArgs) {
    if ($config.nodeStartBatArgs -is [System.Collections.IEnumerable] -and -not ($config.nodeStartBatArgs -is [string])) {
      $batArgs = @($config.nodeStartBatArgs)
    } else {
      $batArgs = @($config.nodeStartBatArgs)
    }
  }
  $cmdArgs = @('/c', "`"$nodeStartBatPath`"") + $batArgs
  $batWorkingDir = Split-Path $nodeStartBatPath -Parent
  try {
    $proc = Start-Process -FilePath 'cmd.exe' `
      -ArgumentList $cmdArgs `
      -WorkingDirectory $batWorkingDir `
      -RedirectStandardOutput $logOut `
      -RedirectStandardError $logErr `
      -PassThru `
      -NoNewWindow `
      -ErrorAction Stop
  } catch {
    Write-Error "Failed to start node (bat): $($_.Exception.Message)"
    exit 1
  }
} else {
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

  $p2pPort = if ($config.p2pPort) { [int]$config.p2pPort } else { 30303 }
  $maxPeers = if ($config.maxPeers) { [int]$config.maxPeers } else { 200 }

  function QuoteArg($value) {
    if ($null -eq $value) { return $value }
    if ($value -match '\s') { return "`"$value`"" }
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
}

$pidPath = Join-Path $dataDir 'node.pid'
$proc.Id | Set-Content -Path $pidPath

Write-Host "Node started. PID $($proc.Id) -> $pidPath"
Write-Host "Logs: $logOut , $logErr"





