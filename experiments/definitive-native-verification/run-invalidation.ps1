[CmdletBinding()]
param(
    [string]$FixtureRoot = 'D:\hud\fixtures\data-game-definitive-20261026',
    [string]$BuildRoot = 'D:\hud\builds\data-game-definitive-20261026',
    [string]$ExternalRoot = 'D:\hud\experiments\indro-definitive-native-invalidation',
    [string]$EvidenceKey = 'D:\hud\experiments\indro-definitive-native-verification\native-ed25519.pem'
)

$ErrorActionPreference = 'Stop'
$indroRoot = (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent)
$cli = Join-Path $indroRoot 'packages\indro\cli.mjs'
$session = Get-Date -Format 'yyyyMMdd-HHmmss'
$raw = Join-Path $PSScriptRoot "raw\invalidation-$session"
$store = Join-Path $ExternalRoot "$session\store"
$missingStore = Join-Path $ExternalRoot "$session\missing-store"
$runtime = Join-Path $ExternalRoot "$session\declared-runtime.dat"
New-Item -ItemType Directory -Force -Path $raw,$store | Out-Null
[IO.File]::WriteAllBytes($runtime,[Text.Encoding]::UTF8.GetBytes('runtime-v1'))
$observations = [Collections.Generic.List[object]]::new()

function Invoke-Verify([string]$Name,[string]$UseStore=$store) {
    $timer=[Diagnostics.Stopwatch]::StartNew()
    $output=@(& node $cli verify-native --root $FixtureRoot --build $BuildRoot --store $UseStore `
        --configuration Release --runtime-file $runtime --evidence-key $EvidenceKey --declare-runtime-closure 2>&1)
    $exit=$LASTEXITCODE; $timer.Stop()
    $output | Set-Content -LiteralPath (Join-Path $raw "$Name.log") -Encoding utf8
    $line=$output|Where-Object {$_ -match '^\{.*\}$'}|Select-Object -Last 1
    $parsed=if($line){$line|ConvertFrom-Json}else{$null}
    [pscustomobject]@{name=$Name;exitCode=$exit;elapsedMs=$timer.Elapsed.TotalMilliseconds;result=$parsed;log="raw/invalidation-$session/$Name.log"}
}

function Add-Observation([string]$Mutation,[string]$Expected,$Run,[hashtable]$Extra=@{}) {
    $record=[ordered]@{mutation=$Mutation;expected=$Expected;observedOutcome=$Run.result.outcome;
        reuseDecision=$Run.result.reuseDecision;changedInputs=@($Run.result.changedInputs);changedExecutables=@($Run.result.changedExecutables);
        exitCode=$Run.exitCode;testCount=$Run.result.testCount;evidenceId=$Run.result.receipt;elapsedMs=$Run.elapsedMs;log=$Run.log}
    foreach($key in $Extra.Keys){$record[$key]=$Extra[$key]}
    $observations.Add([pscustomobject]$record)
}

$initial=Invoke-Verify '00-initial-execution'
Add-Observation 'initial evidence' 'EXECUTED' $initial
$unchanged=Invoke-Verify '01-unchanged-reuse'
Add-Observation 'no relevant changes' 'REUSED' $unchanged

$source=Join-Path $FixtureRoot 'tests\signal_residue_lifecycle_test.cpp'
$sourceBytes=[IO.File]::ReadAllBytes($source)
try {
    $text=[Text.Encoding]::UTF8.GetString($sourceBytes)
    $changed=[regex]::Replace($text,'return 0;\s*\}\s*$',"return 1;`n}",1)
    if($changed -eq $text){throw 'Unable to inject controlled failing return'}
    [IO.File]::WriteAllText($source,$changed,[Text.UTF8Encoding]::new($false))
    $run=Invoke-Verify '02-relevant-source-failure'
    Add-Observation 'relevant source changed to force test failure' 'FAILED; never REUSED' $run
} finally { [IO.File]::WriteAllBytes($source,$sourceBytes) }
$refresh=Invoke-Verify '02b-source-restored'
Add-Observation 'source restored' 'EXECUTED then reusable PASS' $refresh

$binary=Join-Path $BuildRoot 'Release\SignalResidueLifecycleTest.exe'
$binaryBytes=[IO.File]::ReadAllBytes($binary)
try {
    $stream=[IO.File]::Open($binary,[IO.FileMode]::Append,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try {$stream.WriteByte(0x42)} finally {$stream.Dispose()}
    $run=Invoke-Verify '03-binary-modified'
    Add-Observation 'test binary modified' 'EXECUTED; never REUSED' $run
} finally { [IO.File]::WriteAllBytes($binary,$binaryBytes) }
$refresh=Invoke-Verify '03b-binary-restored'
Add-Observation 'binary restored' 'EXECUTED then reusable PASS' $refresh

$cache=Join-Path $BuildRoot 'CMakeCache.txt'
$cacheBytes=[IO.File]::ReadAllBytes($cache)
try {
    [IO.File]::AppendAllText($cache,"`n// controlled verification-affecting generated-build mutation`n")
    $run=Invoke-Verify '04-build-instruction-modified'
    Add-Observation 'generated build cache/instruction changed' 'EXECUTED; never REUSED' $run
} finally { [IO.File]::WriteAllBytes($cache,$cacheBytes) }
$refresh=Invoke-Verify '04b-build-instruction-restored'
Add-Observation 'generated build instruction restored' 'EXECUTED then reusable PASS' $refresh

[IO.File]::WriteAllBytes($runtime,[Text.Encoding]::UTF8.GetBytes('runtime-v2'))
$run=Invoke-Verify '05-runtime-dependency-modified'
Add-Observation 'declared runtime dependency changed' 'EXECUTED; never REUSED' $run
[IO.File]::WriteAllBytes($runtime,[Text.Encoding]::UTF8.GetBytes('runtime-v1'))
$refresh=Invoke-Verify '05b-runtime-restored'
Add-Observation 'runtime dependency restored' 'EXECUTED then reusable PASS' $refresh

$latest=Get-ChildItem -LiteralPath $store -Filter '*.json'|Sort-Object Name|Select-Object -Last 1
$receiptBytes=[IO.File]::ReadAllBytes($latest.FullName)
try {
    $receiptText=[Text.Encoding]::UTF8.GetString($receiptBytes).Replace('"status": "PASS"','"status": "POSS"')
    [IO.File]::WriteAllText($latest.FullName,$receiptText,[Text.UTF8Encoding]::new($false))
    $run=Invoke-Verify '06-corrupt-evidence'
    Add-Observation 'newest evidence corrupted' 'EXECUTED with RECEIPT_HEAD_INVALID or RECEIPT_CORRUPT; never REUSED' $run
} finally { }

$run=Invoke-Verify '06b-missing-evidence' $missingStore
Add-Observation 'evidence store missing' 'EXECUTED with NO_RECEIPT; never REUSED' $run

$ctestFile=Join-Path $BuildRoot 'CTestTestfile.cmake'
$ctestBytes=[IO.File]::ReadAllBytes($ctestFile)
try {
    $ctestText=[Text.Encoding]::UTF8.GetString($ctestBytes)
    $old='add_test("SignalResidueLifecycleTest" "D:/hud/builds/data-game-definitive-20261026/Release/SignalResidueLifecycleTest.exe")'
    $new='add_test("SignalResidueLifecycleTest" "D:/hud/builds/data-game-definitive-20261026/Release/SecretTvPolicyTest.exe")'
    if(-not $ctestText.Contains($old)){throw 'Expected Release test registration not found'}
    [IO.File]::WriteAllText($ctestFile,$ctestText.Replace($old,$new),[Text.UTF8Encoding]::new($false))
    $run=Invoke-Verify '07-test-registration-modified'
    Add-Observation 'test registration changed while count stayed 57' 'EXECUTED; never REUSED' $run
} finally { [IO.File]::WriteAllBytes($ctestFile,$ctestBytes) }
$refresh=Invoke-Verify '07b-test-registration-restored'
Add-Observation 'test registration restored' 'EXECUTED then reusable PASS' $refresh

$unrelated=Join-Path $FixtureRoot 'experiment-unrelated.txt'
if(Test-Path $unrelated){throw "Unexpected fixture file exists: $unrelated"}
try {
    [IO.File]::WriteAllText($unrelated,'unrelated experiment file',[Text.UTF8Encoding]::new($false))
    $run=Invoke-Verify '08-unrelated-file-added'
    Add-Observation 'unrelated untracked file added' 'Determine whether reuse remains safe' $run
} finally { Remove-Item -LiteralPath $unrelated }

$finalReceipt=Get-ChildItem -LiteralPath $store -Filter '*.json'|Sort-Object Name|Select-Object -Last 1
$finalBytes=[IO.File]::ReadAllBytes($finalReceipt.FullName)
$writePermitted=$false
try {
    $handle=[IO.File]::Open($finalReceipt.FullName,[IO.FileMode]::Open,[IO.FileAccess]::Write,[IO.FileShare]::Read)
    try {$handle.Position=0;$handle.Write($finalBytes,0,$finalBytes.Length);$writePermitted=$true} finally {$handle.Dispose()}
} catch { $writePermitted=$false }

$result=[ordered]@{schema=1;session=$session;fixtureRoot=$FixtureRoot;fixtureCommit=(& git -C $FixtureRoot rev-parse HEAD).Trim();
    buildRoot=$BuildRoot;store=$store;runtimeFile=$runtime;receiptOverwritePermitted=$writePermitted;
    observations=$observations}
$result | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'invalidation.json') -Encoding utf8
Copy-Item -LiteralPath (Split-Path $store -Parent) -Destination (Join-Path $raw 'external-store') -Recurse
Write-Output ($result|ConvertTo-Json -Compress -Depth 20)
