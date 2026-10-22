$script:commandHudCli = Join-Path $PSScriptRoot '..\commandhud\cli.mjs'

if (-not (Get-Command hud -ErrorAction SilentlyContinue)) {
    function global:hud {
        & node $script:commandHudCli @args
    }
}

# Publish presentation metadata through a private OSC channel. The browser
# consumes it without adding decorative text to the authoritative PTY stream.
function global:prompt {
    $commandSucceeded = $?
    $nativeExitCode = $global:LASTEXITCODE
    $currentPath = (Get-Location).Path
    $repositoryRoot = $null
    $repositoryName = $null
    $branch = $null
    $dirty = $false

    if (Get-Command git -ErrorAction SilentlyContinue) {
        $repositoryRoot = git -C $currentPath rev-parse --show-toplevel 2>$null
        if ($repositoryRoot) {
            $repositoryRoot = [string]$repositoryRoot
            $repositoryName = Split-Path $repositoryRoot -Leaf
            $branch = git -C $repositoryRoot branch --show-current 2>$null
            if (-not $branch) { $branch = git -C $repositoryRoot rev-parse --short HEAD 2>$null }
            $dirty = [bool](git -C $repositoryRoot status --porcelain=v1 --untracked-files=normal 2>$null)
        }
    }

    $payload = @{
        cwd = $currentPath
        repository = $repositoryName
        repositoryRoot = $repositoryRoot
        branch = if ($branch) { [string]$branch } else { $null }
        dirty = $dirty
        exitCode = if ($commandSucceeded) { 0 } elseif ($null -ne $nativeExitCode) { [int]$nativeExitCode } else { 1 }
        shell = "PowerShell $($PSVersionTable.PSVersion)"
    } | ConvertTo-Json -Compress
    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($payload))
    [Console]::Write("$([char]27)]777;$encoded$([char]7)")
    $global:LASTEXITCODE = $nativeExitCode
    return "PS $currentPath> "
}
