$ErrorActionPreference='Stop'
$moduleHome=Join-Path $HOME 'Documents\PowerShell\Modules\Indro'
$backupRoot=Join-Path $env:LOCALAPPDATA ('Indro\backups\'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
$repo='C:\Users\indro\Projects\db-enemy-motor-runtime'

# Validate the bundle before changing the machine.
$tokens=$null;$parseErrors=$null
[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Indro.psm1'),[ref]$tokens,[ref]$parseErrors)|Out-Null
if($parseErrors.Count){throw ('Indro.psm1 parse failed: '+(($parseErrors|ForEach-Object Message)-join '; '))}
foreach($json in @('words.json','workspaces\workspaces.json')){
    [void](Get-Content (Join-Path $PSScriptRoot $json) -Raw | ConvertFrom-Json)
}
if(-not(Test-Path -LiteralPath $repo)){throw "Digital Breakdown workspace missing: $repo"}

$python=Get-Command python -ErrorAction SilentlyContinue
if($python){
    & $python.Source (Join-Path $PSScriptRoot 'tools\test-all.py')
    if($LASTEXITCODE){throw "Bundled Indro self-tests failed: $LASTEXITCODE"}
}else{Write-Warning 'Python not found; dogfood/bench/selftest will be unavailable until Python 3 is installed.'}

New-Item -ItemType Directory -Force $backupRoot|Out-Null
if(Test-Path -LiteralPath $moduleHome){Copy-Item $moduleHome (Join-Path $backupRoot 'Indro-module') -Recurse -Force}
if(Test-Path -LiteralPath $PROFILE){Copy-Item $PROFILE (Join-Path $backupRoot 'PowerShell-profile.ps1') -Force}

foreach($name in @('git','cmake')){
    if(-not(Get-Command $name -ErrorAction SilentlyContinue)){Write-Warning "Dependency not found: $name"}
}
if(-not(Get-Command ollama -ErrorAction SilentlyContinue)){Write-Warning 'Ollama not found; agent will be unavailable.'}
if(Test-Path -LiteralPath 'D:\hud'){Write-Host 'HUD_OK D:\hud'}else{Write-Warning 'D:\hud not found; Indro will fall back to LOCALAPPDATA.'}

# Back up live workspace adapters before any optional fallback install.
$runtimeBackup=Join-Path $backupRoot 'workspace-runtime'
New-Item -ItemType Directory -Force $runtimeBackup|Out-Null
foreach($relative in @('tools\dbdev.ps1','tools\ollama-playtest.py')){
    $path=Join-Path $repo $relative
    if(Test-Path -LiteralPath $path){Copy-Item $path (Join-Path $runtimeBackup ([IO.Path]::GetFileName($path))) -Force}
}

New-Item -ItemType Directory -Force $moduleHome|Out-Null
Copy-Item "$PSScriptRoot\Indro.psm1" $moduleHome -Force
Copy-Item "$PSScriptRoot\indro.py","$PSScriptRoot\indro_lang.py","$PSScriptRoot\indro_proof.py" $moduleHome -Force
Copy-Item "$PSScriptRoot\words.json" $moduleHome -Force
New-Item -ItemType Directory -Force "$moduleHome\workspaces","$moduleHome\tools","$moduleHome\examples"|Out-Null
Copy-Item "$PSScriptRoot\workspaces\workspaces.json" "$moduleHome\workspaces" -Force
Copy-Item "$PSScriptRoot\tools\*.py" "$moduleHome\tools" -Force
Copy-Item "$PSScriptRoot\examples\*.indro" "$moduleHome\examples" -Force

# Existing project runtimes are authority. Bundled copies are fallback only.
foreach($file in @('dbdev.ps1','ollama-playtest.py')){
    $destination=Join-Path $repo ('tools\'+$file)
    if(-not(Test-Path -LiteralPath $destination)){
        Copy-Item (Join-Path $PSScriptRoot ('runtime\'+$file)) $destination -Force
        Write-Host "INSTALLED_RUNTIME $destination"
    }else{Write-Host "PRESERVED_RUNTIME $destination"}
}

$importLine='Import-Module Indro -Force'
if(-not(Test-Path -LiteralPath $PROFILE)){New-Item -ItemType File -Force $PROFILE|Out-Null}
if(-not(Select-String -LiteralPath $PROFILE -SimpleMatch $importLine -Quiet)){Add-Content $PROFILE "`n$importLine"}
if(Get-Module Indro){Remove-Module Indro -Force}
Import-Module Indro -Force

Write-Host "INDRO_INSTALLED backup=$backupRoot" -ForegroundColor Green
Write-Host 'Next: learn   indro plan mature   status' -ForegroundColor Cyan
