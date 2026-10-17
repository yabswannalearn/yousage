# Load the approved development tools without relying on a terminal restart.
$env:CARGO_HOME = [Environment]::GetEnvironmentVariable('CARGO_HOME', 'User')
$env:RUSTUP_HOME = [Environment]::GetEnvironmentVariable('RUSTUP_HOME', 'User')
if (-not $env:CARGO_HOME -and (Test-Path -LiteralPath 'D:\DevTools\Rust\cargo')) { $env:CARGO_HOME = 'D:\DevTools\Rust\cargo' }
if (-not $env:RUSTUP_HOME -and (Test-Path -LiteralPath 'D:\DevTools\Rust\rustup')) { $env:RUSTUP_HOME = 'D:\DevTools\Rust\rustup' }
if ($env:CARGO_HOME) { $env:PATH = (Join-Path $env:CARGO_HOME 'bin') + ';' + $env:PATH }
if (Test-Path -LiteralPath 'D:\DevTools\Temp') { $env:TEMP = 'D:\DevTools\Temp'; $env:TMP = $env:TEMP }
if (Test-Path -LiteralPath 'D:\DevTools') { $env:npm_config_cache = 'D:\DevTools\Cache\npm' }
