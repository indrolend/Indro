Set-StrictMode -Version Latest

$script:ProjectsRoot = if ($env:INDRO_PROJECTS_ROOT) { $env:INDRO_PROJECTS_ROOT } else { Join-Path $HOME 'Projects' }
$script:DataGameRoot = if ($env:INDRO_DATA_GAME_ROOT) { $env:INDRO_DATA_GAME_ROOT } else { Join-Path $script:ProjectsRoot 'data-game' }
$script:DataGameToolsRoot = if ($env:INDRO_DATA_GAME_TOOLS_ROOT) { $env:INDRO_DATA_GAME_TOOLS_ROOT } else { Join-Path $script:ProjectsRoot 'data-game-tools' }
$script:IndroRoot = if ($env:INDRO_ROOT) { $env:INDRO_ROOT } else { Join-Path $script:ProjectsRoot 'Indro' }

function Get-MagicCommandState {
    param([Parameter(Mandatory)][string]$Name)
    $command = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
    [pscustomobject]@{
        Command = $Name
        Ready = $null -ne $command
        Path = if ($command) { $command.Source } else { $null }
    }
}

function Invoke-CommandHud {
    [CmdletBinding()]
    param([Parameter(ValueFromRemainingArguments = $true)][object[]]$RemainingArguments)

    $cli = Join-Path $script:IndroRoot 'packages\commandhud\cli.mjs'
    if (-not (Test-Path -LiteralPath $cli)) { throw "CommandHUD authority is missing: $cli" }
    $node = Get-Command node -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $node) { throw 'CommandHUD requires Node.js.' }
    & $node.Source $cli @RemainingArguments
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
    if (-not (Test-Path -LiteralPath $script:DataGameRoot)) {
        throw "Data authority is missing: $script:DataGameRoot"
    }
    Set-Location -LiteralPath $script:DataGameRoot
}

function Enter-DataGameTools {
    [CmdletBinding()]
    param()
    if (-not (Test-Path -LiteralPath $script:DataGameToolsRoot)) {
        throw "Data Game Tools authority is missing: $script:DataGameToolsRoot"
    }
    Set-Location -LiteralPath $script:DataGameToolsRoot
}

function Invoke-DBDev {
    [CmdletBinding()]
    param(
        [Parameter(Position = 0)][ValidateSet('status','configure','build','test','smoke','evidence')][string]$Command = 'status',
        [Parameter(ValueFromRemainingArguments = $true)][object[]]$RemainingArguments
    )
    $entrypoint = Join-Path $script:DataGameToolsRoot 'Invoke-DataGame.ps1'
    if (-not (Test-Path -LiteralPath $entrypoint)) { throw "Missing Data Game Tools entrypoint: $entrypoint" }
    if ($RemainingArguments) {
        & $entrypoint -GameRoot $script:DataGameRoot -Action $Command @RemainingArguments
    } else {
        & $entrypoint -GameRoot $script:DataGameRoot -Action $Command
    }
}

function Invoke-Dev {
    [CmdletBinding()]
    param(
        [Parameter(Position = 0)][string]$Action = 'help',
        [Parameter(ValueFromRemainingArguments = $true)][object[]]$RemainingArguments
    )
    $entrypoint = Join-Path $script:DataGameToolsRoot 'Dev.ps1'
    if (-not (Test-Path -LiteralPath $entrypoint)) { throw "Missing SSH-first development entrypoint: $entrypoint" }
    if ($RemainingArguments) {
        & $entrypoint $Action @RemainingArguments
    } else {
        & $entrypoint $Action
    }
}

function Show-WorkstationFunnel {
    [CmdletBinding()]
    param()

    $repoReady = Test-Path -LiteralPath (Join-Path $script:DataGameRoot '.git')
    $toolsReady = Test-Path -LiteralPath (Join-Path $script:DataGameToolsRoot 'Invoke-DataGame.ps1')
    $commands = 'git','gh','rg','fd','fzf','jq','node','npm','cmake','codex','starship','docker','wsl' |
        ForEach-Object { Get-MagicCommandState $_ }

    Write-Host 'MAGIC FUNNEL' -ForegroundColor Magenta
    Write-Host ("PowerShell       {0}" -f $PSVersionTable.PSVersion)
    Write-Host ("Data             {0}" -f $(if ($repoReady) { 'ready' } else { 'missing' }))
    Write-Host ("Data Game Tools  {0}" -f $(if ($toolsReady) { 'ready' } else { 'missing' }))
    Write-Host ("Core commands     {0}/{1} ready" -f @($commands | Where-Object Ready).Count, $commands.Count)
    Write-Host ''
    Write-Host 'Fast paths' -ForegroundColor Cyan
    Write-Host '  status           exact Data revision and dirty state'
    Write-Host '  build            configure and build Data'
    Write-Host '  test             build and run Data tests'
    Write-Host '  smoke            build and run the product smoke test'
    Write-Host '  evidence         run enemy-obstruction visual evidence'
    Write-Host '  db <action>      status|configure|build|test|smoke|evidence'
    Write-Host '  dev <action>     SSH-safe status|projects|worktrees|build|tests|evidence|doctor'
    Write-Host '  cdb              enter Data product authority'
    Write-Host '  cdtools          enter Data Game Tools authority'
    Write-Host '  cproj [name]     fuzzy-enter a local repository'
    Write-Host '  hudremote        status|start|stop|restart|ui for the CommandHUD Remote tunnel'
    Write-Host '  wdoctor          full workstation readiness table'
    Write-Host '  daily            workstation readiness + INDRO/Data state and probes'
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
        Name = 'Data'
        Ready = Test-Path -LiteralPath (Join-Path $script:DataGameRoot 'CMakeLists.txt')
        Path = $script:DataGameRoot
    } | Format-Table -AutoSize
}

function Invoke-DailyDevelopment {
    [CmdletBinding()]
    param([switch]$PassThru)

    $started = [System.Diagnostics.Stopwatch]::StartNew()
    $originalLocation = (Get-Location).Path
    $results = [System.Collections.Generic.List[object]]::new()

    Test-WorkstationFunnel | Out-Host
    if (-not (Get-Command hud -ErrorAction SilentlyContinue)) {
        throw 'CommandHUD is unavailable. Load the workstation PowerShell profile before running daily.'
    }

    foreach ($project in @(
        [pscustomobject]@{ Name = 'INDRO'; Root = $script:IndroRoot },
        [pscustomobject]@{ Name = 'DIGITAL BREAKDOWN'; Root = $script:DataGameRoot }
    )) {
        Write-Host ''
        Write-Host $project.Name -ForegroundColor Cyan

        $stateOutput = & hud --root $project.Root state 2>&1
        $stateExit = $LASTEXITCODE
        $stateOutput | ForEach-Object { Write-Host $_ }
        $doctorOutput = & hud --root $project.Root doctor 2>&1
        $doctorExit = $LASTEXITCODE
        $doctorOutput | ForEach-Object { Write-Host $_ }
        $results.Add([pscustomobject]@{
            Project = $project.Name
            Root = $project.Root
            StateExitCode = $stateExit
            DoctorExitCode = $doctorExit
            Ready = $stateExit -eq 0 -and $doctorExit -eq 0
        })
    }

    if ((Get-Location).Path -ne $originalLocation) {
        throw "daily changed the caller's working directory from $originalLocation to $((Get-Location).Path)."
    }

    $started.Stop()
    $ready = @($results | Where-Object Ready).Count
    $status = if ($ready -eq $results.Count) { 'PASS' } else { 'ATTENTION' }
    Write-Host ''
    Write-Host ("DAILY {0} repositories={1}/{2} elapsed={3:N1}s" -f $status, $ready, $results.Count, $started.Elapsed.TotalSeconds) -ForegroundColor $(if ($status -eq 'PASS') { 'Green' } else { 'Yellow' })
    $summary = [pscustomobject]@{
        Status = $status
        ReadyRepositories = $ready
        RepositoryCount = $results.Count
        DurationMs = [math]::Round($started.Elapsed.TotalMilliseconds)
        Projects = @($results)
    }
    $global:LASTEXITCODE = if ($status -eq 'PASS') { 0 } else { 1 }
    if ($PassThru) { $summary }
}

Set-Alias -Name db -Value Invoke-DBDev
Set-Alias -Name dev -Value Invoke-Dev
Set-Alias -Name hud -Value Invoke-CommandHud
Set-Alias -Name cdb -Value Enter-DigitalBreakdown
Set-Alias -Name cdtools -Value Enter-DataGameTools
Set-Alias -Name cproj -Value Enter-Project
Set-Alias -Name magic -Value Show-WorkstationFunnel
Set-Alias -Name wdoctor -Value Test-WorkstationFunnel
Set-Alias -Name daily -Value Invoke-DailyDevelopment

function Get-CommandHudRemoteRoot {
    <#
        Locates the CommandHUD Remote repository under the projects root by
        the presence of its operator control script, rather than a hardcoded
        path, so this module keeps working if the repository moves.
    #>
    [CmdletBinding()]
    param()
    if (-not (Test-Path -LiteralPath $script:ProjectsRoot)) { return $null }
    Get-ChildItem -LiteralPath $script:ProjectsRoot -Directory -ErrorAction SilentlyContinue |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'plugins\commandhud-remote\service\CommandHudRemoteControl.ps1') } |
        Select-Object -First 1 -ExpandProperty FullName
}

function Invoke-CommandHudRemote {
    <#
        Bounded status/start/stop/restart/ui operator surface for CommandHUD
        Remote's durable tunnel service, dispatched to the repository-owned
        control script; this module does not duplicate its logic.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Position = 0)][ValidateSet('status', 'start', 'stop', 'restart', 'ui')]
        [string]$Action = 'status'
    )
    $root = Get-CommandHudRemoteRoot
    if (-not $root) { throw "CommandHUD Remote repository was not found under $script:ProjectsRoot." }
    & (Join-Path $root 'plugins\commandhud-remote\service\CommandHudRemoteControl.ps1') $Action
}

Set-Alias -Name hudremote -Value Invoke-CommandHudRemote

Export-ModuleMember -Function Get-CommandHudRemoteRoot,Invoke-CommandHudRemote -Alias hudremote

Export-ModuleMember -Function Get-ProjectRepository,Enter-Project,Enter-DigitalBreakdown,Enter-DataGameTools,Invoke-CommandHud,Invoke-DBDev,Invoke-Dev,Show-WorkstationFunnel,Test-WorkstationFunnel,Invoke-DailyDevelopment -Alias hud,db,dev,cdb,cdtools,cproj,magic,wdoctor,daily

# INDRO: one stable development intention = one word.
# These verbs intentionally do not commit, push, merge, rebase, or clean implicitly.
function status { Invoke-DBDev status }
function build { Invoke-DBDev build }
function test { Invoke-DBDev test }
function smoke { Invoke-DBDev smoke }
function evidence { Invoke-DBDev evidence }

Export-ModuleMember -Function status,build,test,smoke,evidence
