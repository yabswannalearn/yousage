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

YouSage uses the documented Codex app-server account API over local standard input/output and the Google Antigravity CLI (`agy -p "/usage" --output-format json`) for Antigravity model quota groups. Neither integration starts model turns or consumes model tokens when checking usage.

The Codex desktop connection follows `CODEX_HOME` (default `%USERPROFILE%\.codex`); during integration probing, its account usage matched the desktop app's reported usage. Additional Codex sign-ins use app-local account homes with Codex's OS credential-store mode.

Antigravity usage follows the active local sign-in in `%USERPROFILE%\.gemini` (reading only the non-secret active email from `google_accounts.json` and quota buckets from `agy`). YouSage never sends tokens to the interface or saves them in its settings/cache files.

`YOUSAGE_CODEX_BIN` and `YOUSAGE_ANTIGRAVITY_BIN` can select specific Codex or Antigravity (`agy`) executables if installed outside their usual locations.

Startup registration is applied in release builds. Development builds do not register themselves to run at Windows sign-in.

The browser-only `?preview=1` route in development shows explicitly labeled demonstration data for both Codex and Antigravity; real account access requires the Windows app.

## Account switching

Switches preserve the existing Codex home and change only its Codex auth credential. Connected accounts use Codex 0.160's `secrets/codex_auth.age` file and the corresponding master password in Windows Credential Manager. The canonical home path determines the credential-store entry; other Codex secrets are left intact. The destination respects the effective `cli_auth_credentials_store` value read from Codex. Crypto runs on blocking workers rather than the interface thread.

Before a switch, YouSage refreshes and validates the chosen sign-in, checks running processes, and requires explicit confirmation before closing the desktop app. Existing CLI sessions must be closed first. After shutdown it saves the latest outgoing credentials to a connected account, replaces the active credential, and verifies the account through a new Codex app-server process. A verification failure restores the old credential. Only the active connection refreshes an active account, avoiding competing refresh-token rotation from its saved connection.

To test encrypted-store interoperability without using a real account:

```powershell
. ./scripts/tools.ps1
cargo test --manifest-path src-tauri/Cargo.toml isolated_codex_keyring_compatibility -- --ignored
```

This opt-in Windows test creates a disposable Codex home and a dummy API credential, verifies Codex/YouSage compatibility, then removes the test credential and directory. It does not switch the user's Codex account.
