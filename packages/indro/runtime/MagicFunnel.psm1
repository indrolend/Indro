Set-StrictMode -Version Latest

$script:DigitalBreakdownRoot = 'C:\Users\indro\Projects\db-enemy-motor-runtime'
$script:ProjectsRoot = 'C:\Users\indro\Projects'

function Get-MagicCommandState {
    param([Parameter(Mandatory)][string]$Name)
    $command = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
    [pscustomobject]@{
        Command = $Name
        Ready = $null -ne $command
        Path = if ($command) { $command.Source } else { $null }
    }
}

function Get-ProjectRepository {
    [CmdletBinding()]
    param()

    if (-not (Test-Path -LiteralPath $script:ProjectsRoot)) { return }
    Get-ChildItem -LiteralPath $script:ProjectsRoot -Directory -ErrorAction SilentlyContinue |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName '.git') } |
        Sort-Object Name
}

function Enter-Project {
    [CmdletBinding()]
    param([Parameter(Position = 0)][string]$Name)

    $repositories = @(Get-ProjectRepository)
    if ($repositories.Count -eq 0) { throw "No Git repositories found in $script:ProjectsRoot." }

    if (-not $Name -and (Get-Command fzf -ErrorAction SilentlyContinue)) {
        $Name = $repositories.Name | fzf --prompt='project> ' --height=40% --reverse
        if (-not $Name) { return }
    }
    if (-not $Name) {
        $repositories | Select-Object Name, FullName | Format-Table -AutoSize
        return
    }

    $matches = @($repositories | Where-Object { $_.Name -like "*$Name*" })
    if ($matches.Count -ne 1) {
        $matches | Select-Object Name, FullName | Format-Table -AutoSize
        if ($matches.Count -eq 0) { throw "No repository matches '$Name'." }
        throw "More than one repository matches '$Name'; use a more specific name."
    }
    Set-Location -LiteralPath $matches[0].FullName
}

function Enter-DigitalBreakdown {
    [CmdletBinding()]
    param()
    if (-not (Test-Path -LiteralPath $script:DigitalBreakdownRoot)) {
        throw "Digital Breakdown authority is missing: $script:DigitalBreakdownRoot"
    }
    Set-Location -LiteralPath $script:DigitalBreakdownRoot
}

function Invoke-DBDev {
    [CmdletBinding()]
    param(
        [Parameter(Position = 0)][string]$Command = 'status',
        [Parameter(ValueFromRemainingArguments = $true)][object[]]$RemainingArguments
    )
    $entrypoint = Join-Path $script:DigitalBreakdownRoot 'tools\dbdev.ps1'
    if (-not (Test-Path -LiteralPath $entrypoint)) { throw "Missing developer entrypoint: $entrypoint" }
    if ($RemainingArguments) { & $entrypoint $Command @RemainingArguments }
    else { & $entrypoint $Command }
}

function Show-WorkstationFunnel {
    [CmdletBinding()]
    param()

    $repoReady = Test-Path -LiteralPath (Join-Path $script:DigitalBreakdownRoot '.git')
    $commands = 'git','gh','rg','fd','fzf','jq','node','npm','cmake','codex','starship','docker','wsl' |
        ForEach-Object { Get-MagicCommandState $_ }

    Write-Host 'MAGIC FUNNEL' -ForegroundColor Magenta
    Write-Host ("PowerShell       {0}" -f $PSVersionTable.PSVersion)
    Write-Host ("Digital Breakdown {0}" -f $(if ($repoReady) { 'ready' } else { 'missing' }))
    Write-Host ("Core commands     {0}/{1} ready" -f @($commands | Where-Object Ready).Count, $commands.Count)
    Write-Host ''
    Write-Host 'Fast paths' -ForegroundColor Cyan
    Write-Host '  status           repo status
  audit            authority + scope evidence
  save             non-destructive checkpoint
  verify           diffcheck + build + tests + smoke + scope
  play             verify + launch
  agent            local Qwen playtest
  ship             verify + Windows package
  handoff          portable workspace evidence ZIP
  db               lower-level repo command'
    Write-Host '  db doctor        environment diagnosis'
    Write-Host '  db desktop-build native build'
    Write-Host '  db desktop-test  gameplay verification'
    Write-Host '  db playtest      build and launch'
    Write-Host '  cdb              enter Digital Breakdown authority'
    Write-Host '  cproj [name]     fuzzy-enter a local repository'
    Write-Host '  wdoctor          full workstation readiness table'
}

function Test-WorkstationFunnel {
    [CmdletBinding()]
    param()

    $commands = 'git','gh','rg','fd','fzf','jq','node','npm','cmake','codex','starship','docker','wsl' |
        ForEach-Object { Get-MagicCommandState $_ }
    $commands | Format-Table Command, Ready, Path -AutoSize

    Write-Host ''
    Write-Host 'Project authority' -ForegroundColor Cyan
    [pscustomobject]@{
        Name = 'Digital Breakdown'
        Ready = Test-Path -LiteralPath (Join-Path $script:DigitalBreakdownRoot 'tools\dbdev.ps1')
        Path = $script:DigitalBreakdownRoot
    } | Format-Table -AutoSize
}

Set-Alias -Name db -Value Invoke-DBDev
Set-Alias -Name cdb -Value Enter-DigitalBreakdown
Set-Alias -Name cproj -Value Enter-Project
Set-Alias -Name magic -Value Show-WorkstationFunnel
Set-Alias -Name wdoctor -Value Test-WorkstationFunnel

Export-ModuleMember -Function Get-ProjectRepository,Enter-Project,Enter-DigitalBreakdown,Invoke-DBDev,Show-WorkstationFunnel,Test-WorkstationFunnel -Alias db,cdb,cproj,magic,wdoctor

# INDRO: one stable development intention = one word.
# These verbs intentionally do not commit, push, merge, rebase, or clean implicitly.
function status { Invoke-DBDev status }
function audit { Invoke-DBDev audit }
function save { Invoke-DBDev checkpoint }
function verify { Invoke-DBDev verify }
function build { Invoke-DBDev desktop-build }
function test { Invoke-DBDev desktop-test }
function smoke { Invoke-DBDev desktop-smoke }
function play { Invoke-DBDev play }
function doctor { Invoke-DBDev doctor }
function agent {
    [CmdletBinding()]
    param(
        [ValidateRange(1,1000)][int]$Turns = 30,
        [ValidateSet('qwen2.5:7b','phi3:latest')][string]$Model = 'qwen2.5:7b'
    )
    Invoke-DBDev agent -Turns $Turns -Model $Model
}
function ship { Invoke-DBDev ship }
function handoff {
    [CmdletBinding()]
    param([string]$Path = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'workspace-handoff.zip'))
    Invoke-DBDev checkpoint
    $temp = Join-Path $env:TEMP ('db-handoff-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $temp | Out-Null
    try {
        & git -C $script:DigitalBreakdownRoot archive --format=zip --output=(Join-Path $temp 'db-tracked.zip') HEAD
        & git -C $script:DigitalBreakdownRoot diff --binary | Set-Content -Encoding UTF8 (Join-Path $temp 'db-working.diff')
        & git -C $script:DigitalBreakdownRoot status --porcelain=v2 --branch | Set-Content -Encoding UTF8 (Join-Path $temp 'db-status.txt')
        Copy-Item -LiteralPath $PSCommandPath -Destination (Join-Path $temp 'MagicFunnel.psm1')
        if (Test-Path -LiteralPath $PROFILE) { Copy-Item -LiteralPath $PROFILE -Destination (Join-Path $temp 'Microsoft.PowerShell_profile.ps1') }
        Compress-Archive -Path (Join-Path $temp '*') -DestinationPath $Path -Force
        Write-Host "HANDOFF_OK path=$Path" -ForegroundColor Green
    } finally { Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue }
}

Export-ModuleMember -Function status,audit,save,verify,build,test,smoke,play,doctor,agent,ship,handoff
