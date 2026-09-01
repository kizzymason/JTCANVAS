# Seeds the proxy pool with the Thordata residential gateway.
#
# Credentials go into the database (a gitignored Docker volume) rather than
# into source control, so this is a setup step rather than a shipped default.
#
# The payload lives in proxy-pool.seed.json and is read and posted as raw UTF-8
# bytes: Windows PowerShell 5.1 reads BOM-less scripts as ANSI and re-encodes
# request bodies as latin-1, either of which turns the Chinese labels to mojibake.
#
#   $env:THORDATA_GATEWAY='host:port'
#   $env:THORDATA_USER='customer-user'
#   $env:THORDATA_PASS='password'
#   powershell -ExecutionPolicy Bypass -File scripts\seed-proxy-pool.ps1
param(
  [string]$Api = 'http://localhost:3001/api',
  [string]$Gateway = $env:THORDATA_GATEWAY,
  [string]$User = $env:THORDATA_USER,
  [string]$Pass = $env:THORDATA_PASS
)

$ErrorActionPreference = 'Stop'

if (-not $Gateway -or -not $User -or -not $Pass) {
  throw 'Set THORDATA_GATEWAY, THORDATA_USER and THORDATA_PASS, or pass -Gateway/-User/-Pass explicitly.'
}

$template = [System.IO.File]::ReadAllText(
  (Join-Path $PSScriptRoot 'proxy-pool.seed.json'),
  [System.Text.Encoding]::UTF8
)
$json = $template.Replace('__USER__', $User).Replace('__PASS__', $Pass).Replace('__GATEWAY__', $Gateway)

$saved = Invoke-RestMethod -Method Put -Uri "$Api/settings" `
  -ContentType 'application/json; charset=utf-8' `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($json))

$pool = $saved.settings.proxyPool
Write-Host "pool enabled : $($pool.enabled)"
Write-Host "strategy     : $($pool.strategy)"
foreach ($entry in $pool.entries) {
  $mark = if ($entry.enabled) { 'x' } else { ' ' }
  # Labels are non-ASCII; the console codepage would mangle them on the way out.
  Write-Host ("  [{0}] {1}" -f $mark, $entry.id)
}
Write-Host "`nOpen http://localhost:3000/settings to review, or run the pool test:"
Write-Host "  Invoke-RestMethod -Method Post -Uri $Api/settings/proxy-test -TimeoutSec 300"
