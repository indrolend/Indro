[CmdletBinding()]
param(
    [ValidateSet('Check', 'Install')][string]$Action = 'Check',
    [string]$Destination = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'PowerShell\Modules\MagicFunnel\MagicFunnel.psm1'),
    [string]$ProfilePath = $PROFILE,
    [string]$BackupRoot = (Join-Path $env:LOCALAPPDATA 'Indro\backups\MagicFunnel'),
    [ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedInstalledSha256,
    [switch]$Json
)

$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'MagicFunnel.psm1'
$destinationDirectory = Split-Path -Parent $Destination
$metadataPath = Join-Path $destinationDirectory '.indro-source.json'
$profileImport = 'Import-Module MagicFunnel -ErrorAction Stop'

function Get-Sha256([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Read-Metadata {
    if (-not (Test-Path -LiteralPath $metadataPath -PathType Leaf)) { return $null }
    try { Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json }
    catch { return $null }
}

function Test-ProfileImport {
    if (-not (Test-Path -LiteralPath $ProfilePath -PathType Leaf)) { return $false }
    [bool](Select-String -LiteralPath $ProfilePath -Pattern '^\s*Import-Module\s+MagicFunnel(?:\s|$)' -Quiet)
}

function Get-SourceCommit {
    $repository = Resolve-Path (Join-Path $PSScriptRoot '..\..\..')
    $commit = & git -C $repository rev-parse HEAD 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    $commit.Trim()
}

function Get-State {
    $sourceHash = Get-Sha256 $source
    $installedHash = Get-Sha256 $Destination
    $metadata = Read-Metadata
    $profileReady = Test-ProfileImport
    $status = if (-not $installedHash) {
        'MISSING'
    } elseif ($installedHash -eq $sourceHash -and -not $profileReady) {
        'PROFILE_MISSING'
    } elseif ($installedHash -eq $sourceHash) {
        'CURRENT'
    } elseif ($metadata -and $metadata.installedSha256 -eq $installedHash) {
        'UPDATE_AVAILABLE'
    } else {
        'LOCALLY_MODIFIED'
    }
    [pscustomobject]@{
        schema = 'indro.magic-funnel-installation/v1'
        status = $status
        source = $source
        sourceSha256 = $sourceHash
        sourceCommit = Get-SourceCommit
        destination = $Destination
        installedSha256 = $installedHash
        metadata = $metadataPath
        metadataValid = [bool]($metadata -and $metadata.schema -eq 'indro.magic-funnel-source/v1' -and $metadata.installedSha256 -eq $installedHash)
        profile = $ProfilePath
        profileReady = $profileReady
    }
}

$tokens = $null
$parseErrors = $null
[System.Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$parseErrors) | Out-Null
if ($parseErrors.Count) { throw "MagicFunnel source parse failed: $($parseErrors.Message -join '; ')" }

$before = Get-State
if ($Action -eq 'Check') {
    if ($Json) { $before | ConvertTo-Json -Depth 5 -Compress }
    else { $before | Format-List }
    if ($before.status -ne 'CURRENT') { exit 2 }
    exit 0
}

if ($before.status -eq 'LOCALLY_MODIFIED') {
    if (-not $ExpectedInstalledSha256 -or $ExpectedInstalledSha256.ToLowerInvariant() -ne $before.installedSha256) {
        throw "Installed MagicFunnel differs from both source and its last recorded installation: $Destination"
    }
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $BackupRoot $timestamp
if ($before.installedSha256 -and $before.installedSha256 -ne $before.sourceSha256) {
    New-Item -ItemType Directory -Force -Path $backup | Out-Null
    Copy-Item -LiteralPath $Destination -Destination (Join-Path $backup 'MagicFunnel.psm1')
}
if ((Test-Path -LiteralPath $ProfilePath) -and -not $before.profileReady) {
    New-Item -ItemType Directory -Force -Path $backup | Out-Null
    Copy-Item -LiteralPath $ProfilePath -Destination (Join-Path $backup 'Microsoft.PowerShell_profile.ps1')
}

New-Item -ItemType Directory -Force -Path $destinationDirectory | Out-Null
$temporary = Join-Path $destinationDirectory ('.MagicFunnel-' + [guid]::NewGuid().ToString('N') + '.psm1')
Copy-Item -LiteralPath $source -Destination $temporary
if ((Get-Sha256 $temporary) -ne $before.sourceSha256) { throw 'Temporary MagicFunnel copy failed digest verification.' }
Move-Item -LiteralPath $temporary -Destination $Destination -Force

if (-not (Test-Path -LiteralPath $ProfilePath)) {
    New-Item -ItemType File -Force -Path $ProfilePath | Out-Null
}
if (-not (Test-ProfileImport)) { Add-Content -LiteralPath $ProfilePath -Value "`n$profileImport" }

$installedHash = Get-Sha256 $Destination
if ($installedHash -ne $before.sourceSha256) { throw 'Installed MagicFunnel digest does not match its source.' }
$metadata = [ordered]@{
    schema = 'indro.magic-funnel-source/v1'
    sourceRepository = 'indrolend/Indro'
    sourceRelativePath = 'packages/indro/runtime/MagicFunnel.psm1'
    sourceCommit = $before.sourceCommit
    sourceSha256 = $before.sourceSha256
    installedSha256 = $installedHash
    installedAt = (Get-Date).ToUniversalTime().ToString('o')
}
$metadata | ConvertTo-Json | Set-Content -LiteralPath $metadataPath -Encoding utf8NoBOM

$after = Get-State
if ($after.status -ne 'CURRENT' -or -not $after.metadataValid) { throw "MagicFunnel installation verification failed: $($after.status)" }
if ($Json) { $after | ConvertTo-Json -Depth 5 -Compress }
else { $after | Format-List }
exit 0
