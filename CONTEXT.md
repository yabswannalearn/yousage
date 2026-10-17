# YouSage

YouSage lets a person keep track of Codex usage across their personal and work accounts and Antigravity model quotas from a small desktop companion.

## Language

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
The reading currently displayed in the compact **Notch**—either the **Active account** in Codex or a chosen **Antigravity model group**.

**Usage remaining**:
The percentage of an allowance still available in a particular **Usage window** for a Codex **Account** or an **Antigravity model group**.
_Avoid_: Token count, usage consumed, spending

**Usage window**:
A period over which Codex or Antigravity measures an allowance, such as the five-hour or weekly window. Each window has its own **Usage remaining** and **Reset time**.

**Reset time**:
The date and time when Codex or Antigravity reports that a **Usage window** will reset.

**Notch**:
The compact, freely movable view of YouSage that previews the chosen **Notch preview**'s **Usage remaining**.
_Avoid_: Closed app, minimized app

**Detail panel**:
The view that expands in place from the **Notch** to inspect Codex usage for all **Connected accounts** alongside local **Antigravity model groups**.
_Avoid_: Open notch, dashboard

## Example dialogue

**Developer**: Where do you glance at usage while working?
**User**: In the notch. I open the detail panel when I want more information across Codex and Antigravity.

**Developer**: What does usage remaining mean?
**User**: How much of my Codex or Antigravity allowance is left in the five-hour and weekly windows, with the reset time for each.

**Developer**: How is Antigravity usage organized compared to Codex?
**User**: Codex has separate personal and work ChatGPT accounts that I can connect and switch between. Antigravity monitors my active local sign-in and shows model quota groups—Gemini Models, Claude and GPT models, and Gemini 4 Argon—in a dedicated section of the detail panel.

**Developer**: Does the notch show Codex or Antigravity?
**User**: Either one. I can choose in Settings or click **Show in notch** on the active Codex account or any Antigravity model group.

**Developer**: Which sign-in determines the active Codex account?
**User**: The Codex desktop app's sign-in, even if the terminal or editor uses another account.
