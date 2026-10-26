$root=$PSScriptRoot
$manifest=Join-Path $root 'artifact-hashes.json'
$files=Get-ChildItem -LiteralPath $root -Recurse -File | Where-Object { $_.FullName -ne $manifest } | Sort-Object FullName
$records=foreach($file in $files){
    [ordered]@{path=$file.FullName.Substring($root.Length+1).Replace('\','/');bytes=$file.Length;
        sha256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}
}
$json=[ordered]@{schema=1;generatedUtc=[DateTime]::UtcNow.ToString('o');files=$records} | ConvertTo-Json -Depth 6
[IO.File]::WriteAllText($manifest,$json.Replace("`r`n","`n")+"`n",[Text.UTF8Encoding]::new($false))
Write-Output $manifest
