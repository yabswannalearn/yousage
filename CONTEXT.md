# YouSage

YouSage lets a person keep track of Codex usage across their personal and work accounts from a small desktop companion.

## Language

**Account**:
A distinct ChatGPT login used to access Codex. A person can monitor multiple accounts, such as work and personal, each with its own **Usage remaining**.
_Avoid_: Workspace, profile

**Active account**:
The **Account** currently signed in to the Codex desktop app on the computer. Its **Usage remaining** is represented in the **Notch**.
_Avoid_: Selected account

**Connected account**:
An **Account** added to YouSage for ongoing monitoring, including when another **Account** is active. The **Detail panel** includes all connected accounts.

**Account switch**:
Choosing a **Connected account** to use in both the Codex desktop app and Codex CLI on the computer. Desktop and CLI switch together.

**Usage remaining**:
The percentage of an account's Codex allowance still available in a particular **Usage window**.
_Avoid_: Token count, usage consumed, spending

**Usage window**:
A period over which Codex measures an allowance, such as the five-hour or weekly window. Each window has its own **Usage remaining** and **Reset time**.

**Reset time**:
The date and time when Codex reports that a **Usage window** will reset.

**Notch**:
The compact, freely movable view of YouSage that previews the **Active account**'s Codex **Usage remaining**.
_Avoid_: Closed app, minimized app

**Detail panel**:
The view that expands in place from the **Notch** to inspect Codex usage for all **Connected accounts**.
_Avoid_: Open notch, dashboard

## Example dialogue

**Developer**: Where do you glance at usage while working?
**User**: In the notch. I open the detail panel when I want more information.

**Developer**: What does usage remaining mean?
**User**: How much of my Codex allowance is left in the five-hour and weekly windows, with the reset time for each.

**Developer**: Are work and personal two workspaces under one login?
**User**: No. They are separate accounts, and I want to see both accounts' usage at the same time.

**Developer**: Does the notch show every connected account at once?
**User**: It shows the active account. Expanding it opens the detail panel with all connected accounts on the computer.

**Developer**: Which sign-in determines the active account?
**User**: The Codex desktop app's sign-in, even if the terminal or editor uses another account.
