<#
db-setup.ps1 — creates the `vantage` database and the three roles on the local PostgreSQL 17 service, idempotently.

Why it exists: LLD §2 — roles are created once, by the operator, never by the app. This script is the
only place they are defined (tools/db-setup.sql holds the SQL) and what the boot self-test checks
against. The database is created first (the SQL file hands it to vantage_owner and revokes TEMP from
PUBLIC, so it must exist). It never guesses passwords: the superuser password comes from $env:PGPASSWORD
or -SuperPassword, or the script explains and exits 2. Role passwords are generated on first run and
written to .env (git-ignored) as the three connection strings; on later runs existing passwords are left
alone unless you pass them explicitly, so an existing .env keeps working.

What it must never do: overwrite an existing .env without -Force, print the superuser password, or grant
table privileges (apps/api/migrations/grants.sql does that when `npm run migrate` runs as the owner).

Usage:
  $env:PGPASSWORD = '<postgres superuser password>'
  .\tools\db-setup.ps1                      # first run: creates database + roles, writes .env
  .\tools\db-setup.ps1 -AppPassword x ...   # set specific role passwords
#>
[CmdletBinding()]
param(
  [string]$PgBin = 'C:\Program Files\PostgreSQL\17\bin',
  [string]$PgHost = '127.0.0.1',
  [int]$PgPort = 5432,
  [string]$SuperUser = 'postgres',
  [string]$SuperPassword = $env:PGPASSWORD,
  [string]$Database = 'vantage',
  [string]$OwnerPassword,
  [string]$AppPassword,
  [string]$ReaderPassword,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$psql = Join-Path $PgBin 'psql.exe'
$sqlFile = Join-Path $PSScriptRoot 'db-setup.sql'
$envFile = Join-Path $repoRoot '.env'

if (-not (Test-Path $psql)) {
  Write-Error "psql not found at $psql. Pass -PgBin to point at your PostgreSQL 17 bin directory."
  exit 2
}
if ([string]::IsNullOrEmpty($SuperPassword)) {
  Write-Host 'No superuser password provided. This script never guesses passwords.' -ForegroundColor Yellow
  Write-Host 'Provide it one of two ways, then run again:'
  Write-Host "  `$env:PGPASSWORD = '<password for $SuperUser>'; .\tools\db-setup.ps1"
  Write-Host "  .\tools\db-setup.ps1 -SuperPassword '<password for $SuperUser>'"
  exit 2
}
$env:PGPASSWORD = $SuperPassword

function Invoke-Psql {
  param([string[]]$Arguments)
  # stderr is deliberately not redirected: under Windows PowerShell 5.1 a native command's stderr line becomes a
  # terminating error when redirected with $ErrorActionPreference = 'Stop', so psql's notices would abort the script.
  $output = & $psql -X -v ON_ERROR_STOP=1 -h $PgHost -p $PgPort -U $SuperUser @Arguments
  if ($LASTEXITCODE -ne 0) { throw "psql failed with exit code $LASTEXITCODE (see the message above)" }
  return $output
}

function New-RandomSecret {
  $bytes = New-Object byte[] 24
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return ([Convert]::ToBase64String($bytes)).Replace('+', '-').Replace('/', '_').Replace('=', '')
}

$dbExists = ((Invoke-Psql @('-d', 'postgres', '-tAc', "SELECT 1 FROM pg_database WHERE datname = '$Database'")) -join '') -eq '1'
if (-not $dbExists) {
  Write-Host "Creating database $Database (db-setup.sql hands it to vantage_owner)"
  # UTF8 explicitly: a Windows cluster's default is the ANSI code page (WIN1252), which cannot store arbitrary event data.
  Invoke-Psql @('-d', 'postgres', '-c', "CREATE DATABASE $Database ENCODING 'UTF8' TEMPLATE template0") | Out-Null
} else {
  Write-Host "Database $Database already exists; leaving its contents alone"
}

# Passwords: explicit > (first creation: generated) > (existing role, nothing passed: leave alone).
$ownerExists = ((Invoke-Psql @('-d', 'postgres', '-tAc', "SELECT 1 FROM pg_roles WHERE rolname = 'vantage_owner'")) -join '') -eq '1'
$anyPasswordGiven = -not ([string]::IsNullOrEmpty($OwnerPassword) -and [string]::IsNullOrEmpty($AppPassword) -and [string]::IsNullOrEmpty($ReaderPassword))
$setPasswords = (-not $ownerExists) -or $anyPasswordGiven
if ($setPasswords) {
  if ([string]::IsNullOrEmpty($OwnerPassword))  { $OwnerPassword  = New-RandomSecret }
  if ([string]::IsNullOrEmpty($AppPassword))    { $AppPassword    = New-RandomSecret }
  if ([string]::IsNullOrEmpty($ReaderPassword)) { $ReaderPassword = New-RandomSecret }
}

Write-Host "Applying $sqlFile as $SuperUser@$PgHost`:$PgPort (roles, database owner, TEMP revoke; passwords $(if ($setPasswords) { 'set' } else { 'left unchanged' }))"
$vars = @('-v', "set_passwords=$(if ($setPasswords) { '1' } else { '0' })", '-v', "database=$Database",
          '-v', "owner_password=$OwnerPassword", '-v', "app_password=$AppPassword", '-v', "reader_password=$ReaderPassword")
Invoke-Psql (@('-d', 'postgres', '-q', '-f', $sqlFile) + $vars) | Out-Null

if ($setPasswords) {
  $lines = @(
    '# Written by tools/db-setup.ps1. Git-ignored. Rotate by re-running with -OwnerPassword/-AppPassword/-ReaderPassword.',
    "VANTAGE_DATABASE_URL_OWNER=postgres://vantage_owner:$OwnerPassword@$PgHost`:$PgPort/$Database",
    "VANTAGE_DATABASE_URL_RW=postgres://vantage_app:$AppPassword@$PgHost`:$PgPort/$Database",
    "VANTAGE_DATABASE_URL_RO=postgres://vantage_reader:$ReaderPassword@$PgHost`:$PgPort/$Database",
    'VANTAGE_BIND=127.0.0.1',
    'VANTAGE_PORT=4100'
  )
  if ((Test-Path $envFile) -and -not $Force) {
    Write-Host ".env already exists and -Force was not given; NOT overwriting it. Update these lines yourself:" -ForegroundColor Yellow
    $lines | Select-Object -Skip 1 | ForEach-Object { Write-Host "  $_" }
  } else {
    [System.IO.File]::WriteAllLines($envFile, $lines, (New-Object System.Text.UTF8Encoding $false))
    Write-Host "Wrote $envFile with the three connection strings."
  }
}

Write-Host ''
Write-Host 'Next: npm run build; npm run migrate   (applies apps/api/migrations as vantage_owner and grants table privileges)'
Write-Host '      npm run start:api                (boots, runs the role self-test, listens on 127.0.0.1:4100)'
