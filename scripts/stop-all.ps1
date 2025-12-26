$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$dataDir = Join-Path $root 'data'

$pidFiles = @(
  (Join-Path $dataDir 'node.pid'),
  (Join-Path $dataDir 'collector.pid')
)

foreach ($pidFile in $pidFiles) {
  if (Test-Path $pidFile) {
    $pid = Get-Content $pidFile | Select-Object -First 1
    if ($pid) {
      try {
        Stop-Process -Id $pid -Force -ErrorAction Stop
        Write-Host "Stopped PID $pid"
      } catch {
        Write-Warning "Failed to stop PID $pid"
      }
    }
    Remove-Item $pidFile -Force
  }
}


