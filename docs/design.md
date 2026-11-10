# Interface direction

YouSage is a small instrument for checking Codex, Google Antigravity, and Claude allowance while working. Its job is to make the selected source's two limits readable at a glance, with connected Codex accounts, Antigravity model quota groups, and the Claude subscription one click away.

## Tokens

- Charcoal `#202221`: main surface.
- Recess `#171918`: inset controls and bars.
- Chalk `#F1F2EE`: primary text.
- Fog `#999F99`: secondary text.
- Sage `#B7C8B1`: default Codex accent and general interface actions.
- Blue `#8AB4D8`: default Antigravity accent.
- Terracotta `#D99A7C`: default Claude accent.
- Amber `#E0AF72`: low allowance and stale-state attention.

Subscription accent colors are customizable in Settings. Keep shared surfaces and text neutral so multiple subscription colors remain distinguishable together.

Settings → Appearance controls the app background and UI accent independently of subscription colors. Derive card surfaces, inset controls, borders, and readable text from the chosen background; apply the UI accent to shared controls. The notch uses the user-supplied donut-chart SVG in fixed light blue (#9DD9F3). Preview picker changes immediately, save the chosen colors, and provide a reset to charcoal/sage. Palette text colors target a [minimum 4.5:1 contrast ratio](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum); subscription bars retain their chosen colors.

Use Segoe UI Variable/Segoe UI for labels and headings, and Cascadia Mono/Consolas for tabular percentage data. Keep all fonts local.

## Layout and signature

The collapsed notch is a compact rounded instrument: the active Codex account, Antigravity model group, or Claude subscription identity at the left, with two labeled allowance readings at the right. The dual Codex/Antigravity preview uses each subscription's own color. Circular meters show usage remaining alongside percentages. The compact notch includes reset countdowns (and full reset times on hover); expanded cards show exact reset dates and times. Unknown readings use an empty neutral ring and a dash, never a fabricated percentage.

The detail panel unfolds in place into a subscription overview. Each visible subscription emphasizes the active account or selected model group's remaining allowance and reset times. Show status when readings are cached, paused, or unavailable. The current notch subscription leads on open, and updates keep that order until the next open. Each subscription opens its own detail view with account actions and model groups. Refresh, History, and Settings have labeled controls in the footer.

Custom notch previews use one labeled reading per selected provider, including combinations with Claude. Keep the provider and actual window visible even when a five-hour reading falls back to weekly data. The most-constrained mode selects the available window with the lowest remaining percentage. Fit three readings within the existing floating, horizontal, and vertical bounds; the notch should remain a compact instrument.

Settings organizes controls into tabbed category pods (**All**, **Preview**, **Theme**, **Alerts**, **System**) covering preview controls, curated theme presets and subscription swatches, alert rules, recommendation purpose, and connection health. Alert percentages mean allowance remaining. Keep last-success ages and retry countdowns visible alongside connection failures, and provide copyable sign-in commands when applicable. Account management holds work/personal purpose and suggestion exclusions. Recommendations explain their capacity comparison and use the existing account-switch review. Account cards surface inline pacing estimates when available, and the history trace includes a comparison toggle to overlay peer accounts in the same usage window.

## Interaction

- The collapsed notch passes clicks to the window underneath. Rest on the top eight logical pixels of its visible bar for 200 ms to expand. A small mark identifies the hover edge. Moving outside closes the temporary preview. Clicking inside, opening from the tray, or pressing Enter or Space pins the panel. An outside click or Escape closes it.
- Release within 28 logical pixels of a monitor's usable edge to dock. Drag away to return to the floating pill. Docking respects the taskbar and remembers the edge and position.
- Release near the top edge with the notch's visible center within 32 logical pixels of the monitor's horizontal center to snap to top center. Center detection uses the dragged width before converting to the docked width.
- After native resizing completes, the shell grows from the compact notch's width and height over 240 ms. Detail content fades in as the shell opens. Collapse returns to the compact outline in 180 ms. Reduced motion skips both animations.
- Top and bottom use a wide, thin horizontal notch (480 × 40 logical pixels including transparent clearance) with a flat attached edge. Left and right collapse into a 58 × 184 vertical tab with two circular meters and reset countdowns; the detail panel stays horizontal and expands toward the screen interior. Expanded side panels clamp vertically to the work area without changing the saved compact anchor. Floating windows and side detail panels are 440 pixels wide.
- Dragging keeps the expanded detail panel and its contents visible for the whole gesture. Native drag focus changes and the release click do not collapse it.
- Settings offers an individual accent color and visibility switch for Codex, Antigravity, and Claude. Apply accents to their bars, avatars, and preview readings; keep low-allowance warnings amber. Keep Settings available even when every subscription is hidden.
- Preserve the preferred preview when its subscription is hidden, show a visible source temporarily, and restore the preferred preview when that subscription returns.
- Escape and clicking outside collapse the detail panel.
- Remember the notch's monitor position, and clamp it to a visible work area after monitor changes.
- Honor reduced-motion preferences. Keep transitions short and animate only during interactions.

## Design review

The user's approved dark pill direction takes precedence over exploring unrelated themes. Avoid a generic dashboard: use a dense utility layout, subdued sage status accents, and typographic hierarchy sized for a desktop companion. Keep the account readings as the focus and omit decorative graphics or continuously animated indicators.

## Session header

Use a 320 × 26 compact bar at the top or bottom edge (44 pixels tall when floating). Place the ChatGPT, Claude, or Antigravity logo inside each provider's allowance ring. Keep the center empty when there are no sessions; otherwise show the working conversation's provider logo and title, with its project name as a fallback. Show `+N` for additional sessions, keeping start order among simultaneously working sessions. Rest uses a quiet dot, Working a steady outline, Needs permission an amber square, and Finished a filled dot. The overview lists visible sessions below the allowance readings. A pin in the header indicates that pointer departure will leave the panel open. Respect reduced motion and privacy mode.
