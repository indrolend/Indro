$ErrorActionPreference='Stop'
$items=@('pwsh','git','python','cmake','ollama')
foreach($name in $items){
    $command=Get-Command $name -ErrorAction SilentlyContinue
    [pscustomobject]@{Dependency=$name;Found=[bool]$command;Path=if($command){$command.Source}else{''}}
}
[pscustomobject]@{Dependency='D:\hud';Found=(Test-Path -LiteralPath 'D:\hud');Path='D:\hud'}
[pscustomobject]@{Dependency='Digital Breakdown workspace';Found=(Test-Path -LiteralPath 'C:\Users\indro\Projects\db-enemy-motor-runtime');Path='C:\Users\indro\Projects\db-enemy-motor-runtime'}
