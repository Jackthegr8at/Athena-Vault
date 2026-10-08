<#
.SYNOPSIS
Provides secret-safe PostgreSQL helpers for Docker copy and verification scripts.

.DESCRIPTION
Reads ignored environment files, resolves PostgreSQL connection metadata without
printing credentials, and invokes local PostgreSQL clients with process-local
password state.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$script:AthenaProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))

function Read-AthenaEnvironmentFile {
  param(
    [Parameter(Mandatory)][string]$Path
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Environment file not found."
  }

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

function Get-AthenaDatabaseConnection {
  param(
    [Parameter(Mandatory)][string]$EnvironmentFile
  )

  $values = Read-AthenaEnvironmentFile -Path $EnvironmentFile
  $template = [string]$values["DATABASE_URL"]
  $password = [string]$values["ATHENA_DB_PASSWORD"]
  if ([string]::IsNullOrWhiteSpace($template) -or [string]::IsNullOrWhiteSpace($password)) {
    throw "DATABASE_URL and ATHENA_DB_PASSWORD are required in the environment file."
  }

  $databaseUrl = $template.Replace('$ATHENA_DB_PASSWORD', [Uri]::EscapeDataString($password))
  try {
    $uri = [Uri]$databaseUrl
  } catch {
    throw "DATABASE_URL is not a usable PostgreSQL connection URL."
  }
  if ($uri.Scheme -notmatch '^postgres(?:ql)?$') {
    throw "DATABASE_URL must use PostgreSQL."
  }

  $userInfo = $uri.UserInfo.Split(":", 2)
  if ($userInfo.Length -lt 1 -or [string]::IsNullOrWhiteSpace($userInfo[0]) -or [string]::IsNullOrWhiteSpace($uri.AbsolutePath)) {
    throw "DATABASE_URL is missing a database user or database name."
  }

  $databaseName = [Uri]::UnescapeDataString($uri.AbsolutePath.TrimStart("/"))
  return [pscustomobject]@{
    Host = $uri.Host
    Port = if ($uri.Port -gt 0) { $uri.Port } else { 5432 }
    User = [Uri]::UnescapeDataString($userInfo[0])
    Database = $databaseName
    Password = $password
    DatabaseUrl = $databaseUrl
  }
}

function Resolve-AthenaPostgresExecutable {
  param(
    [Parameter(Mandatory)][string]$PostgresBin,
    [Parameter(Mandatory)][ValidateSet("psql", "pg_dump", "pg_restore")][string]$Name
  )

  $executable = Join-Path $PostgresBin "$Name.exe"
  if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
    throw "PostgreSQL client not found at $executable"
  }
  return $executable
}

function Invoke-AthenaPostgresProcess {
  param(
    [Parameter(Mandatory)][string]$Executable,
    [Parameter(Mandatory)][string[]]$Arguments,
    [Parameter(Mandatory)][string]$Password,
    [Parameter(Mandatory)][string]$Action
  )

  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $Executable
  $startInfo.UseShellExecute = $false
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.CreateNoWindow = $true
  $startInfo.Arguments = ($Arguments | ForEach-Object { '"' + $_.Replace('"', '\"') + '"' }) -join ' '

  $previousPassword = $env:PGPASSWORD
  try {
    $env:PGPASSWORD = $Password
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    [void]$process.Start()
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) {
      throw "$Action failed."
    }
    return $stdout.Trim()
  } finally {
    if ($null -eq $previousPassword) {
      Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    } else {
      $env:PGPASSWORD = $previousPassword
    }
  }
}

function Invoke-AthenaPsql {
  param(
    [Parameter(Mandatory)][pscustomobject]$Connection,
    [Parameter(Mandatory)][string]$Sql,
    [Parameter(Mandatory)][string]$PostgresBin
  )

  $psql = Resolve-AthenaPostgresExecutable -PostgresBin $PostgresBin -Name "psql"
  $arguments = @(
    "-X", "-v", "ON_ERROR_STOP=1", "-At", "-F", "|",
    "-h", [string]$Connection.Host,
    "-p", [string]$Connection.Port,
    "-U", [string]$Connection.User,
    "-d", [string]$Connection.Database,
    "-c", $Sql
  )
  return Invoke-AthenaPostgresProcess -Executable $psql -Arguments $arguments -Password $Connection.Password -Action "PostgreSQL query"
}
