# YouSage

YouSage lets a person keep track of Codex usage across their personal and work accounts, Antigravity model quotas, and their Claude subscription from a small desktop companion.

## Language

**App theme**:
The background and shared UI accent chosen under **Settings → Appearance**, with curated presets (**Charcoal**, **Obsidian**, **Warm Slate**, **Daylight**) and custom hex pickers. It applies to the notch and detail panel, with derived readable text and control surfaces. Subscription colors are independent and include quick swatches. **Reset colors** restores the charcoal/sage app theme while preserving subscription preferences.

**Subscription**:
A usage source shown in YouSage: Codex, Antigravity, or Claude. Each has a custom accent color and a visibility switch in Settings. Hiding a subscription keeps its sign-in and preferences, omits its readings and alerts, and lets the person restore it later. Background usage checks continue while hidden. If all are hidden, Settings remain accessible.

**Claude subscription**:
The standalone Claude subscription used by the local Claude Code sign-in. Its five-hour and weekly usage windows are separate from Claude model quotas inside Antigravity.

**Account**:
A distinct ChatGPT login used to access Codex. A person can monitor multiple accounts, such as work and personal, each with its own **Usage remaining**.
_Avoid_: Workspace, profile

**Active account**:
The **Account** currently signed in to the Codex desktop app on the computer.
_Avoid_: Selected account

**Connected account**:
A Codex **Account** added to YouSage for ongoing monitoring, including when another **Account** is active. The **Detail panel** includes all connected accounts.

**Account switch**:
Choosing a **Connected account** to use in both the Codex desktop app and Codex CLI on the computer. Desktop and CLI switch together.

**Antigravity model group**:
A quota group reported by the local Antigravity CLI (`agy`), such as **Gemini Models**, **Claude and GPT models**, or **Gemini 4 Argon**. Each group reports its own **Usage remaining** and **Reset time** across five-hour and weekly **Usage windows**.

**Notch preview**:
The reading currently displayed in the compact **Notch**—the **Active account** in Codex, a chosen **Antigravity model group**, the **Claude subscription**, or a custom combination. Custom previews can show the five-hour window, weekly window, or the most constrained available window (the lowest remaining percentage). Enabling **Smart auto-focus** temporarily promotes the most constrained visible subscription when it drops at or below its warning threshold. Press `Alt+Shift+N` or use the tray menu to cycle visible preview sources. A fallback reading keeps its actual window label. Hiding the preferred source temporarily falls back to another visible subscription, without forgetting the preference.

**Connection health**:
The state of a subscription's usage connection, including the last successful check, next scheduled check or eligible retry, and recovery instructions. A failed refresh keeps cached readings visibly dated; a retry respects provider cooldowns.

**Account recommendation**:
An explained suggestion to use another connected account for the same provider. Suggestions use fresh, comparable allowance windows, consider reset timing, and honor the person's work/personal purpose and exclusions. The person still reviews and confirms an **Account switch**.

**Usage history**:
Local samples of **Usage remaining**, grouped by subscription, account, model group when applicable, and usage window. Samples represent successful observations, not token counts or task costs. History stores hashed identities and generic account aliases rather than names, emails, or credentials.

**Pacing estimate**:
An approximate rate of allowance use and possible exhaustion time derived from enough recent observations in the same usage window. A reset, long gap, failed check, or stale reading makes the estimate unavailable. It describes account-wide allowance changes, which can include use on other computers.

**Privacy mode**:
A display setting that replaces account names and emails with generic aliases in YouSage, exported history, and notifications. It preserves sign-ins and explicit switching. Enabling it removes earlier YouSage notifications from Windows Notification Center.

**Usage remaining**:
The percentage of an allowance still available in a particular **Usage window** for a Codex **Account**, an **Antigravity model group**, or the **Claude subscription**.
_Avoid_: Token count, usage consumed, spending

**Usage window**:
A period over which Codex, Antigravity, or Claude measures an allowance, such as the five-hour or weekly window. Each window has its own **Usage remaining** and **Reset time**.

**Reset time**:
The date and time when Codex, Antigravity, or Claude reports that a **Usage window** will reset.

**Notch**:
The compact, freely movable view of YouSage that previews the chosen **Notch preview**'s **Usage remaining**.
It can float or attach to any edge of a monitor's usable area. Drag near an edge to dock, or away to float. Side docking uses a narrow vertical tab while the **Detail panel** remains horizontal.
_Avoid_: Closed app, minimized app

**Detail panel**:
The view that expands in place from the **Notch** to inspect visible Codex **Connected accounts**, local **Antigravity model groups**, and the **Claude subscription**.
_Avoid_: Open notch, dashboard

## Example dialogue

**Developer**: Where do you glance at usage while working?
**User**: In the notch. I open the detail panel when I want more information across Codex, Antigravity, and Claude.

**Developer**: What does usage remaining mean?
**User**: How much of my Codex, Antigravity, or Claude allowance is left in the five-hour and weekly windows, with the reset time for each.

**Developer**: How is Antigravity usage organized compared to Codex?
**User**: Codex has separate personal and work ChatGPT accounts that I can connect and switch between. Antigravity monitors my active local sign-in and shows model quota groups—Gemini Models, Claude and GPT models, and Gemini 4 Argon—in a dedicated section of the detail panel.

**Developer**: Which subscriptions can the notch show?
**User**: Codex, an Antigravity model group, or Claude. I can choose in Settings or click **Show in notch** on the relevant card. Codex and Antigravity can also appear together.

**Developer**: What happens when you hide a subscription?
**User**: Its readings and alerts disappear, but its sign-in and color are kept. I can bring it back under **Settings → Subscriptions**, and its preferred preview returns too.

**Developer**: Which sign-in determines the active Codex account?
**User**: The Codex desktop app's sign-in, even if the terminal or editor uses another account.
