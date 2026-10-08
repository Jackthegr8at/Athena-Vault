<#
.SYNOPSIS
Starts the Athena Vault Docker Desktop development stack safely.

.DESCRIPTION
Requires the ignored .env.docker file, validates the Docker daemon, renders
the root development Compose configuration, and starts only postgres,
migrations, and web. It never removes or recreates named volumes.
#>

[CmdletBinding()]
param(
  [string]$EnvironmentFile = "",
  [string]$DockerExecutable = ""
)

. (Join-Path $PSScriptRoot "dev-common.ps1")

$context = Initialize-DockerDevelopmentContext -EnvironmentFile $EnvironmentFile -DockerExecutable $DockerExecutable
Invoke-DockerDevelopmentCompose -Context $context -ComposeArguments @("config", "--quiet")
Write-Output "Development Compose configuration verified."

Invoke-DockerDevelopmentCompose -Context $context -ComposeArguments @("up", "--detach", "--build", "postgres", "migrations", "web")
Write-Output "Development services started: postgres, migrations, web."
Invoke-DockerDevelopmentCompose -Context $context -ComposeArguments @("ps")
