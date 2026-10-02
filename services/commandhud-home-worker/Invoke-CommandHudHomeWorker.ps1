#Requires -Version 7.0
[CmdletBinding()]
param(
    [string]$WorkerScript = (Join-Path $PSScriptRoot 'worker.mjs'),
    [Parameter(Mandatory)][string]$CloudflaredPath,
    [string]$CredentialModulePath = (Join-Path $env:LOCALAPPDATA 'Programs\CommandHud\plugins\commandhud-remote\service\CommandHudRemoteCredential.psm1'),
    [string]$ExecutorCredentialTarget = 'CommandHudHome/ExecutorToken',
    [string]$TunnelCredentialTarget = 'CommandHudHome/TunnelToken',
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA 'CommandHud\home-remote'),
    [int]$MaxRestartsPerHour = 12
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $WorkerScript)) { throw "Home executor was not found at '$WorkerScript'." }
if (-not (Test-Path -LiteralPath $CloudflaredPath)) { throw "cloudflared was not found at '$CloudflaredPath'." }
if (-not (Test-Path -LiteralPath $CredentialModulePath)) { throw "Credential helper was not found at '$CredentialModulePath'." }

Import-Module $CredentialModulePath -Force
New-Item -ItemType Directory -Force -Path $StateRoot | Out-Null
$serviceLog = Join-Path $StateRoot 'service.log'
$stopFlag = Join-Path $StateRoot 'stop.request'

function Write-ServiceLog([string]$Message) {
    Add-Content -LiteralPath $serviceLog -Encoding utf8 -Value ("{0} {1}" -f (Get-Date).ToString('s'), $Message)
}

function Stop-OwnedProcess([Diagnostics.Process]$Process) {
    if ($null -eq $Process) { return }
    try {
        if (-not $Process.HasExited) { Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue }
    } catch { }
}

Remove-Item -LiteralPath $stopFlag -Force -ErrorAction SilentlyContinue
$restarts = [Collections.Generic.List[datetime]]::new()
Write-ServiceLog "STARTING worker=$WorkerScript cloudflared=$CloudflaredPath"

while ($true) {
    if (Test-Path -LiteralPath $stopFlag) {
        Remove-Item -LiteralPath $stopFlag -Force -ErrorAction SilentlyContinue
        Write-ServiceLog 'STOPPED intentional_stop_flag'
        return
    }

    $now = Get-Date
    [void]$restarts.RemoveAll({ param($value) $value -lt $now.AddHours(-1) })
    if ($restarts.Count -ge $MaxRestartsPerHour) {
        Write-ServiceLog "STOPPING restart_budget_exhausted count=$($restarts.Count)"
        throw "CommandHUD home control exceeded $MaxRestartsPerHour restarts within one hour."
    }

    $executorToken = Get-CommandHudRemoteCredential -Target $ExecutorCredentialTarget
    $tunnelToken = Get-CommandHudRemoteCredential -Target $TunnelCredentialTarget
    if (-not $executorToken) { throw "Credential '$ExecutorCredentialTarget' is not configured." }
    if (-not $tunnelToken) { throw "Credential '$TunnelCredentialTarget' is not configured." }

    $homeProcess = $null
    $tunnel = $null
    try {
        $env:COMMANDHUD_HOME_TOKEN = $executorToken
        $homeProcess = Start-Process -FilePath 'node.exe' -ArgumentList @($WorkerScript) -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput (Join-Path $StateRoot 'home-stdout.log') `
            -RedirectStandardError (Join-Path $StateRoot 'home-stderr.log')
        Remove-Item Env:COMMANDHUD_HOME_TOKEN -ErrorAction SilentlyContinue
        $executorToken = $null

        $env:TUNNEL_TOKEN = $tunnelToken
        $tunnel = Start-Process -FilePath $CloudflaredPath -ArgumentList @('tunnel', '--no-autoupdate', 'run') -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput (Join-Path $StateRoot 'tunnel-stdout.log') `
            -RedirectStandardError (Join-Path $StateRoot 'tunnel-stderr.log')
        Remove-Item Env:TUNNEL_TOKEN -ErrorAction SilentlyContinue
        $tunnelToken = $null

        Write-ServiceLog "READY home_pid=$($homeProcess.Id) tunnel_pid=$($tunnel.Id)"
        while (-not $homeProcess.HasExited -and -not $tunnel.HasExited -and -not (Test-Path -LiteralPath $stopFlag)) {
            Start-Sleep -Seconds 2
            $homeProcess.Refresh()
            $tunnel.Refresh()
        }
        if (Test-Path -LiteralPath $stopFlag) {
            Write-ServiceLog 'STOPPING intentional_stop_flag'
            Stop-OwnedProcess $tunnel
            Stop-OwnedProcess $homeProcess
            Remove-Item -LiteralPath $stopFlag -Force -ErrorAction SilentlyContinue
            Write-ServiceLog 'STOPPED intentional_stop_flag'
            return
        }
        Write-ServiceLog "CHILD_EXIT home=$($homeProcess.HasExited) tunnel=$($tunnel.HasExited)"
    } finally {
        Remove-Item Env:COMMANDHUD_HOME_TOKEN -ErrorAction SilentlyContinue
        Remove-Item Env:TUNNEL_TOKEN -ErrorAction SilentlyContinue
        $executorToken = $null
        $tunnelToken = $null
        Stop-OwnedProcess $tunnel
        Stop-OwnedProcess $homeProcess
    }

    $restarts.Add((Get-Date))
    Start-Sleep -Seconds ([Math]::Min(60, 5 * $restarts.Count))
}
