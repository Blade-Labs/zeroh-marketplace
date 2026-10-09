# SPDX-License-Identifier: MIT
# Windows PowerShell 5.1-compatible. Source arrives on stdin, never argv.
$ErrorActionPreference = 'Stop'
# ConsoleHost owns Console.In and can replace a reader installed by a bootstrap.
# The 5.1 bridge has already decoded the real stdin bytes into this private file.
if ($env:ZEROH_ORACLE_POWERSHELL_INPUT) {
    $request = [IO.File]::ReadAllText($env:ZEROH_ORACLE_POWERSHELL_INPUT) | ConvertFrom-Json
} else {
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
}
function TokenRow($token) {
    $nested = @()
    if ($token -is [System.Management.Automation.Language.StringExpandableToken] -and $null -ne $token.NestedTokens) {
        $nested = @($token.NestedTokens | ForEach-Object { TokenRow $_ })
    }
    [ordered]@{
        kind = $token.Kind.ToString()
        text = $token.Text
        startIndex = $token.Extent.StartOffset
        endIndex = $token.Extent.EndOffset
        nestedTokens = $nested
    }
}
$commands = @($request.commands)
$results = @()
$watch = [System.Diagnostics.Stopwatch]::StartNew()
foreach ($command in $commands) {
    $tokens = $null
    $errors = $null
    $start = $watch.Elapsed.TotalMilliseconds
    $ast = [System.Management.Automation.Language.Parser]::ParseInput([string]$command, [ref]$tokens, [ref]$errors)
    $results += [ordered]@{
        tokens = @($tokens | ForEach-Object { TokenRow $_ })
        errors = @($errors | ForEach-Object { [ordered]@{ id = $_.ErrorId; startIndex = $_.Extent.StartOffset; endIndex = $_.Extent.EndOffset } })
        parseMs = $watch.Elapsed.TotalMilliseconds - $start
    }
}
[ordered]@{ results = $results; passMs = $watch.Elapsed.TotalMilliseconds; version = $PSVersionTable.PSVersion.ToString() } | ConvertTo-Json -Depth 30 -Compress
