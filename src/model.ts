export interface UsageWindow {
  remaining: number;
  resetsAt: number | null;
}

export interface Account {
  id: string;
  label: string;
  email: string | null;
  plan: string | null;
  identity: string | null;
  fiveHour: UsageWindow | null;
  weekly: UsageWindow | null;
  updatedAt: number | null;
  error: string | null;
  desktop: boolean;
}

export interface Snapshot {
  accounts: Account[];
  activeAccountId: string | null;
  refreshing: boolean;
  desktopError: string | null;
  login: { status: string; error: string | null } | null;
  switching: string | null;
  settings: { startWithWindows: boolean; refreshSeconds: number };
}

export interface SwitchPlan {
  id: string;
  label: string;
  desktopRunning: boolean;
  cliRunning: boolean;
}

export function isActiveAccount(account: Account, accounts: Account[], activeAccountId: string | null): boolean {
  const desktop = accounts.find(a => a.id === activeAccountId);
  return account.id === activeAccountId || Boolean(account.identity && account.identity === desktop?.identity);
}

export function percentage(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '—' : `${Math.round(Math.min(100, Math.max(0, value)))}%`;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

export function resetLabel(seconds: number | null | undefined, now = Date.now()): string {
  if (seconds == null || !Number.isFinite(seconds)) return 'Reset time unavailable';
  const date = new Date(seconds * 1000);
  if (date.getTime() <= now) return 'Reset due · refreshing';
  const today = new Date(now);
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (date.toDateString() === today.toDateString()) return `Resets ${time}`;
  const day = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `Resets ${day}, ${time}`;
}

export function freshness(account: Account, now = Date.now()): string {
  if (account.error) return account.updatedAt ? 'Last known usage' : 'Usage unavailable';
  if (!account.updatedAt) return 'Waiting for usage';
  const age = Math.max(0, Math.floor(now / 1000 - account.updatedAt));
  return age < 90 ? 'Updated just now' : `Updated ${Math.floor(age / 60)}m ago`;
}

export function uniqueAccounts(accounts: Account[], activeAccountId: string | null): Account[] {
  const sorted = [...accounts].sort((a, b) => Number(b.id === activeAccountId) - Number(a.id === activeAccountId));
  const result: Account[] = [];
  const seen = new Map<string, number>();
  for (const account of sorted) {
    const previous = account.identity ? seen.get(account.identity) : undefined;
    if (previous != null) {
      // Keep the desktop reading authoritative, and the saved connection manageable.
      if (result[previous].desktop && !account.desktop) {
        result[previous] = { ...result[previous], id: account.id, label: account.label, desktop: false };
      }
      continue;
    }
    if (account.identity) seen.set(account.identity, result.length);
    result.push(account);
  }
  return result;
}
