import type { AppTheme } from './theme';

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

export interface AntigravityGroup {
  id: string;
  label: string;
  description: string | null;
  fiveHour: UsageWindow | null;
  weekly: UsageWindow | null;
}

export interface AntigravityAccount {
  id: string;
  label: string;
  email: string | null;
  groups: AntigravityGroup[];
  updatedAt: number | null;
  error: string | null;
  active: boolean;
}

export interface AntigravityStatus {
  email: string | null;
  groups: AntigravityGroup[];
  accounts?: AntigravityAccount[];
  updatedAt: number | null;
  error: string | null;
}

export interface ClaudeStatus {
  email: string | null;
  plan: string | null;
  fiveHour: UsageWindow | null;
  weekly: UsageWindow | null;
  updatedAt: number | null;
  error: string | null;
}

export const defaultProviderColors = { codex: '#b7c8b1', antigravity: '#8ab4d8', claude: '#d99a7c' };
export type Provider = keyof typeof defaultProviderColors;

export function providerColor(colors: Partial<Record<Provider, string>> | undefined, provider: Provider): string {
  const color = colors?.[provider];
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : defaultProviderColors[provider];
}

export function effectiveNotchSource(source: string, hidden: readonly string[] = []): string {
  const visible = (provider: Provider) => !hidden.includes(provider);
  if (isBothNotch(source)) {
    if (visible('codex') && visible('antigravity')) return source;
    if (visible('codex')) return 'codex';
    if (visible('antigravity')) return source.replace(/^both/, 'antigravity');
  } else if (isAntigravityNotch(source) && visible('antigravity')) return source;
  else if (source === 'claude' && visible('claude')) return source;
  else if (source === 'codex' && visible('codex')) return source;
  return (['codex', 'antigravity', 'claude'] as const).find(visible) ?? 'none';
}

export interface Alert {
  id: string;
  title: string;
  message: string;
  kind: 'low' | 'reset' | string;
}

export interface UpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  releaseUrl: string | null;
  installerUrl: string | null;
  updateAvailable: boolean;
  checking: boolean;
  error: string | null;
}

export interface Snapshot {
  accounts: Account[];
  activeAccountId: string | null;
  antigravity: AntigravityStatus;
  claude: ClaudeStatus;
  alerts: Alert[];
  update: UpdateStatus;
  refreshing: boolean;
  desktopError: string | null;
  login: { status: string; error: string | null } | null;
  switching: string | null;
  settings: { startWithWindows: boolean; refreshSeconds: number; notchSource: string; notificationsEnabled: boolean; providerColors: Record<Provider, string>; hiddenProviders: Provider[]; appTheme: AppTheme };
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

export function isAntigravityNotch(notchSource: string | null | undefined): boolean {
  return notchSource === 'antigravity' || Boolean(notchSource?.startsWith('antigravity:'));
}

export function isBothNotch(notchSource: string | null | undefined): boolean {
  return notchSource === 'both' || Boolean(notchSource?.startsWith('both:'));
}

export function selectedAntigravityGroup(antigravity: AntigravityStatus | null | undefined, notchSource: string | null | undefined): AntigravityGroup | null {
  if (!antigravity?.groups.length) return null;
  const id = notchSource?.startsWith('antigravity:')
    ? notchSource.slice('antigravity:'.length)
    : notchSource?.startsWith('both:')
      ? notchSource.slice('both:'.length)
      : null;
  if (id) {
    const match = antigravity.groups.find(group => group.id === id);
    if (match) return match;
  }
  return antigravity.groups[0];
}

export function suggestedCodexSwitch(accounts: Account[], activeAccountId: string | null): Account | null {
  const visible = uniqueAccounts(accounts, activeAccountId);
  const active = visible.find(a => isActiveAccount(a, accounts, activeAccountId));
  if (!active) return null;
  const lowFive = active.fiveHour != null && active.fiveHour.remaining <= 20;
  const lowWeek = active.weekly != null && active.weekly.remaining <= 20;
  if (!lowFive && !lowWeek) return null;
  const candidates = visible.filter(a => !isActiveAccount(a, accounts, activeAccountId) && !a.desktop && !a.error);
  let best: Account | null = null;
  let bestScore = -1;
  for (const candidate of candidates) {
    const five = candidate.fiveHour?.remaining ?? 0;
    const week = candidate.weekly?.remaining ?? 0;
    if (five <= 35 || week <= 35) continue;
    const score = Math.min(five, week);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
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

export function freshness(reading: { updatedAt: number | null; error: string | null }, now = Date.now()): string {
  if (reading.error) return reading.updatedAt ? 'Last known usage' : 'Usage unavailable';
  if (!reading.updatedAt) return 'Waiting for usage';
  const age = Math.max(0, Math.floor(now / 1000 - reading.updatedAt));
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
