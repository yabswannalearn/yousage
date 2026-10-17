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

Use Segoe UI Variable/Segoe UI for labels and headings, and Cascadia Mono/Consolas for tabular percentage data. Keep all fonts local.

## Layout and signature

The collapsed notch is a compact rounded instrument: the active Codex account, Antigravity model group, or Claude subscription identity at the left, with two labeled allowance readings at the right. The dual Codex/Antigravity preview uses each subscription's own color. The signature is a pair of thin inset allowance tracks that remain recognizable in both the compact notch and expanded cards.

The detail panel unfolds in place above or below the notch. It organizes visible subscriptions into Codex, Antigravity, and Claude sections showing both allowance windows and their reset times, with active-account and notch-preview markers. The panel also offers refresh, account management, notch preview source selection, settings, and hide actions.

## Interaction

- Drag the compact header to move the notch; a click without dragging toggles expansion.
- Dragging keeps the expanded detail panel and its contents visible for the whole gesture. Native drag focus changes and the release click do not collapse it.
- Settings offers an individual accent color and visibility switch for Codex, Antigravity, and Claude. Apply accents to their bars, avatars, and preview readings; keep low-allowance warnings amber. Keep Settings available even when every subscription is hidden.
- Preserve the preferred preview when its subscription is hidden, show a visible source temporarily, and restore the preferred preview when that subscription returns.
- Escape and clicking outside collapse the detail panel.
- Remember the notch's monitor position, and clamp it to a visible work area after monitor changes.
- Honor reduced-motion preferences. Keep transitions short and animate only during interactions.

## Design review

The user's approved dark pill direction takes precedence over exploring unrelated themes. Avoid a generic dashboard: use a dense utility layout, subdued sage status accents, and typographic hierarchy sized for a desktop companion. Keep the account readings as the focus and omit decorative graphics or continuously animated indicators.
