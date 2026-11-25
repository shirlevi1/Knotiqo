[CmdletBinding()]
param(
    [switch]$CreateShortcut,
    [switch]$Stop
)

$ErrorActionPreference = 'Stop'
$scriptFile = $PSCommandPath

if ($CreateShortcut) {
    $desktop = [Environment]::GetFolderPath('DesktopDirectory')
    $shell = New-Object -ComObject WScript.Shell
    $powershell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    foreach ($entry in @(@{ Name = 'Knotiqo'; Arguments = '' }, @{ Name = 'Stop Knotiqo'; Arguments = ' -Stop' })) {
        $shortcut = $shell.CreateShortcut((Join-Path $desktop ($entry.Name + '.lnk')))
        $shortcut.TargetPath = $powershell
        $shortcut.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File "' + $scriptFile + '"' + $entry.Arguments
        $shortcut.WorkingDirectory = $PSScriptRoot
        $shortcut.Description = $entry.Name + ' local wedding workspace'
        $shortcut.Save()
    }
    return
}

try {
    $root = Split-Path -Parent $PSScriptRoot
    $python = @(
        (Join-Path $PSScriptRoot '.venv\Scripts\python.exe')
        (Join-Path $root '.venv\Scripts\python.exe')
    ) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if (-not $python) {
        throw 'Project Python environment was not found. Create backend\.venv and install backend\requirements.txt.'
    }
    $action = if ($Stop) { 'stop' } else { 'open' }
    # Capture the launcher message for the hidden shortcut.
    $ErrorActionPreference = 'Continue'
    $details = & $python (Join-Path $PSScriptRoot 'local_launcher.py') $action 2>&1
    $result = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($result -ne 0) {
        throw ($details | Out-String).Trim()
    }
} catch {
    Add-Type -AssemblyName System.Windows.Forms
    [void][System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Knotiqo', 'OK', 'Error')
    exit 1
}
