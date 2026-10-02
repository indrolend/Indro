#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory, Position = 0)][ValidateSet('status', 'start', 'stop', 'restart')]
    [string]$Action,
    [string]$TaskName = 'CommandHudHomeRemote',
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA 'CommandHud\home-remote')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$stopFlag = Join-Path $StateRoot 'stop.request'

function Get-ServiceStatus {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $task) { return [pscustomobject]@{ Registered = $false; State = 'NotRegistered'; LastRunTime = $null; LastTaskResult = $null } }
    $info = Get-ScheduledTaskInfo -TaskName $TaskName
    [pscustomobject]@{ Registered = $true; State = [string]$task.State; LastRunTime = $info.LastRunTime; LastTaskResult = $info.LastTaskResult }
}

switch ($Action) {
    'status' { Get-ServiceStatus | Format-List }
    'start' {
        Remove-Item -LiteralPath $stopFlag -Force -ErrorAction SilentlyContinue
        Start-ScheduledTask -TaskName $TaskName
        Write-Host "Requested start of '$TaskName'."
    }
    'stop' {
        New-Item -ItemType Directory -Force -Path $StateRoot | Out-Null
        New-Item -ItemType File -Force -Path $stopFlag | Out-Null
        $deadline = (Get-Date).AddSeconds(12)
        while ((Get-ScheduledTask -TaskName $TaskName).State -eq 'Running' -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
        if ((Get-ScheduledTask -TaskName $TaskName).State -eq 'Running') { Stop-ScheduledTask -TaskName $TaskName }
        Write-Host "Requested stop of '$TaskName'."
    }
    'restart' {
        & $PSCommandPath stop -TaskName $TaskName -StateRoot $StateRoot
        & $PSCommandPath start -TaskName $TaskName -StateRoot $StateRoot
    }
}
