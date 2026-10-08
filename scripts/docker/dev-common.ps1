<#
.SYNOPSIS
Provides shared safety helpers for the Windows Docker development scripts.

.DESCRIPTION
Resolves Docker Desktop, requires the ignored .env.docker file, renders only
root development Compose files, and validates development-only volume names.
The helpers never read or print secret values.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$script:AthenaProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$script:AthenaBaseComposeFile = Join-Path $script:AthenaProjectRoot "docker-compose.yml"
$script:AthenaDevelopmentComposeFile = Join-Path $script:AthenaProjectRoot "docker-compose.dev.yml"
$script:AthenaDevelopmentDatabasePortComposeFile = Join-Path $script:AthenaProjectRoot "docker-compose.dev-db-port.yml"

function Read-DockerEnvironmentValues {
  param(
    [Parameter(Mandatory)][string]$Path
  )

  $values = @{}
  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
    $separator = $trimmed.IndexOf("=")
    if ($separator -le 0) { continue }
    $name = $trimmed.Substring(0, $separator).Trim()
    $value = $trimmed.Substring($separator + 1).Trim()
    if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    $values[$name] = $value
  }
  return $values
}

function Resolve-DockerExecutable {
  param(
    [string]$RequestedPath = ""
  )

  $candidate = $RequestedPath
  if ([string]::IsNullOrWhiteSpace($candidate)) {
    $command = Get-Command docker.exe -ErrorAction SilentlyContinue
    if ($null -ne $command) {
      $candidate = $command.Source
      if ([string]::IsNullOrWhiteSpace($candidate)) { $candidate = $command.Path }
    } else {
      $candidate = Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\resources\bin\docker.exe"
    }
  }

  if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
    throw "Docker executable was not found. Install Docker Desktop or pass -DockerExecutable explicitly."
  }

  $resolvedPath = (Resolve-Path -LiteralPath $candidate).Path
  $dockerDirectory = Split-Path -Parent $resolvedPath
  $pathEntries = @($env:PATH -split [System.IO.Path]::PathSeparator)
  if (-not ($pathEntries | Where-Object { $_ -eq $dockerDirectory })) {
    $env:PATH = "$dockerDirectory$([System.IO.Path]::PathSeparator)$env:PATH"
  }

  & $resolvedPath version *> $null
  if ($LASTEXITCODE -ne 0) {
    throw "Docker Desktop is unavailable or the Docker daemon is not ready."
  }

  return $resolvedPath
}

function Initialize-DockerDevelopmentContext {
  param(
    [string]$EnvironmentFile = "",
    [string]$DockerExecutable = ""
  )

  $environmentPath = if ([string]::IsNullOrWhiteSpace($EnvironmentFile)) {
    Join-Path $script:AthenaProjectRoot ".env.docker"
  } else {
    [System.IO.Path]::GetFullPath($EnvironmentFile)
  }

  if (-not (Test-Path -LiteralPath $environmentPath -PathType Leaf)) {
    throw "Missing .env.docker. Copy .env.docker.example to .env.docker and configure local values first."
  }

  if (-not (Test-Path -LiteralPath $script:AthenaBaseComposeFile -PathType Leaf) -or -not (Test-Path -LiteralPath $script:AthenaDevelopmentComposeFile -PathType Leaf)) {
    throw "The root Docker Compose development files are missing."
  }

  $environmentValues = Read-DockerEnvironmentValues -Path $environmentPath
  $publishDatabasePortValue = [string]$environmentValues["ATHENA_DEV_DB_PUBLISH_PORT"]
  if ([string]::IsNullOrWhiteSpace($publishDatabasePortValue)) { $publishDatabasePortValue = "false" }
  if ($publishDatabasePortValue -notmatch '^(?i:true|false)$') {
    throw "ATHENA_DEV_DB_PUBLISH_PORT must be true or false."
  }
  $publishDatabasePort = $publishDatabasePortValue -eq "true"
  if ($publishDatabasePort -and -not (Test-Path -LiteralPath $script:AthenaDevelopmentDatabasePortComposeFile -PathType Leaf)) {
    throw "The optional development database-port Compose override is missing."
  }

  $resolvedDocker = Resolve-DockerExecutable -RequestedPath $DockerExecutable
  return [pscustomobject]@{
    DockerExecutable = $resolvedDocker
    EnvironmentFile = $environmentPath
    BaseComposeFile = $script:AthenaBaseComposeFile
    DevelopmentComposeFile = $script:AthenaDevelopmentComposeFile
    DevelopmentDatabasePortComposeFile = $script:AthenaDevelopmentDatabasePortComposeFile
    PublishDevelopmentDatabasePort = $publishDatabasePort
  }
}

function Invoke-DockerDevelopmentCompose {
  param(
    [Parameter(Mandatory)][pscustomobject]$Context,
    [Parameter(Mandatory)][string[]]$ComposeArguments
  )

  $arguments = @(
    "compose",
    "--env-file", $Context.EnvironmentFile,
    "-f", $Context.BaseComposeFile,
    "-f", $Context.DevelopmentComposeFile
  )
  if ($Context.PublishDevelopmentDatabasePort) {
    $arguments += @("-f", $Context.DevelopmentDatabasePortComposeFile)
  }
  $arguments += $ComposeArguments

  & $Context.DockerExecutable @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Docker Compose command failed with exit code $LASTEXITCODE."
  }
}

function Get-DevelopmentVolumeNames {
  param(
    [Parameter(Mandatory)][string]$EnvironmentFile
  )

  $values = Read-DockerEnvironmentValues -Path $EnvironmentFile
  $defaults = [ordered]@{
    ATHENA_DEV_POSTGRES_VOLUME_NAME = "athena-vault-dev-postgres"
    ATHENA_DEV_BACKUP_VOLUME_NAME = "athena-vault-dev-backups"
    ATHENA_DEV_NODE_MODULES_VOLUME_NAME = "athena-vault-dev-node-modules"
    ATHENA_DEV_WEB_NODE_MODULES_VOLUME_NAME = "athena-vault-dev-web-node-modules"
    ATHENA_DEV_DATABASE_NODE_MODULES_VOLUME_NAME = "athena-vault-dev-database-node-modules"
    ATHENA_DEV_FINANCE_NODE_MODULES_VOLUME_NAME = "athena-vault-dev-finance-node-modules"
    ATHENA_DEV_UI_NODE_MODULES_VOLUME_NAME = "athena-vault-dev-ui-node-modules"
    ATHENA_DEV_VALIDATION_NODE_MODULES_VOLUME_NAME = "athena-vault-dev-validation-node-modules"
    ATHENA_DEV_PNPM_STORE_VOLUME_NAME = "athena-vault-dev-pnpm-store"
    ATHENA_DEV_NEXT_VOLUME_NAME = "athena-vault-dev-next"
  }

  $names = @($defaults.GetEnumerator() | ForEach-Object {
    $value = [string]$values[$_.Key]
    if ([string]::IsNullOrWhiteSpace($value)) { $value = $_.Value }
    $value
  })

  if ($names.Count -ne 10 -or (@($names | Select-Object -Unique).Count -ne 10)) {
    throw "Development volume configuration must contain exactly ten unique volume names."
  }

  foreach ($name in $names) {
    if ($name -notmatch '^athena-vault-dev-[a-z0-9-]+$') {
      throw "Refusing a development volume name outside the athena-vault-dev-* namespace."
    }
  }

  return $names
}
