Set-StrictMode -Version Latest

$script:WorkspaceFile = Join-Path $PSScriptRoot 'workspaces\workspaces.json'
$script:WordFile = Join-Path $PSScriptRoot 'words.json'
$script:ActiveWorkspace = $null
$script:LastRun = $null
$script:PrimitiveWords = @(
    'status','audit','checkpoint','save','verify','build','test','smoke','play','doctor',
    'agent','diffcheck','ship','dogfood','suggest','bench','languagebench','crosscheck','selftest','evidence'
)
$script:Consequential = @('commit','push','merge','rebase','reset','clean','release','publish','ship')

function Get-IndroConfig {
    Get-Content $script:WorkspaceFile -Raw | ConvertFrom-Json
}

function Get-IndroWords {
    Get-Content $script:WordFile -Raw | ConvertFrom-Json
}

function Get-IndroWorkspace {
    param([string]$Name)
    $config = Get-IndroConfig
    if (-not $Name) {
        $Name = if ($script:ActiveWorkspace) { $script:ActiveWorkspace } else { $config.default }
    }
    $workspace = $config.workspaces.$Name
    if (-not $workspace) { throw "Unknown workspace '$Name'." }
    $workspace
}

function Get-IndroEvidenceRoot {
    $config = Get-IndroConfig
    if ($env:INDRO_EVIDENCE_ROOT) { return $env:INDRO_EVIDENCE_ROOT }
    if ($config.evidenceRoot -and (Test-Path -LiteralPath $config.evidenceRoot)) { return $config.evidenceRoot }
    if ($env:LOCALAPPDATA) { return (Join-Path $env:LOCALAPPDATA 'CommandHUD') }
    return (Join-Path $HOME '.local\state\commandhud')
}

function Get-IndroPython {
    $python = Get-Command python -ErrorAction SilentlyContinue
    if ($python) { return [pscustomobject]@{ Command = $python.Source; Prefix = @() } }
    $py = Get-Command py -ErrorAction SilentlyContinue
    if ($py) { return [pscustomobject]@{ Command = $py.Source; Prefix = @('-3') } }
    throw 'Python 3 is required for dogfood/bench/selftest.'
}

function Invoke-IndroPython {
    param([Parameter(Mandatory)][string]$Script,[string[]]$Arguments=@())
    $python = Get-IndroPython
    & $python.Command @($python.Prefix) $Script @Arguments
    if ($LASTEXITCODE -is [int] -and $LASTEXITCODE -ne 0) {
        throw "Python tool failed with exit code ${LASTEXITCODE}: $Script"
    }
}

function Compile-IndroProgram {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Source,
        [string[]]$Set = @(),
        [ValidateSet('read','write','exec','network','publish')][string[]]$AllowEffect = @(),
        [string]$Entry = 'main',
        [switch]$Check
    )
    $arguments = @((Join-Path $PSScriptRoot 'indro_lang.py'), $Source, '--entry', $Entry)
    foreach ($binding in $Set) { $arguments += @('--set', $binding) }
    foreach ($effect in $AllowEffect) { $arguments += @('--allow-effect', $effect) }
    if ($Check) { $arguments += '--check' }
    $python = Get-IndroPython
    & $python.Command @($python.Prefix) @arguments
    if ($LASTEXITCODE -is [int] -and $LASTEXITCODE -ne 0) {
        throw "Indro compilation failed with exit code ${LASTEXITCODE}: $Source"
    }
}

function Get-IndroProofPlan {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string[]]$Required,
        [Parameter(Mandatory)][string]$State,
        [string]$Cache
    )
    $arguments = @((Join-Path $PSScriptRoot 'indro_proof.py')) + $Required + @('--state', $State)
    if ($Cache) { $arguments += @('--cache', $Cache) }
    $python = Get-IndroPython
    & $python.Command @($python.Prefix) @arguments
    if ($LASTEXITCODE -is [int] -and $LASTEXITCODE -ne 0) {
        throw "Indro proof planning failed with exit code ${LASTEXITCODE}: $($Required -join ', ')"
    }
}

function Get-HudLatest {
    $root = Get-IndroEvidenceRoot
    $runs = Join-Path $root 'runs'
    if (-not (Test-Path -LiteralPath $runs)) { return $null }
    Get-ChildItem $runs -Filter run.json -File -Recurse -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
}

function Resolve-IndroPlan {
    param(
        [Parameter(Mandatory)][string]$Word,
        [object]$Definitions = $null,
        [string[]]$Stack = @(),
        [switch]$AllowConsequential
    )
    if (-not $Definitions) { $Definitions = Get-IndroWords }
    if ($Word -in $Stack) { throw "Indro word cycle: $($Stack + $Word -join ' -> ')" }
    if ($script:PrimitiveWords -contains $Word) {
        if (($Word -in $script:Consequential) -and -not $AllowConsequential) {
            throw "Composite words may not imply consequential '$Word'. Invoke it explicitly."
        }
        return ,$Word
    }
    $definition = $Definitions.words.$Word
    if (-not $definition) { throw "Unknown Indro word '$Word'. Run: words" }
    $plan = @()
    foreach ($step in @($definition.steps)) {
        $parts = @($step -split '\s+' | Where-Object { $_ })
        if ($parts.Count -eq 0) { continue }
        $verb = $parts[0]
        if ($parts.Count -gt 1) {
            if ($Definitions.words.$verb) {
                throw "Composite step '$step' cannot pass arguments to composite '$verb'; flatten it or make '$verb' primitive."
            }
            if ($verb -in $script:Consequential) {
                throw "Composite word '$Word' may not imply consequential '$verb'."
            }
            $plan += ,$step
            continue
        }
        $nested = Resolve-IndroPlan -Word $verb -Definitions $Definitions -Stack ($Stack + $Word)
        $plan += @($nested)
    }
    return $plan
}

function Start-IndroRun {
    param([string]$Word,[object]$Workspace,[string[]]$Args,[string[]]$Plan)
    $root = Get-IndroEvidenceRoot
    $dir = Join-Path $root ('indro\runs\' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '-' + $Word)
    New-Item -ItemType Directory -Force $dir | Out-Null
    $hud = Get-HudLatest
    $run = [ordered]@{
        schemaVersion = 3
        word = $Word
        args = @($Args)
        plan = @($Plan)
        started = (Get-Date).ToString('o')
        workspace = $Workspace.name
        root = $Workspace.root
        hudBefore = if ($hud) { $hud.FullName } else { $null }
    }
    if (Test-Path -LiteralPath (Join-Path $Workspace.root '.git')) {
        $run.headBefore = (& git -C $Workspace.root rev-parse HEAD 2>$null)
        $run.statusBefore = @(& git -C $Workspace.root status --porcelain=v2 --branch 2>$null)
    }
    $run | ConvertTo-Json -Depth 12 | Set-Content -Encoding utf8 (Join-Path $dir 'run.json')
    $dir
}

function Complete-IndroRun {
    param([string]$Dir,[object]$Workspace,[bool]$Ok,[string]$ErrorText='')
    $path = Join-Path $Dir 'run.json'
    $run = Get-Content $path -Raw | ConvertFrom-Json
    $hud = Get-HudLatest
    $run | Add-Member ended (Get-Date).ToString('o') -Force
    $run | Add-Member ok $Ok -Force
    $run | Add-Member error $ErrorText -Force
    $run | Add-Member hudAfter $(if ($hud) { $hud.FullName } else { $null }) -Force
    if (Test-Path -LiteralPath (Join-Path $Workspace.root '.git')) {
        $run | Add-Member headAfter (& git -C $Workspace.root rev-parse HEAD 2>$null) -Force
        $run | Add-Member statusAfter @(& git -C $Workspace.root status --porcelain=v2 --branch 2>$null) -Force
    }
    $run | ConvertTo-Json -Depth 12 | Set-Content -Encoding utf8 $path
    $script:LastRun = $Dir
}

function Use-Indro {
    param([string]$Workspace='db')
    $resolved = Get-IndroWorkspace $Workspace
    $script:ActiveWorkspace = $Workspace
    Set-Location -LiteralPath $resolved.root
    Write-Host "INDRO workspace=$Workspace root=$($resolved.root)" -ForegroundColor Cyan
}

function Invoke-IndroPrimitive {
    param([object]$Workspace,[string]$Command,[string[]]$Args=@())
    $dbdev = Join-Path $Workspace.root $Workspace.dbdev
    $workspaceFree = @('dogfood','suggest','bench','languagebench','crosscheck','selftest','evidence')
    if ($Command -notin $workspaceFree -and -not (Test-Path -LiteralPath $dbdev)) {
        throw "Missing workspace runtime: $dbdev"
    }
    switch ($Command) {
        'status' { & $dbdev status }
        'audit' { & $dbdev audit }
        'checkpoint' { & $dbdev checkpoint }
        'save' { & $dbdev checkpoint }
        'verify' { & $dbdev verify }
        'build' { & $dbdev desktop-build }
        'test' { & $dbdev desktop-test }
        'smoke' { & $dbdev desktop-smoke }
        'play' { & $dbdev play }
        'doctor' { & $dbdev doctor }
        'ship' { & $dbdev ship }
        'agent' {
            $turns = 30
            $model = $Workspace.agent
            foreach ($arg in $Args) {
                if ($arg -match '^\d+$') { $turns = [int]$arg }
                elseif ($arg) { $model = $arg }
            }
            & $dbdev agent -Model $model -Turns $turns
        }
        'diffcheck' {
            & git -C $Workspace.root diff --check
            if ($LASTEXITCODE) { throw 'diffcheck failed' }
        }
        'evidence' {
            $latest = Get-HudLatest
            if ($latest) { Get-Content $latest.FullName -Raw }
            else { Write-Host 'No CommandHUD run.json found.' }
        }
        'dogfood' {
            Invoke-IndroPython -Script (Join-Path $PSScriptRoot 'tools\mine-hud.py') -Arguments @((Get-IndroEvidenceRoot))
        }
        'suggest' {
            Invoke-IndroPython -Script (Join-Path $PSScriptRoot 'tools\suggest-words.py') -Arguments @((Get-IndroEvidenceRoot))
        }
        'bench' {
            Invoke-IndroPython -Script (Join-Path $PSScriptRoot 'tools\benchmark-hud.py') -Arguments @((Get-IndroEvidenceRoot))
        }
        'languagebench' {
            Invoke-IndroPython -Script (Join-Path $PSScriptRoot 'tools\benchmark-language.py') -Arguments @((Get-IndroEvidenceRoot))
        }
        'crosscheck' {
            Invoke-IndroPython -Script (Join-Path $PSScriptRoot 'tools\crosscheck-hud.py') -Arguments @((Get-IndroEvidenceRoot))
        }
        'selftest' {
            Invoke-IndroPython -Script (Join-Path $PSScriptRoot 'tools\test-all.py')
        }
        default { throw "Unknown primitive '$Command'." }
    }
    if ($LASTEXITCODE -is [int] -and $LASTEXITCODE -ne 0) {
        throw "$Command failed with exit code $LASTEXITCODE"
    }
}

function Invoke-IndroWord {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory,Position=0)][string]$Word,
        [Parameter(Position=1,ValueFromRemainingArguments=$true)][string[]]$Args
    )
    $workspace = Get-IndroWorkspace
    $definitions = Get-IndroWords
    $isPrimitive = $script:PrimitiveWords -contains $Word
    $plan = if ($isPrimitive) { @($Word) } else { @(Resolve-IndroPlan -Word $Word -Definitions $definitions) }
    $runDir = Start-IndroRun -Word $Word -Workspace $workspace -Args $Args -Plan $plan
    try {
        foreach ($step in $plan) {
            $parts = @($step -split '\s+' | Where-Object { $_ })
            $verb = $parts[0]
            $stepArgs = @($parts | Select-Object -Skip 1)
            if ($isPrimitive -and $plan.Count -eq 1) { $stepArgs = @($Args) }
            Invoke-IndroPrimitive -Workspace $workspace -Command $verb -Args $stepArgs
        }
        Complete-IndroRun -Dir $runDir -Workspace $workspace -Ok $true
        Write-Host "INDRO_OK word=$Word evidence=$runDir" -ForegroundColor Green
    }
    catch {
        Complete-IndroRun -Dir $runDir -Workspace $workspace -Ok $false -ErrorText $_.Exception.Message
        Write-Host "INDRO_FAIL word=$Word evidence=$runDir" -ForegroundColor Red
        throw
    }
}

function Show-IndroPlan {
    param([Parameter(Mandatory)][string]$Word)
    $definitions = Get-IndroWords
    $plan = if ($script:PrimitiveWords -contains $Word) { @($Word) } else { @(Resolve-IndroPlan -Word $Word -Definitions $definitions) }
    [pscustomobject]@{ Word = $Word; Steps = $plan.Count; Plan = ($plan -join ' -> ') }
}

function indro {
    param([string]$Word='status',[Parameter(ValueFromRemainingArguments=$true)][string[]]$Args)
    switch ($Word) {
        'use' { Use-Indro ($Args | Select-Object -First 1); return }
        'words' { words; return }
        'last' { last; return }
        'why' { why; return }
        'plan' { Show-IndroPlan ($Args | Select-Object -First 1); return }
        default { Invoke-IndroWord $Word $Args }
    }
}

function words {
    $definitions = Get-IndroWords
    $rows = @()
    foreach ($primitive in $script:PrimitiveWords | Sort-Object) {
        $rows += [pscustomobject]@{ Word=$primitive; Kind='primitive'; Meaning='runtime capability'; Steps=$primitive }
    }
    foreach ($property in $definitions.words.psobject.Properties | Sort-Object Name) {
        $rows += [pscustomobject]@{
            Word=$property.Name
            Kind='composite'
            Meaning=$property.Value.meaning
            Steps=(Resolve-IndroPlan -Word $property.Name -Definitions $definitions) -join ' -> '
        }
    }
    $rows | Format-Table -AutoSize
}

function last {
    if (-not $script:LastRun) {
        $root = Join-Path (Get-IndroEvidenceRoot) 'indro\runs'
        $latest = Get-ChildItem $root -Directory -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1
        if ($latest) { $script:LastRun = $latest.FullName }
    }
    if ($script:LastRun) { Get-Content (Join-Path $script:LastRun 'run.json') -Raw }
    else { 'No Indro run yet.' }
}

function why { last }

function Add-IndroWord {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string[]]$Steps,
        [string]$Meaning='user-defined workflow'
    )
    foreach ($step in $Steps) {
        $verb = ($step -split '\s+')[0]
        if ($verb -in $script:Consequential) {
            throw "Composite words cannot imply consequential '$verb'. Invoke it explicitly."
        }
    }
    $definitions = Get-IndroWords
    $definitions.words | Add-Member -NotePropertyName $Name -NotePropertyValue ([pscustomobject]@{meaning=$Meaning;steps=$Steps}) -Force
    # Resolve before writing so cycles/unknown words fail atomically.
    [void](Resolve-IndroPlan -Word $Name -Definitions $definitions)
    $definitions | ConvertTo-Json -Depth 12 | Set-Content -Encoding utf8 $script:WordFile
}

$script:OneWordExports = @(
    'status','audit','checkpoint','save','verify','build','test','smoke','play','doctor','agent','diffcheck',
    'ship','dogfood','suggest','bench','languagebench','crosscheck','selftest','evidence','orient','resume','prove','harden','recover','probe','mature','handoff','measure','learn'
)
foreach ($name in $script:OneWordExports) {
    Set-Item -Path "Function:$name" -Value ([scriptblock]::Create(
        "param([Parameter(ValueFromRemainingArguments=`$true)][string[]]`$Args) Invoke-IndroWord '$name' `$Args"
    ))
}

Export-ModuleMember -Function (@('indro','Use-Indro','Invoke-IndroWord','Compile-IndroProgram','Get-IndroProofPlan','Add-IndroWord','Show-IndroPlan','words','last','why') + $script:OneWordExports)
