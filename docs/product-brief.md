# YouSage product brief

## Confirmed scope

- A desktop application built using Rust.
- Windows is the target platform for the first version.
- A small notch can be moved freely on screen. Its compact view previews the five-hour and weekly usage limits for the active Codex desktop account, a selected Antigravity model quota group, or the Claude subscription. The dual Codex/Antigravity mode shows a reading from each source.
- By default, the compact preview follows the Codex desktop app's signed-in account, and can be switched to Claude or any Antigravity model quota group (`Gemini Models`, `Claude and GPT models`, or `Gemini 4 Argon`) from the detail panel or Settings.
- Opening the notch reveals a detail panel showing visible subscriptions: connected Codex accounts, the active Google Antigravity sign-in's model quota groups, and Claude subscription usage.
- The detail panel expands in place from the notch, opening downward or upward according to the notch's position and available space.
- Keep the expanded panel within the current monitor's usable area, shifting it horizontally when necessary to avoid screen edges and the taskbar.
- The visible notch stays on top of other application windows.
- The notch can be hidden while YouSage continues running and monitoring usage in the background.
- YouSage remains accessible through a Windows system tray icon. The user can reopen the notch from that icon.
- YouSage starts automatically when the user signs into Windows, with a "Start with Windows" setting to disable this behavior.
- On startup, restore whether the notch was last visible or hidden.
- Use a matte charcoal appearance with rounded edges, labeled five-hour and weekly percentages, and thin usage bars.
- Usage means the percentage of Codex, Antigravity, or Claude allowance remaining in the five-hour and weekly windows, with a reset time for each window.
- Multiple separate ChatGPT accounts, including work and personal, can be monitored at the same time alongside the active Google Antigravity sign-in.
- Additional Codex accounts are connected through an "Add account" flow with a one-time ChatGPT sign-in. They remain available for monitoring while another account is active in the Codex desktop app.
- Antigravity usage follows the active local Google Antigravity CLI (`agy`) sign-in automatically.
- Claude subscription usage follows the local Claude Code sign-in and can be selected in the notch independently from Antigravity's Claude model quotas.
- Settings provides a custom accent color and a show/hide switch for each subscription. Hiding preserves sign-ins and preferences and removes the subscription from the notch, detail panel, tray readings, and alerts. Restore it at any time in Settings, including when all subscriptions are hidden.
- Dragging an expanded notch preserves the visible detail panel throughout the gesture and does not treat the release as a toggle click.

## Account switching

- Choose a connected account in YouSage to switch the Codex desktop app and Codex CLI together.
- Keep the remaining connected accounts available for monitoring and future switches.
- When the desktop app must restart, offer a clearly labeled "Restart Codex and switch" confirmation before closing it. The user should finish running tasks before confirming.

## Implementation approach

- Use Tauri with a Rust core and an HTML/CSS interface. The user accepts a web-based interface within the desktop application.
- Keep account access, usage retrieval, and background monitoring in Rust, separate from interface rendering.

## Performance requirements

Smooth interaction and low background overhead are explicit product requirements.

- Dragging, expanding, and collapsing must stay responsive while usage is being fetched.
- Show the last known usage immediately when opening the panel, with its freshness indicated; a refresh must not delay opening.
- Stop interface animation work while hidden and avoid continuous polling or rendering loops when idle.
- Initial engineering targets are smooth 60 fps interaction on a 60 Hz display and short expansion/collapse animations around 150-200 ms. These are targets to validate, not measured results.
- Measure interaction timing, idle CPU, and total memory including WebView2 processes in a Windows release build before claiming performance results.

Tauri's documented [process model](https://v2.tauri.app/concept/process-model/) separates the Rust core from interface rendering. Its Windows interface uses [WebView2](https://v2.tauri.app/reference/webview-versions/#webview2-windows).

## Reference

The user's reference shows a compact "Usage remaining" display with a five-hour row and a weekly row. Each row shows a remaining percentage and a reset time or date.

See [CONTEXT.md](../CONTEXT.md) for the agreed domain language.
