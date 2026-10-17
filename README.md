# YouSage

A small Windows desktop companion for Codex usage, built with Rust and Tauri.

The movable notch previews the Codex desktop account's five-hour and weekly allowance. Click it to expand a panel with all connected accounts. The panel opens above or below the notch to stay within the screen. Hide the notch to keep YouSage running in the Windows system tray.

## Run from source

Install Rust with the MSVC toolchain, Microsoft C++ Build Tools with a Windows SDK, Node.js, and the Codex desktop app. WebView2 is required at runtime and is already present on most Windows 11 installations.

On this machine, development tools are configured on D:. See [development setup](docs/development.md).

```powershell
. ./scripts/tools.ps1
npm install
npm run tauri dev
```

## Connect accounts

The desktop account is detected from Codex's local sign-in. Use **Add account** to connect additional ChatGPT accounts through your browser. Connecting an account does not switch Codex's sign-in. YouSage keeps additional sign-ins separate and lets Codex store their credentials in Windows Credential Manager.

If you also want the current desktop account to remain available after you switch accounts in Codex, connect it once through **Add account** too. YouSage combines matching accounts into one card while that account is active.

Account menus support renaming, signing in again, and disconnecting. Settings control Windows startup and refresh frequency. The default refresh interval is one minute. Old readings are explicitly marked if a refresh fails; unknown allowance is shown as a dash.

## Build and verify

```powershell
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run build:desktop
```

The standalone executable is generated at `src-tauri/target/release/yousage.exe`. To additionally package a Windows installer, use `npm run tauri build`; it generates the installer under `src-tauri/target/release/bundle/nsis/`. Development builds do not register themselves to start with Windows. Release builds honor the **Start with Windows** setting.

## Design and scope

- [Product brief](docs/product-brief.md)
- [Domain glossary](CONTEXT.md)
- [Interface direction](docs/design.md)

Account access uses the [Codex app-server account API](https://learn.chatgpt.com/docs/app-server#auth-endpoints). Usage checks do not start model turns. The standalone app requires an installed Codex executable; it is not bundled into YouSage.
