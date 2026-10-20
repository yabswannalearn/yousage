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

YouSage uses the documented Codex app-server account API over local standard input/output, the Google Antigravity CLI (`agy -p "/usage" --output-format json`) for Antigravity model quota groups, and Claude's account metadata endpoint for subscription usage. Usage checks do not start model turns or consume model tokens.

The Codex desktop connection follows `CODEX_HOME` (default `%USERPROFILE%\.codex`); during integration probing, its account usage matched the desktop app's reported usage. Additional Codex sign-ins use app-local account homes with Codex's OS credential-store mode.

Antigravity usage follows the active local sign-in in `%USERPROFILE%\.gemini` (reading only the non-secret active email from `google_accounts.json` and quota buckets from `agy`). YouSage never sends tokens to the interface or saves them in its settings/cache files.

Each Antigravity quota check runs in a temporary auth-only home and working directory. User and project MCP settings, plugins, and hooks are not copied, so `/usage` cannot start configured MCP command windows. Temporary sign-in files are kept under the user's local app data rather than a potentially shared Windows `TEMP`, and removed when the process finishes or times out. Switch staging/backups use the same location. Refreshed credentials are saved back only if the source sign-in has not changed during the check; normal CLI configuration is never modified.

`YOUSAGE_CODEX_BIN` and `YOUSAGE_ANTIGRAVITY_BIN` can select specific Codex or Antigravity (`agy`) executables if installed outside their usual locations.

Startup registration is applied in release builds. Development builds do not register themselves to run at Windows sign-in.

The browser-only `?preview=1` route in development shows explicitly labeled demonstration data for Codex, Antigravity, and Claude; real account access requires the Windows app.

Claude reads the existing subscription OAuth credential from `%USERPROFILE%\.claude\.credentials.json`, honoring `CLAUDE_CONFIG_DIR`, and queries `https://api.anthropic.com/api/oauth/usage`. It uses the system `curl` already used by the update checker, passes its authorization header through stdin, and never passes tokens in process arguments. The endpoint is internal and is not a supported public API. Checks have a five-minute minimum interval, with a fifteen-minute minimum backoff on HTTP 429; a longer numeric `Retry-After` is honored. Claude Code owns login and token refresh. The preview route also includes Claude demonstration data.

Provider accents and visibility are saved in `settings.json` as `providerColors` and `hiddenProviders`. Existing settings gain defaults without losing connected accounts. Hiding preserves credentials, colors, and the preferred notch source; background polling continues while readings and alerts are omitted. The frontend temporarily selects a visible source and restores the preference when it becomes visible again.

Usage alerts are sent by Rust through Tauri's native notification plugin, including when the notch is hidden. The existing notification toggle, hidden-provider filtering, and threshold/reset deduplication apply before delivery. Browser notification permission is no longer used. Windows controls delivery through Settings → System → Notifications (including Do not disturb). For the correct YouSage name and icon, use the NSIS-installed app; development notifications may carry the terminal identity. In-app alerts remain available when Windows suppresses a toast. The notification plugin requires Rust 1.90 or newer.

The independent `appTheme` setting stores six-digit hex `background` and `accent` colors, with defaults for older settings files. `src/theme.ts` derives shared surface and text tokens and adjusts accent text for contrast; subscription colors remain unchanged. Color picker input previews without replacing the DOM, and committed changes persist through the existing settings command. Reset affects only the app theme. Theme tests cover light, dark, saturated, invalid, and reset values.

The native drag command marks the gesture as active until the mouse is released. Focus-loss collapse and frontend rendering are deferred during the gesture, and the release click stays suppressed until the next intentional pointer press. This prevents a long drag from outlasting a fixed click-suppression timeout and hiding the expanded contents. The native color picker also suspends automatic collapse while open.

Docking is stored as `dockEdge` alongside the existing `anchor`; older settings default to floating. Native drag completion snaps to the nearest work-area edge within 28 logical pixels. Left/right compact windows are 58 × 184 logical pixels; top/bottom are 480 × 40; floating is 440 × 80. Top/bottom detail panels retain their 480-pixel width; side detail panels expand to 440 pixels. The existing window expands inward and publishes `notch-layout` so the frontend matches its native bounds. Monitor fallback and DPI conversion remain in the native placement path. `node tests/docking-ui.mjs` checks all docking layouts against preview data with Vite running, writes screenshots under `artifacts/docking/`, and verifies fit, expansion and Escape. Preview URLs accept `?preview=1&edge=left` (or right/top/bottom).

`npm run test:ui` exercises the real frontend against a mocked Tauri bridge while the Vite server is running; it requires Playwright Chromium (`npx playwright install chromium`). It covers long drags, focus changes, release clicks, color-picker focus, separate accents, preview selection, and hiding/restoring every subscription. These checks do not verify an actual Windows drag gesture or a live Claude account. Run the built Windows app for those checks; live Claude data requires a valid subscription sign-in.

## Account switching

Switches preserve the existing Codex home and change only its Codex auth credential. Connected accounts use Codex 0.160's `secrets/codex_auth.age` file and the corresponding master password in Windows Credential Manager. The canonical home path determines the credential-store entry; other Codex secrets are left intact. The destination respects the effective `cli_auth_credentials_store` value read from Codex. Crypto runs on blocking workers rather than the interface thread.

Before either provider's switch, YouSage validates the chosen sign-in and shows a confirmation naming the apps and terminal shells that will be force-closed. Codex checks ChatGPT/Codex desktop apps, standalone Codex CLI sessions, and their related terminal shell trees (including the npm Codex shim). Antigravity checks its desktop app and `agy` sessions. Other terminal tabs and unrelated applications are not selected. YouSage's own usage helpers are excluded, and switches refuse to close an ancestor of YouSage itself. This classification uses a full Windows process snapshot so terminal ancestry is available; command lines remain backend-only.

After confirmation, process identity (PID, start time, executable, and name) is rechecked before each targeted `taskkill /T /F`. The switch waits until the provider's sessions have stopped; if a process survives or respawns, no active credentials are replaced. If sessions appear after a confirmation that listed no running processes, the switch asks for confirmation again. Desktop apps are reopened after the transaction; CLI sessions must be started again by the user. Force-closing interrupts tasks and can lose unsaved work, which the confirmation explains.

After shutdown, Codex saves the latest outgoing credentials to a connected account, replaces the active credential, and verifies the account through a new app-server process. A verification failure restores the old credential. Only the active connection refreshes an active account, avoiding competing refresh-token rotation from its saved connection. Antigravity stages its validated target, backs up the outgoing sign-in, synchronizes the complete credential file set (removing stale files absent from the target), and checks usage before reopening the desktop app. A replacement or usage-check failure restores the previous sign-in. Antigravity switching honors `GEMINI_CLI_HOME` for the active destination.

To test encrypted-store interoperability without using a real account:

```powershell
. ./scripts/tools.ps1
cargo test --manifest-path src-tauri/Cargo.toml isolated_codex_keyring_compatibility -- --ignored
```

This opt-in Windows test creates a disposable Codex home and a dummy API credential, verifies Codex/YouSage compatibility, then removes the test credential and directory. It does not switch the user's Codex account.

Antigravity's background updater launches `agy --version` in a new console during quota checks. On systems using Windows Terminal as the default terminal, a separate brokered terminal window can appear even when the CLI's own console is hidden. Usage checks set the process-local environment variable `AGY_CLI_DISABLE_AUTO_UPDATE=true` (the literal `true` is required; `1` does not work). Normal interactive CLI sessions and their updates are unchanged. Usage polling launches agy directly with `CREATE_NO_WINDOW`; the previous PowerShell/cmd wrapper and its Job Object were removed. Authentication isolation and refresh behavior are unchanged.

For a Windows integration regression, run `./tests/console-windows.ps1 -AppPath D:/Apps/YouSage/yousage.exe -RestartApp`. This restarts only the named executable, observes its process tree and actual console/Windows Terminal show events for 80 seconds, and fails on internal agy updater children or visible console events correlated with background CLI launches. Keep the desktop otherwise idle so unrelated terminal launches are not mistaken for the app's. The test uses existing sign-ins for normal quota checks; it does not switch accounts. The older synthetic hidden-console inheritance test did not cover Windows Terminal delegation and has been removed.

Circular meters replace compact and detail allowance tracks. Compact readings include reset countdowns, updated in place every 30 seconds without replacing controls; tooltips and detail cards show full reset times. Unknown usage stays a dash with an empty ring.
