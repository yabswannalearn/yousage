# YouSage

A small Windows desktop companion for **OpenAI Codex** and **Google Antigravity** usage, built with Rust and Tauri.

## About

YouSage sits as a compact, movable notch on your Windows desktop so you can see your remaining **5-hour** and **weekly** AI coding allowances at a glance without interrupting your workflow:

- **OpenAI Codex**: Monitor multiple ChatGPT accounts (such as Work and Personal) simultaneously and switch the active Codex desktop app and CLI account in one click.
- **Google Antigravity**: Automatically track remaining quota across **Gemini Models**, **Claude and GPT models**, and **Gemini 4 Argon** via the local Antigravity CLI (`agy`).
- **Configurable Notch Preview**: Choose whether the collapsed notch displays your active Codex account or any Antigravity model quota group.
- **Zero Token Overhead**: Usage checks query local CLI/app-server endpoints directly without starting model turns or consuming tokens.
- **System Tray & Auto-Start**: Hide the notch to the Windows system tray at any time while background monitoring continues.

## Download & Install (Windows 10/11 x64)

Grab the latest installer from [**GitHub Releases**](https://github.com/yabswannalearn/yousage/releases/latest):

1. **Setup Wizard (Recommended)**: Download **`YouSage_0.1.0_x64-setup.exe`** and run the installer wizard.
   - Installs per-user (no Administrator prompt required), adds Start Menu / Desktop shortcuts, and registers an uninstaller in Windows *Installed apps*.
2. **Portable Executable**: Download **`yousage.exe`** if you prefer a standalone single-file binary you can place in any folder.

> **Note on Windows SmartScreen**: Because YouSage is an open-source build without a paid EV code-signing certificate, Windows Defender SmartScreen may show *"Windows protected your PC"* on first launch. Click **More info** → **Run anyway**.

### Prerequisites on the user's PC

YouSage reads usage from the tools already installed on your machine (neither is bundled inside YouSage):
- For **Codex** monitoring: [OpenAI Codex desktop app / CLI](https://chatgpt.com/codex) signed in on your PC.
- For **Antigravity** monitoring: Google Antigravity (`agy`) installed and signed in on your PC.

## Run from source

Install Rust with the MSVC toolchain, Microsoft C++ Build Tools with a Windows SDK, Node.js, and the Codex desktop app and/or Antigravity CLI (`agy`). WebView2 is required at runtime and is already present on most Windows 11 installations.

On this machine, development tools are configured on D:. See [development setup](docs/development.md).

```powershell
. ./scripts/tools.ps1
npm install
npm run tauri dev
```

## Connect Codex accounts

The desktop account is detected from Codex's local sign-in. Use **Add account** to connect additional ChatGPT accounts through your browser. Connecting an account does not switch Codex's sign-in. YouSage keeps additional sign-ins separate and lets Codex store their credentials in Windows Credential Manager.

If you also want the current desktop account to remain available after you switch accounts in Codex, connect it once through **Add account** too. YouSage combines matching accounts into one card while that account is active.

Account menus support renaming, signing in again, and disconnecting.

## Monitor Antigravity model quotas

YouSage automatically monitors the active local Antigravity sign-in through the Antigravity CLI (`agy`) and displays a dedicated **Antigravity** section in the detail panel. Each quota group (**Gemini Models**, **Claude and GPT models**, and **Gemini 4 Argon**) shows its remaining five-hour and weekly allowance percentages and reset times.

Click **Show in notch** on any Antigravity model group (or on the active Codex account), or use the **Notch preview** selector in **Settings**, to choose which source appears in the compact notch.

Settings also control Windows startup and refresh frequency. The default refresh interval is one minute. Old readings are explicitly marked if a refresh fails; unknown allowance is shown as a dash.

## Switch Codex desktop and CLI accounts

Expand the notch and click **Switch to this account** on a connected Codex account. YouSage switches the Codex desktop app and CLI together. If the desktop app is open, finish any running tasks, then confirm **Restart Codex and switch**. YouSage closes and reopens Codex for you.

Close existing Codex terminal sessions before switching; YouSage checks for these and asks you to close them first. Start them again after the switch to use the chosen account.

The outgoing account stays connected in YouSage, even if it was originally detected from Codex rather than added manually. The switch preserves Codex configuration and conversation files. If verification fails, YouSage restores the previous sign-in.

This feature supports Codex 0.160's file and encrypted Windows credential storage. It follows `CODEX_HOME`, or the default `~/.codex` home. CLI sessions configured with another home keep their own sign-in. Temporary and environment-provided access-token sign-ins cannot be switched this way.

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

Codex account access uses the [Codex app-server account API](https://learn.chatgpt.com/docs/app-server#auth-endpoints), and Antigravity quota checks use `agy -p "/usage" --output-format json`. Usage checks do not start model turns or consume model tokens. The standalone app requires an installed Codex executable and/or Antigravity CLI (`agy`); neither is bundled into YouSage.
