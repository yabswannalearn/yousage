# YouSage

YouSage lets a person keep track of Codex usage across their personal and work accounts, Antigravity model quotas, and their Claude subscription from a small desktop companion.

## Language

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
The reading currently displayed in the compact **Notch**—the **Active account** in Codex, a chosen **Antigravity model group**, both together, or the **Claude subscription**. Hiding the preferred source temporarily falls back to another visible subscription, without forgetting the preference.

**Usage remaining**:
The percentage of an allowance still available in a particular **Usage window** for a Codex **Account**, an **Antigravity model group**, or the **Claude subscription**.
_Avoid_: Token count, usage consumed, spending

**Usage window**:
A period over which Codex, Antigravity, or Claude measures an allowance, such as the five-hour or weekly window. Each window has its own **Usage remaining** and **Reset time**.

**Reset time**:
The date and time when Codex, Antigravity, or Claude reports that a **Usage window** will reset.

**Notch**:
The compact, freely movable view of YouSage that previews the chosen **Notch preview**'s **Usage remaining**.
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
