<#
.SYNOPSIS
Stops the Athena Vault Docker Desktop development stack without deleting data.

.DESCRIPTION
Requires the ignored .env.docker file, validates Docker and the development
Compose configuration, and stops/removes only the development containers and
network. It intentionally never passes --volumes or removes named volumes.
#>

[CmdletBinding()]
param(
  [string]$EnvironmentFile = "",
  [string]$DockerExecutable = ""
)

. (Join-Path $PSScriptRoot "dev-common.ps1")

$context = Initialize-DockerDevelopmentContext -EnvironmentFile $EnvironmentFile -DockerExecutable $DockerExecutable
Invoke-DockerDevelopmentCompose -Context $context -ComposeArguments @("config", "--quiet")
Invoke-DockerDevelopmentCompose -Context $context -ComposeArguments @("down", "--remove-orphans")
Write-Output "Development containers and network stopped; named volumes were preserved."
