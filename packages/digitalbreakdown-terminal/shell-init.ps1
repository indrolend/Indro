$script:commandHudCli = Join-Path $PSScriptRoot '..\commandhud\cli.mjs'

if (-not (Get-Command hud -ErrorAction SilentlyContinue)) {
    function global:hud {
        & node $script:commandHudCli @args
    }
}
