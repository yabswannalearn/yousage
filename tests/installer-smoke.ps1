# Run on a clean Windows runner with no existing YouSage installation or data.
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$Installer,
    [Parameter(Mandatory)]
    [string]$Version
)

$ErrorActionPreference = 'Stop'
$installDir = Join-Path $env:LOCALAPPDATA 'YouSage'
$appData = Join-Path $env:LOCALAPPDATA 'com.yousage.desktop'
$installed = Join-Path $installDir 'yousage.exe'
$uninstaller = Join-Path $installDir 'uninstall.exe'
if ((Test-Path -LiteralPath $installDir) -or (Test-Path -LiteralPath $appData) -or (Get-Process yousage -ErrorAction SilentlyContinue)) {
    throw 'The installer smoke test needs a clean Windows user.'
}

function Invoke-Installer($path) {
    $process = Start-Process -FilePath $path -ArgumentList '/S' -WindowStyle Hidden -PassThru -Wait
    if ($process.ExitCode -ne 0) { throw "$path exited with code $($process.ExitCode)." }
}

function Test-Launch {
    $app = Start-Process -FilePath $installed -WindowStyle Hidden -PassThru
    try {
        if ($app.WaitForExit(5000)) { throw "YouSage exited during startup with code $($app.ExitCode)." }
        if (!(Test-Path -LiteralPath $appData)) { throw 'YouSage did not initialize its app data.' }
    } finally {
        if (!$app.HasExited) {
            Stop-Process -InputObject $app
            $app.WaitForExit()
        }
    }
}

$previous = Join-Path $env:RUNNER_TEMP 'YouSage_0.1.0_x64-setup.exe'
$expectedPreviousHash = '321a52d62843f5938026bda69c04a66d190d821817fbc8227e4cd6fd9eff55ca'
Invoke-WebRequest 'https://github.com/yabswannalearn/yousage/releases/download/v0.1.0/YouSage_0.1.0_x64-setup.exe' -OutFile $previous
if ((Get-FileHash -LiteralPath $previous -Algorithm SHA256).Hash -ne $expectedPreviousHash) {
    throw 'The baseline installer failed checksum verification.'
}

Invoke-Installer $previous
$previousHash = (Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash
Test-Launch
$marker = Join-Path $appData 'installer-smoke.txt'
Set-Content -LiteralPath $marker -Value 'keep through upgrade'

Invoke-Installer (Resolve-Path -LiteralPath $Installer).Path
$installedHash = (Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash
# Tauri embeds NSIS metadata in the packaged executable and restores the
# unpatched standalone build afterward, so their hashes differ by design.
$installedVersion = (Get-Item -LiteralPath $installed).VersionInfo.ProductVersion
$registeredVersion = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\YouSage').DisplayVersion
if ($installedHash -eq $previousHash -or $installedVersion -ne $Version -or $registeredVersion -ne $Version) {
    throw "Expected YouSage $Version after upgrade. Executable: $installedVersion. Registry: $registeredVersion."
}
if ((Get-Content -LiteralPath $marker -Raw).Trim() -ne 'keep through upgrade') {
    throw 'The upgrade did not preserve app data.'
}
Test-Launch

Invoke-Installer $uninstaller
if ((Test-Path -LiteralPath $installed) -or (Test-Path -LiteralPath $uninstaller)) {
    throw 'Uninstall left the application installed.'
}
Write-Host 'Windows install, launch, upgrade, and uninstall passed.'
