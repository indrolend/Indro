$script:dbTerminalEvidence = Join-Path $PSScriptRoot 'terminal-evidence.cjs'

function global:dbt-evidence {
    & node $script:dbTerminalEvidence @args
}
