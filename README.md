# YouSage

![YouSage icon](src-tauri/icons/64x64.png)

YouSage is a Windows desktop notch for tracking **OpenAI Codex**, **Google Antigravity**, and **Claude Code** allowances. See how much usage you have left, when it resets, and which coding session is working.

[Download for Windows](https://github.com/yabswannalearn/yousage/releases/latest) · [Try the browser demo](https://yabswannalearn.github.io/yousage/?preview=1&expanded=1) · [Build from source](#build-from-source) · [Report an issue](https://github.com/yabswannalearn/yousage/issues)

## Features

- See five-hour and weekly allowances, Antigravity model quotas such as Argon, and Claude's separate Fable weekly limit when the account reports one.
- Track coding sessions as **Rest**, **Working**, **Needs permission**, or **Finished**. The compact notch shows a working conversation with its provider logo and a `+N` count for additional sessions.
- Save multiple accounts and switch between them. You can also enable automatic switching when a provider reaches 0% remaining.
- Choose which providers and allowance windows appear in the notch, dock it to a screen edge, and customize the theme and provider colors.
- Set low-allowance and reset alerts, review local usage trends, and export history as CSV.

## Install on Windows

YouSage runs on Windows 10 and 11 x64 with Microsoft Edge WebView2. Download the per-user **Setup Wizard** or the standalone **`yousage.exe`** from [GitHub Releases](https://github.com/yabswannalearn/yousage/releases/latest).

This README describes `main`. The `v0.1.0` installer predates Fable, coding session status, and automatic switching. Build from source to use those features.

To verify a download, compare its SHA-256 hash against the digest listed for that asset on GitHub Releases. In PowerShell, run `Get-FileHash .\yousage.exe -Algorithm SHA256`, substituting the filename you downloaded. Releases currently use unsigned Windows binaries. See the [security policy](SECURITY.md) for private vulnerability reports.

## Connect your accounts

Install and sign in to the tools for the providers you want to track.
The dashboard opens on first launch so you can choose those providers and see their setup steps. Select **Open dashboard** in the Windows system tray to return at any time.

| Provider | Setup |
| --- | --- |
| Codex | Sign in to Codex on this PC. YouSage detects the active sign-in. Use **Add Codex account** to connect additional ChatGPT accounts through your browser. |
| Antigravity | Install and sign in to the `agy` CLI. YouSage reads its model quotas. Use **Save sign-in** to keep an account available before signing in to another. |
| Claude Code | Run `claude auth login` to sign in to a Claude subscription. Use **Save sign-in** to keep an account available before signing in to another. YouSage uses the Claude Code sign-in for usage and switching. |

For a missing or stale reading, open **Settings → System → Connection health** to see the last successful check and next retry. Claude usage depends on an internal account endpoint and may be temporarily unavailable after rate limiting or upstream changes.

In **Settings → Preview → Background tracking**, pause providers you rarely use. Their last readings remain available, and **Refresh usage** checks them on demand. By default, active accounts follow your refresh interval and saved Codex and Antigravity accounts are checked at most once every five minutes in the background.

## Use the notch

- Rest on the top edge for 200 ms to expand the notch. Clicks on the collapsed bar pass through to the app underneath.
- Move outside an unpinned panel to minimize it. Click inside the expanded panel to pin it, then click outside or press **Esc** to minimize it. Drag the expanded header to reposition the notch.
- Press **Alt+Shift+U** to toggle the notch, **Alt+Shift+N** to cycle the preview, or **Alt+Shift+P** to toggle privacy mode.
- Open **Settings → Preview** to choose one provider or a custom combination. Select **Fable this week** when the Claude account reports that allowance.

### Coding sessions

In **Settings → Preview → Coding sessions**, select **Enable session status**. YouSage adds observer hooks to Codex, Claude Code, and Antigravity while preserving existing hooks. Review the new hooks in Codex under **Settings → Hooks** or `/hooks`, then start new coding sessions. The notch uses the conversation title when available and falls back to the project name. Some Antigravity app and IDE permission dialogs are outside the events its hooks expose.

### Account switching

Use the switch action on a saved account and review which sessions need to close. Codex and Antigravity can reopen their desktop apps after switching. Start new terminal sessions to use the chosen sign-in. Claude switching applies to Claude Code.

**Auto switch account** is off by default. Enable it per provider in **Settings → Preview** or **Settings → Alerts**. YouSage requires a fresh 0% reading and a saved account with available allowance in the same quota windows. Account purpose and exclusions apply to the choice.

Automatic switching defaults to **Wait until sessions close**. Choose **Force-close sessions and switch** separately if you accept the risk of interrupting running work or losing unsaved changes. Existing settings require this choice again.

### Local data and privacy

Usage history and session status are stored on your PC. Session observers save status, project names, and available conversation titles without saving prompts or tool arguments. Privacy mode masks account identities and session names in the interface and uses generic notifications. In **Settings → System**, you can adjust history retention, clear history, or export CSV.

Saved Codex sign-ins use Windows Credential Manager, and saved Claude Code sign-ins use Windows user-bound encryption. Antigravity sign-in files live in separate local account folders. Usage refreshes read provider quota data without starting model turns.

## Build from source

Install Git, Node.js 22.12 or newer, Rust with the MSVC toolchain, Microsoft C++ Build Tools with the Windows SDK, and WebView2. [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/#windows)

```powershell
git clone https://github.com/yabswannalearn/yousage.git
cd yousage
npm ci
npm run tauri dev
```

For a browser preview with demo data, run `npm run dev` and open `http://127.0.0.1:1420/?preview=1`. Live account access requires the Windows app.

Run `npm run build:desktop` to build `src-tauri/target/release/yousage.exe`. Run `npm run tauri build` to also package the installer under `src-tauri/target/release/bundle/nsis/`.

## Contributing

File bug reports and feature ideas in [GitHub Issues](https://github.com/yabswannalearn/yousage/issues). For a bug, include your Windows version, YouSage version or commit, and steps to reproduce it. Use demo data or privacy mode when sharing screenshots.

Before submitting a pull request, run the checks relevant to your change.

```powershell
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

For UI changes, install Chromium with `npx playwright install chromium`, start `npm run dev` in a separate terminal, and run `npm run test:ui`. Additional regression checks and integration notes are in the [development notes](docs/development.md). See the [product brief](docs/product-brief.md) and [interface design](docs/design.md) for project context.

## License and credits

YouSage's source code is licensed under the [MIT License](LICENSE).

YouSage is an independent project. The provider marks identify their corresponding usage sources. [ChatGPT favicon](https://chatgpt.com/cdn/assets/favicon-o20kmmos.svg) · [Claude icon](https://claude.com/icon.svg) · [Antigravity press assets](https://antigravity.google/press)
