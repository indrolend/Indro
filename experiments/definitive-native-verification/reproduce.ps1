[CmdletBinding()]
param(
    [string]$GameRoot = 'C:\Users\indro\Projects\data-game',
    [string]$BuildRoot = 'C:\Users\indro\Projects\data-game\build',
    [string]$IndroRoot = (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent),
    [string]$ExternalRoot = 'D:\hud\experiments\indro-definitive-native-verification',
    [string]$EvidenceKey = 'D:\hud\experiments\indro-definitive-native-verification\native-ed25519.pem',
    [int]$Repetitions = 5,
    [ValidateSet('benchmark','preflight','first')]
    [string]$Mode = 'benchmark'
)

$ErrorActionPreference = 'Stop'
$configuration = 'Release'
$session = Get-Date -Format 'yyyyMMdd-HHmmss'
$rawRoot = Join-Path $PSScriptRoot "raw\$session"
$storeRoot = Join-Path $ExternalRoot $session
$runsPath = Join-Path $PSScriptRoot 'runs.ndjson'
$cli = Join-Path $IndroRoot 'packages\indro\cli.mjs'
New-Item -ItemType Directory -Force -Path $rawRoot,$storeRoot | Out-Null

function Write-Record($Record) {
    $Record.session = $session
    $Record.timestampUtc = [DateTime]::UtcNow.ToString('o')
    $Record | ConvertTo-Json -Compress -Depth 12 | Add-Content -LiteralPath $runsPath -Encoding utf8
}

function Invoke-Captured {
    param([string]$Program,[string[]]$Arguments,[string]$WorkingDirectory,[string]$LogPath)
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $output = @(& $Program @Arguments 2>&1)
    $exitCode = $LASTEXITCODE
    $timer.Stop()
    $output | Set-Content -LiteralPath $LogPath -Encoding utf8
    [ordered]@{ exitCode=$exitCode; elapsedMs=$timer.Elapsed.TotalMilliseconds; output=@($output | ForEach-Object { "$_" }) }
}

function Invoke-Baseline([string]$Condition,[int]$Iteration) {
    $prefix = "${Condition}-${Iteration}"
    $total = [Diagnostics.Stopwatch]::StartNew()
    Push-Location $GameRoot
    try {
        $build = Invoke-Captured -Program cmake -Arguments @('--build',$BuildRoot,'--config',$configuration) -WorkingDirectory $GameRoot -LogPath (Join-Path $rawRoot "$prefix-build.log")
        $test = if ($build.exitCode -eq 0) {
            Invoke-Captured -Program ctest -Arguments @('--test-dir',$BuildRoot,'-C',$configuration,'--output-on-failure') -WorkingDirectory $GameRoot -LogPath (Join-Path $rawRoot "$prefix-ctest.log")
        } else { [ordered]@{ exitCode=$null; elapsedMs=0; output=@() } }
    } finally { Pop-Location }
    $total.Stop()
    $summary = ($test.output -join "`n")
    $passed = if ($summary -match '100% tests passed(?:, 0 tests failed)? out of (\d+)') { [int]$Matches[1] } else { $null }
    Write-Record ([ordered]@{
        kind='ordinary'; condition=$Condition; iteration=$Iteration; elapsedMs=$total.Elapsed.TotalMilliseconds
        buildMs=$build.elapsedMs; testMs=$test.elapsedMs; exitCode=if($build.exitCode -ne 0){$build.exitCode}else{$test.exitCode}
        testCount=$passed; cacheDecision='NONE'; evidenceId=$null
        subprocesses=@('cmake --build','ctest --output-on-failure',"$passed CTest test commands")
        logs=@("raw/$session/$prefix-build.log","raw/$session/$prefix-ctest.log")
    })
}

function Invoke-Indro([string]$Condition,[int]$Iteration,[string]$Store,[bool]$RestartProbe) {
    $prefix = "${Condition}-${Iteration}"
    $args = @($cli,'verify-native','--root',$GameRoot,'--build',$BuildRoot,'--store',$Store,
        '--configuration',$configuration,'--evidence-key',$EvidenceKey,'--declare-runtime-closure')
    Push-Location $IndroRoot
    try { $run = Invoke-Captured -Program node -Arguments $args -WorkingDirectory $IndroRoot -LogPath (Join-Path $rawRoot "$prefix-indro.log") }
    finally { Pop-Location }
    $jsonLine = $run.output | Where-Object { $_ -match '^\{.*\}$' } | Select-Object -Last 1
    $result = if ($jsonLine) { $jsonLine | ConvertFrom-Json } else { $null }
    $receipt = if ($result) { $result.receipt } else { $null }
    $subprocesses = @('node packages/indro/cli.mjs','cmake --build','git/ctest/cmake/tool fingerprint probes')
    if ($result.outcome -eq 'EXECUTED' -or $result.outcome -eq 'FAILED') { $subprocesses += @('ctest --output-on-failure',"$($result.testCount) CTest test commands") }
    Write-Record ([ordered]@{
        kind='indro'; condition=$Condition; iteration=$Iteration; elapsedMs=$run.elapsedMs
        buildMs=$result.buildMs; testMs=$result.testMs; exitCode=$run.exitCode; testCount=$result.testCount
        outcome=$result.outcome; cacheDecision=$result.reuseDecision; evidenceId=$receipt
        store=$Store; processRestart=$RestartProbe; subprocesses=$subprocesses
        logs=@("raw/$session/$prefix-indro.log")
    })
}

if ($Mode -eq 'preflight') {
    Invoke-Baseline 'preflight' 1
    exit $LASTEXITCODE
}

if ($Mode -eq 'first') {
    for ($i=1; $i -le $Repetitions; $i++) {
        Invoke-Indro 'B-fixed' $i (Join-Path $storeRoot "first-$i") $false
    }
    Copy-Item -LiteralPath $storeRoot -Destination (Join-Path $rawRoot 'receipts') -Recurse
    Write-Output "SESSION=$session"
    exit 0
}

for ($i=1; $i -le $Repetitions; $i++) {
    $store = Join-Path $storeRoot "iteration-$i"
    Invoke-Baseline 'A' $i
    Invoke-Indro 'B' $i $store $false
    Invoke-Indro 'C' $i $store $false
    Invoke-Baseline 'D' $i
    # Every CLI call starts a new Node process; this second hit explicitly probes durable reuse after exit.
    Invoke-Indro 'E' $i $store $true
}

Copy-Item -LiteralPath $storeRoot -Destination (Join-Path $rawRoot 'receipts') -Recurse
Write-Output "SESSION=$session"
Write-Output "RUNS=$runsPath"
Write-Output "RAW=$rawRoot"
