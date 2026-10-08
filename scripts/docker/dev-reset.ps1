<#
.SYNOPSIS
Destructively resets only explicitly named Athena Vault development volumes.

.DESCRIPTION
This helper is intentionally separate from dev-down. It requires
-ConfirmReset, validates ten development volume names in the
athena-vault-dev-* namespace, stops the development stack without Compose
volume cleanup, and removes only existing volumes from that exact allowlist.
It refuses production, native, and unscoped volume names.
#>

[CmdletBinding()]
param(
  [string]$EnvironmentFile = "",
  [string]$DockerExecutable = "",
  [switch]$ConfirmReset
)

. (Join-Path $PSScriptRoot "dev-common.ps1")

if (-not $ConfirmReset) {
  throw "Destructive reset refused. Re-run with -ConfirmReset after verifying the development volume names."
}

$context = Initialize-DockerDevelopmentContext -EnvironmentFile $EnvironmentFile -DockerExecutable $DockerExecutable
$volumeNames = @(Get-DevelopmentVolumeNames -EnvironmentFile $context.EnvironmentFile)
$existingVolumes = @(& $context.DockerExecutable volume ls --format "{{.Name}}")
if ($LASTEXITCODE -ne 0) {
  throw "Unable to list Docker volumes."
}

$volumesToRemove = @($volumeNames | Where-Object { $existingVolumes -contains $_ })
if ($volumesToRemove.Count -eq 0) {
  Write-Output "No approved development volumes exist; nothing was reset."
  return
}

Invoke-DockerDevelopmentCompose -Context $context -ComposeArguments @("down", "--remove-orphans")
& $context.DockerExecutable volume rm @volumesToRemove
if ($LASTEXITCODE -ne 0) {
  throw "Development volume reset failed."
}
Write-Output "Removed only approved development volumes: $($volumesToRemove -join ', ')."
