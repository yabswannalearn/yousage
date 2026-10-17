# YouSage

A small Windows desktop companion for **OpenAI Codex**, **Google Antigravity**, and **Claude** usage, built with Rust and Tauri.

## About

YouSage sits as a compact, movable notch on your Windows desktop so you can see your remaining **5-hour** and **weekly** AI coding allowances at a glance without interrupting your workflow:

- **OpenAI Codex**: Monitor multiple ChatGPT accounts (such as Work and Personal) simultaneously and switch the active Codex desktop app and CLI account in one click.
- **Google Antigravity**: Automatically track remaining quota across **Gemini Models**, **Claude and GPT models**, and **Gemini 4 Argon** via the local Antigravity CLI (`agy`), plus save and switch between multiple Antigravity accounts.
- **Claude**: Track your Claude subscription's five-hour and weekly allowance through the existing local Claude Code sign-in, with an optional Claude notch preview.
- **Subscription settings**: Choose a custom accent color for Codex, Antigravity, and Claude, and hide or restore each subscription without disconnecting it. Hidden subscriptions are omitted from the notch, detail panel, tray readings, and alerts. Your chosen preview and colors are remembered.
- **Notch Preview**: Display your active Codex account, any Antigravity model group, or your Claude subscription. The **Both (`Codex + Antigravity`)** option shows those two sources side-by-side.
- **Smart Alerts & Switch Suggestions**: Get notified when a 5-hour or weekly window drops below `20%` / `10%` or finishes resetting, and get one-click switch suggestions when your active Codex account runs low.
- **Global Hotkey (`Alt+Shift+U`) & Dynamic Tray Icon**: Show or toggle the notch from anywhere using `Alt+Shift+U`, and check live status colors and percentages in the system tray.
- **Built-in Update Checker**: Check for new GitHub Releases directly from **Settings** and download the latest Setup Wizard in one click.
- **Zero Token Overhead**: Usage checks read local CLI/app-server endpoints or Claude account metadata without starting model turns or consuming tokens.

## Download & Install (Windows 10/11 x64)

Grab the latest installer from [**GitHub Releases**](https://github.com/yabswannalearn/yousage/releases/latest):

1. **Setup Wizard (Recommended)**: Download **`YouSage_0.1.0_x64-setup.exe`** and run the installer wizard.
   - Installs per-user (no Administrator prompt required), adds Start Menu / Desktop shortcuts, and registers an uninstaller in Windows *Installed apps*.
2. **Portable Executable**: Download **`yousage.exe`** if you prefer a standalone single-file binary you can place in any folder.

> **Note on Windows SmartScreen**: Because YouSage is an open-source build without a paid EV code-signing certificate, Windows Defender SmartScreen may show *"Windows protected your PC"* on first launch. Click **More info** → **Run anyway**.

### Prerequisites on the user's PC

Install and sign in to the tools for the subscriptions you want to monitor. These tools are not bundled with YouSage:

- For **Codex** monitoring: [OpenAI Codex desktop app / CLI](https://chatgpt.com/codex) signed in on your PC.
- For **Antigravity** monitoring: Google Antigravity (`agy`) installed and signed in on your PC.
- For **Claude** monitoring: Claude Code signed into a Claude subscription with `claude auth login`.

## Run from source

Install Rust with the MSVC toolchain, Microsoft C++ Build Tools with a Windows SDK, and Node.js, plus the tools for your chosen subscriptions listed above. WebView2 is required at runtime and is already present on most Windows 11 installations.

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

## Monitor and switch Antigravity accounts

YouSage automatically monitors the active local Antigravity sign-in through the Antigravity CLI (`agy`) and displays a dedicated **Antigravity** section in the detail panel. Each quota group (**Gemini Models**, **Claude and GPT models**, and **Gemini 4 Argon**) shows its remaining five-hour and weekly allowance percentages and reset times.

- Click **Save sign-in** next to your active Antigravity email to save that account profile locally, then sign into another Google account in `agy` to monitor and switch between multiple Antigravity accounts in one click.
- Click **Show in notch** or **Both in notch** on any Antigravity model group, or use the **Notch preview** selector in **Settings**, to choose whether the compact notch displays Codex, an Antigravity group, or both together.

Settings also control low-allowance/reset alerts, Windows startup, refresh frequency, and checking for updates. Press **`Alt+Shift+U`** at any time to show or toggle the notch.

## Switch Codex desktop and CLI accounts

Expand the notch and click **Switch to this account** on a connected Codex account. YouSage switches the Codex desktop app and CLI together. If the desktop app is open, finish any running tasks, then confirm **Restart Codex and switch**. YouSage closes and reopens Codex for you.

Close existing Codex terminal sessions before switching; YouSage checks for these and asks you to close them first. Start them again after the switch to use the chosen account.

The outgoing account stays connected in YouSage, even if it was originally detected from Codex rather than added manually. The switch preserves Codex configuration and conversation files. If verification fails, YouSage restores the previous sign-in.

This feature supports Codex 0.160's file and encrypted Windows credential storage. It follows `CODEX_HOME`, or the default `~/.codex` home. CLI sessions configured with another home keep their own sign-in. Temporary and environment-provided access-token sign-ins cannot be switched this way.

## Claude usage and subscription settings

Open **Settings → Appearance** to choose the background and UI accent for the whole app. Changes preview immediately across the compact notch, detail panel, cards, and controls; text adapts for light or dark backgrounds. **Reset colors** restores the original charcoal/sage app theme. Subscription accent colors are configured separately under **Subscriptions** and keep their saved values.

Claude appears in its own section, separate from Claude models offered through Antigravity. YouSage reads the existing Claude Code subscription sign-in from `%USERPROFILE%\.claude` (or `CLAUDE_CONFIG_DIR`). If the sign-in is missing or expired, run `claude auth login` and refresh YouSage. Token refresh and sign-in stay with Claude Code.

Claude usage checks call the read-only account metadata endpoint, without sending prompts or starting model turns. This endpoint is an internal Claude API and can change. YouSage checks at most once every five minutes, keeps last known readings on network errors, and backs off at least fifteen minutes after rate limiting. It honors a longer numeric `Retry-After` header. Credentials never enter the interface or YouSage's settings/cache files. See [Claude Code authentication](https://code.claude.com/docs/en/authentication) and [the upstream usage endpoint report](https://github.com/anthropics/claude-code/issues/30930).

Open **Settings → Subscriptions** to change each subscription's color or turn its visibility off and on. Colors apply to usage bars, avatars, badges, and notch readings; low-allowance warnings remain amber. Hiding preserves the sign-in and color while background usage checks continue. If the preferred notch source is hidden, the notch temporarily shows a visible subscription. Restoring the source brings its preview back. Settings remain accessible when all subscriptions are hidden.

Drag the header to move either the compact notch or the expanded detail panel. The expanded contents stay visible throughout a drag, and releasing the header does not toggle the panel. A separate click still opens or closes it.

## Build and verify

```powershell
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run build:desktop
```

For the desktop interface regression checks, start `npm run dev` in another terminal and run `npm run test:ui`. If Playwright's browser is not installed, run `npx playwright install chromium` once. These checks use demonstration data with a mocked native bridge; they cover long drags, focus changes, provider colors, Claude preview, and hiding/restoring subscriptions.

The standalone executable is generated at `src-tauri/target/release/yousage.exe`. To additionally package a Windows installer, use `npm run tauri build`; it generates the installer under `src-tauri/target/release/bundle/nsis/`. Development builds do not register themselves to start with Windows. Release builds honor the **Start with Windows** setting.

## Design and scope

- [Product brief](docs/product-brief.md)
- [Domain glossary](CONTEXT.md)
- [Interface direction](docs/design.md)

Codex account access uses the [Codex app-server account API](https://learn.chatgpt.com/docs/app-server#auth-endpoints), Antigravity quota checks use `agy -p "/usage" --output-format json`, and Claude reads subscription usage from its account metadata endpoint using the local Claude Code sign-in. Usage checks do not start model turns or consume model tokens. Install the tools for the subscriptions you want to monitor; they are not bundled into YouSage.
