# Interface direction

YouSage is a small instrument for checking Codex allowance while working. Its job is to make the active account's two limits readable at a glance, with other accounts one click away.

## Tokens

- Charcoal `#202221`: main surface.
- Recess `#171918`: inset controls and bars.
- Chalk `#F1F2EE`: primary text.
- Fog `#999F99`: secondary text.
- Sage `#B7C8B1`: normal remaining allowance.
- Amber `#E0AF72`: low allowance and stale-state attention.

Use Segoe UI Variable/Segoe UI for labels and headings, and Cascadia Mono/Consolas for tabular percentage data. Keep all fonts local.

## Layout and signature

The collapsed notch is a compact rounded instrument: account identity at the left, two labeled allowance readings at the right. The signature is a pair of thin inset allowance tracks that remain recognizable in both the compact notch and expanded account cards.

The detail panel unfolds in place above or below the notch. Account cards show both allowance windows and their reset times, with a small active-account marker. The panel also offers refresh, account management, settings, and hide actions.

## Interaction

- Drag the compact header to move the notch; a click without dragging toggles expansion.
- Escape and clicking outside collapse the detail panel.
- Remember the notch's monitor position, and clamp it to a visible work area after monitor changes.
- Honor reduced-motion preferences. Keep transitions short and animate only during interactions.

## Design review

The user's approved dark pill direction takes precedence over exploring unrelated themes. Avoid a generic dashboard: use a dense utility layout, subdued sage status accents, and typographic hierarchy sized for a desktop companion. Keep the account readings as the focus and omit decorative graphics or continuously animated indicators.
