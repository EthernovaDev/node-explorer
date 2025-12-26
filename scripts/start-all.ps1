param(
  [string]$ConfigPath = (Join-Path $PSScriptRoot '..\config\app.config.json')
)

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$collectorDir = Join-Path $root 'collector'

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  Write-Error 'Node.js is not installed or not in PATH. Install Node.js 20 LTS.'
  exit 1
}

$nodeVersion = node -v
$major = [int]($nodeVersion.TrimStart('v').Split('.')[0])
if ($major -lt 20) {
  Write-Error "Node.js 20+ required. Found $nodeVersion"
  exit 1
}

if (-not (Test-Path (Join-Path $collectorDir 'node_modules'))) {
  Write-Host 'Installing collector dependencies...'
  Push-Location $collectorDir
  npm install
  Pop-Location
}

& (Join-Path $PSScriptRoot 'start-node.ps1') -ConfigPath $ConfigPath
& (Join-Path $PSScriptRoot 'start-dashboard.ps1') -ConfigPath $ConfigPath


