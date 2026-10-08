<#
.SYNOPSIS
Runs read-only HTTP smoke checks against the active Athena Vault web service.

.DESCRIPTION
Requests the approved application routes, prints only route/status metadata,
and fails on any non-200 response. Response bodies are never printed.
#>

[CmdletBinding()]
param(
  [string]$EnvironmentFile = "",
  [string]$BaseUrl = ""
)

. (Join-Path $PSScriptRoot "dev-common.ps1")

if ([string]::IsNullOrWhiteSpace($EnvironmentFile)) {
  $EnvironmentFile = Join-Path $script:AthenaProjectRoot ".env.docker"
}
$EnvironmentFile = [System.IO.Path]::GetFullPath($EnvironmentFile)
if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
  $values = Read-DockerEnvironmentValues -Path $EnvironmentFile
  $hostName = if ([string]::IsNullOrWhiteSpace([string]$values["ATHENA_DEV_WEB_BIND_HOST"])) { "127.0.0.1" } else { [string]$values["ATHENA_DEV_WEB_BIND_HOST"] }
  $port = if ([string]::IsNullOrWhiteSpace([string]$values["ATHENA_DEV_WEB_HOST_PORT"])) { "3000" } else { [string]$values["ATHENA_DEV_WEB_HOST_PORT"] }
  $BaseUrl = "http://$hostName`:$port"
}

$routes = @("/", "/accounts", "/home", "/annual-expenses", "/cash-flow", "/investments", "/goals", "/salaries", "/projects", "/api/health")
foreach ($route in $routes) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl$route" -TimeoutSec 30
  } catch {
    throw "HTTP smoke check failed for $route."
  }
  if ([int]$response.StatusCode -ne 200) { throw "HTTP smoke check returned a non-200 status for $route." }
  Write-Output "route=$route status=$([int]$response.StatusCode)"
}
Write-Output "http-smoke=status=passed base=$BaseUrl"
