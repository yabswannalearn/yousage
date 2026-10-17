# Windows development setup

The user approved installing Rust/Cargo and the minimal Microsoft C++ compiler and Windows SDK, with D: as the primary location. Only Microsoft components that require the system drive may use C:. Ask before installing additional system tools.

## Locations on this machine

- Rustup: `D:\DevTools\Rust\rustup`
- Cargo, its package registry, and binaries: `D:\DevTools\Rust\cargo`
- MSVC Build Tools: `D:\DevTools\VS2022BuildTools`
- Shared Visual Studio components: `D:\DevTools\VisualStudio\Shared`
- Microsoft download cache: `D:\DevTools\Cache\VisualStudio`
- Installer downloads: `D:\DevTools\Downloads`
- Build-process temporary files: `D:\DevTools\Temp`
- Project frontend dependencies and Rust build output stay under the project on D:.

Cargo and Rustup locations are configured as Windows user environment variables; Cargo's bin directory is on the user PATH. Existing terminals can load these values using `. ./scripts/tools.ps1`.

Setup completed on October 17, 2026 without requiring a restart. Installed versions: Rust 1.99.1 (MSVC), Cargo 1.99.1, Visual Studio Build Tools 2022 17.14.42, and Windows SDK 10.0.26100.0. After installation, the main tool folders measured approximately 4 GB on D: and 1.8 GB on C:; project build output is additional. Microsoft installed the Windows SDK and installer in their standard system locations on C:.

## Commands

```powershell
. ./scripts/tools.ps1
npm install
npm run tauri dev
```

To build the standalone executable, use `npm run build:desktop`. To additionally build an installer, use `npm run tauri build`. For verification, use `npm test`, `npm run build`, and `cargo test --manifest-path src-tauri/Cargo.toml`.

## Integration

YouSage uses the documented Codex app-server account API over local standard input/output. It does not start Codex turns or consume model tokens when checking usage. The desktop connection follows `CODEX_HOME` (default `%USERPROFILE%\.codex`); during integration probing, its account usage matched the desktop app's reported usage. Additional sign-ins use app-local account homes with Codex's OS credential-store mode. YouSage never sends tokens to the interface or saves them in its settings/cache files.

`YOUSAGE_CODEX_BIN` can select a specific Codex executable. This is useful if Codex is installed outside its usual location.

Startup registration is applied in release builds. Development builds do not register themselves to run at Windows sign-in.

The browser-only `?preview=1` route in development shows explicitly labeled demonstration data; real account access requires the Windows app.
