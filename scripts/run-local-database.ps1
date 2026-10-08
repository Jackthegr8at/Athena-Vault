param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("migrate", "verify", "integration")]
  [string]$Action,
  [string]$EnvironmentFile = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$environmentPath = if ([string]::IsNullOrWhiteSpace($EnvironmentFile)) {
  Join-Path $projectRoot ".env.local"
} else {
  [System.IO.Path]::GetFullPath($EnvironmentFile)
}
$databaseBin = Join-Path $projectRoot "packages\database\node_modules\.bin"
$localTsxPath = Join-Path $databaseBin "tsx.CMD"
$sharedMigrationCatalogPath = Join-Path $projectRoot "scripts\docker\migration-catalog.ts"
$migrationRunnerPath = Join-Path $projectRoot "scripts\docker\migrate.ts"
$expectedMigrationCatalog = @(
  "0000_current_schema_baseline.sql"
)

if (-not (Test-Path -LiteralPath $environmentPath -PathType Leaf)) {
  throw "Missing .env.local. Local database commands require the ignored local environment file."
}

$values = @{}
foreach ($line in Get-Content -LiteralPath $environmentPath) {
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

foreach ($name in @("DATABASE_URL", "ATHENA_DB_PASSWORD", "ATHENA_BUNDLED_NODE_BIN", "ATHENA_BUNDLED_FALLBACK_BIN")) {
  if (-not $values.ContainsKey($name) -or [string]::IsNullOrWhiteSpace([string]$values[$name])) {
    throw "Missing required local database configuration: $name."
  }
}

$bundledNodeBin = [string]$values["ATHENA_BUNDLED_NODE_BIN"]
$bundledNodePath = Join-Path $bundledNodeBin "node.exe"
$bundledFallbackBin = [string]$values["ATHENA_BUNDLED_FALLBACK_BIN"]
$bundledPnpmPath = Join-Path $bundledFallbackBin "pnpm.cmd"

$databaseUrl = [string]$values["DATABASE_URL"]
$databasePassword = [string]$values["ATHENA_DB_PASSWORD"]
if (($Action -eq "migrate" -or $Action -eq "verify" -or $Action -eq "integration") -and $values.ContainsKey("ATHENA_MIGRATOR_DATABASE_URL") -and -not [string]::IsNullOrWhiteSpace([string]$values["ATHENA_MIGRATOR_DATABASE_URL"])) {
  $databaseUrl = [string]$values["ATHENA_MIGRATOR_DATABASE_URL"]
  if (-not $values.ContainsKey("ATHENA_MIGRATOR_PASSWORD") -or [string]::IsNullOrWhiteSpace([string]$values["ATHENA_MIGRATOR_PASSWORD"])) {
    throw "ATHENA_MIGRATOR_PASSWORD is required for the migrator database connection."
  }
  $databasePassword = [string]$values["ATHENA_MIGRATOR_PASSWORD"]
}
if ($databaseUrl.Contains('$ATHENA_DB_PASSWORD')) {
  $encodedPassword = [Uri]::EscapeDataString([string]$values["ATHENA_DB_PASSWORD"])
  $databaseUrl = $databaseUrl.Replace('$ATHENA_DB_PASSWORD', $encodedPassword)
}
if ($databaseUrl.Contains('${ATHENA_DB_PASSWORD}')) {
  $encodedPassword = [Uri]::EscapeDataString([string]$values["ATHENA_DB_PASSWORD"])
  $databaseUrl = $databaseUrl.Replace('${ATHENA_DB_PASSWORD}', $encodedPassword)
}
if ($databaseUrl.Contains('$ATHENA_MIGRATOR_PASSWORD')) {
  if (-not $values.ContainsKey("ATHENA_MIGRATOR_PASSWORD") -or [string]::IsNullOrWhiteSpace([string]$values["ATHENA_MIGRATOR_PASSWORD"])) {
    throw "ATHENA_MIGRATOR_PASSWORD is required when ATHENA_MIGRATOR_DATABASE_URL uses its placeholder."
  }
  $encodedMigratorPassword = [Uri]::EscapeDataString([string]$values["ATHENA_MIGRATOR_PASSWORD"])
  $databaseUrl = $databaseUrl.Replace('$ATHENA_MIGRATOR_PASSWORD', $encodedMigratorPassword)
}
if ($databaseUrl.Contains('${ATHENA_MIGRATOR_PASSWORD}')) {
  if (-not $values.ContainsKey("ATHENA_MIGRATOR_PASSWORD") -or [string]::IsNullOrWhiteSpace([string]$values["ATHENA_MIGRATOR_PASSWORD"])) {
    throw "ATHENA_MIGRATOR_PASSWORD is required when ATHENA_MIGRATOR_DATABASE_URL uses its placeholder."
  }
  $encodedMigratorPassword = [Uri]::EscapeDataString([string]$values["ATHENA_MIGRATOR_PASSWORD"])
  $databaseUrl = $databaseUrl.Replace('${ATHENA_MIGRATOR_PASSWORD}', $encodedMigratorPassword)
}

$env:DATABASE_URL = $databaseUrl
$env:ATHENA_DB_PASSWORD = [string]$values["ATHENA_DB_PASSWORD"]
if ($values.ContainsKey("ATHENA_AUTH_ROLE_PASSWORD") -and -not [string]::IsNullOrWhiteSpace([string]$values["ATHENA_AUTH_ROLE_PASSWORD"])) {
  $env:ATHENA_AUTH_ROLE_PASSWORD = [string]$values["ATHENA_AUTH_ROLE_PASSWORD"]
}
$originalPath = $env:PATH

Push-Location $projectRoot
try {
  if (-not (Test-Path -LiteralPath $bundledNodePath -PathType Leaf)) {
    throw "Bundled Node.js was not found at the configured local runtime path."
  }
  if ($Action -eq "integration" -and -not (Test-Path -LiteralPath $bundledPnpmPath -PathType Leaf)) {
    throw "Bundled pnpm was not found at the configured local runtime path."
  }
  if ($Action -eq "migrate" -and -not (Test-Path -LiteralPath $localTsxPath -PathType Leaf)) {
    throw "Workspace-local tsx was not found under packages/database/node_modules/.bin."
  }
  if ($Action -eq "verify" -and -not (Test-Path -LiteralPath $localTsxPath -PathType Leaf)) {
    throw "Workspace-local tsx was not found under packages/database/node_modules/.bin."
  }

  $env:PATH = "$bundledNodeBin;$bundledFallbackBin;$databaseBin;$env:PATH"

  if ($Action -eq "migrate") {
    if (-not (Test-Path -LiteralPath $sharedMigrationCatalogPath -PathType Leaf)) {
      throw "Shared migration catalog script was not found."
    }
    if (-not (Test-Path -LiteralPath $migrationRunnerPath -PathType Leaf)) {
      throw "Shared migration runner was not found."
    }

    $catalog = @(& $localTsxPath $sharedMigrationCatalogPath "--format=filenames" 2>$null | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ })
    if ($LASTEXITCODE -ne 0) {
      throw "Shared migration catalog cross-check failed."
    }
    if ((@($catalog) -join "`n") -ne (@($expectedMigrationCatalog) -join "`n")) {
      throw "Shared migration catalog filenames do not match the guarded Windows runner."
    }
    Write-Output "migration-catalog=verified count=$($catalog.Count)"

    & $localTsxPath $migrationRunnerPath
    if ($LASTEXITCODE -ne 0) {
      exit $LASTEXITCODE
    }
  }
  elseif ($Action -eq "integration") {
    & $bundledPnpmPath --filter "@athena/database" test
    if ($LASTEXITCODE -ne 0) {
      exit $LASTEXITCODE
    }
  }
  elseif ($Action -eq "verify") {
    $verificationPath = Join-Path $projectRoot "scripts\docker\verify-database.ts"
    if (-not (Test-Path -LiteralPath $verificationPath -PathType Leaf)) {
      throw "Public database verifier was not found."
    }
    & $localTsxPath $verificationPath
    if ($LASTEXITCODE -ne 0) {
      exit $LASTEXITCODE
    }
  }
}
finally {
  $env:PATH = $originalPath
  $env:PGPASSWORD = $null
  $env:DATABASE_URL = $null
  $env:ATHENA_DB_PASSWORD = $null
  $env:ATHENA_AUTH_ROLE_PASSWORD = $null
  Pop-Location
}
