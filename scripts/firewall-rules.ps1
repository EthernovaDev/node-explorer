param(
  [string]$ConfigPath = (Join-Path $PSScriptRoot '..\config\app.config.json')
)

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
  Write-Error 'Run this script as Administrator to add firewall rules.'
  exit 1
}

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$ConfigPath = Resolve-Path $ConfigPath

if (-not (Test-Path $ConfigPath)) {
  Write-Error "Config file not found: $ConfigPath"
  exit 1
}

$config = Get-Content $ConfigPath | ConvertFrom-Json
$port = [int]($config.p2pPort | ForEach-Object { $_ })
$webPort = if ($config.webPort) { [int]$config.webPort } else { 8088 }
$exePath = $config.nodeBinaryPath

$rulePrefix = 'Ethernova Node Explorer'

function EnsureRule {
  param(
    [string]$Name,
    [hashtable]$Params
  )

  $existing = Get-NetFirewallRule -DisplayName $Name -ErrorAction SilentlyContinue
  if ($existing) {
    Write-Host "Rule exists: $Name"
    return
  }

  New-NetFirewallRule @Params | Out-Null
  Write-Host "Added rule: $Name"
}

EnsureRule -Name "$rulePrefix P2P TCP $port" -Params @{
  DisplayName = "$rulePrefix P2P TCP $port"
  Direction = 'Inbound'
  Action = 'Allow'
  Protocol = 'TCP'
  LocalPort = $port
  Profile = 'Any'
}

EnsureRule -Name "$rulePrefix P2P UDP $port" -Params @{
  DisplayName = "$rulePrefix P2P UDP $port"
  Direction = 'Inbound'
  Action = 'Allow'
  Protocol = 'UDP'
  LocalPort = $port
  Profile = 'Any'
}

EnsureRule -Name "$rulePrefix Dashboard TCP $webPort" -Params @{
  DisplayName = "$rulePrefix Dashboard TCP $webPort"
  Direction = 'Inbound'
  Action = 'Allow'
  Protocol = 'TCP'
  LocalPort = $webPort
  Profile = 'Any'
}

if ($exePath -and (Test-Path $exePath)) {
  EnsureRule -Name "$rulePrefix Node Binary" -Params @{
    DisplayName = "$rulePrefix Node Binary"
    Direction = 'Inbound'
    Action = 'Allow'
    Program = $exePath
    Profile = 'Any'
  }
} else {
  Write-Warning 'nodeBinaryPath is not set or does not exist. Program rule skipped.'
}



