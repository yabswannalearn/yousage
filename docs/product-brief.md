# YouSage product brief

## Confirmed scope

- A desktop application built using Rust.
- Windows is the target platform for the first version.
- A small notch can be moved freely on screen. Its compact view previews both the five-hour and weekly usage limits for the account currently signed in to the Codex desktop app on the computer.
- The compact preview follows the desktop app's signed-in account. CLI and editor sign-ins do not determine the active account in the first version.
- Opening the notch reveals a detail panel showing all connected accounts on the computer together.
- The detail panel expands in place from the notch, opening downward or upward according to the notch's position and available space.
- Keep the expanded panel within the current monitor's usable area, shifting it horizontally when necessary to avoid screen edges and the taskbar.
- The visible notch stays on top of other application windows.
- The notch can be hidden while YouSage continues running and monitoring usage in the background.
- YouSage remains accessible through a Windows system tray icon. The user can reopen the notch from that icon.
- YouSage starts automatically when the user signs into Windows, with a "Start with Windows" setting to disable this behavior.
- On startup, restore whether the notch was last visible or hidden.
- Use a matte charcoal appearance with rounded edges, labeled five-hour and weekly percentages, and thin usage bars.
- Usage means the percentage of Codex allowance remaining in the five-hour and weekly windows, with a reset time for each window.
- Multiple separate ChatGPT accounts, including work and personal, can be monitored at the same time.
- Additional accounts are connected through an "Add account" flow with a one-time ChatGPT sign-in. They remain available for monitoring while another account is active in the Codex desktop app.
- Reuse the desktop app's existing sign-in where supported; the exact integration still needs technical verification.

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
