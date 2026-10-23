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
export type AccountPurpose = 'any' | 'work' | 'personal';
export type PreviewWindowMode = 'fiveHour' | 'weekly' | 'limiting';

export interface UsagePreferences {
  notchProviders: Provider[];
  notchWindow: PreviewWindowMode;
  smartNotch?: boolean;
  alertRules: Record<Provider, { warningPercent: number; criticalPercent: number }> & {
    lowEnabled: boolean;
    resetEnabled: boolean;
    quietHoursEnabled: boolean;
    quietStart: string;
    quietEnd: string;
    snoozedUntil: number | null;
  };
  accountPreferences: Record<string, { purpose: AccountPurpose; excludeFromSuggestions: boolean }>;
  recommendationPurpose: AccountPurpose;
}

export const defaultUsagePreferences: UsagePreferences = {
  notchProviders: [],
  notchWindow: 'limiting',
  alertRules: {
    codex: { warningPercent: 20, criticalPercent: 10 },
    antigravity: { warningPercent: 20, criticalPercent: 10 },
    claude: { warningPercent: 20, criticalPercent: 10 },
    lowEnabled: true,
    resetEnabled: true,
    quietHoursEnabled: false,
    quietStart: '22:00',
    quietEnd: '08:00',
    snoozedUntil: null,
  },
  accountPreferences: {},
  recommendationPurpose: 'any',
};

const providers: Provider[] = ['codex', 'antigravity', 'claude'];
const purpose = (value: unknown): AccountPurpose => value === 'work' || value === 'personal' ? value : 'any';
const record = (value: unknown): Record<string, unknown> => value != null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Fill older settings with defaults and keep malformed saved values out of the UI. */
export function usagePreferences(settings?: { usagePreferences?: unknown } | null): UsagePreferences {
  const saved = record(settings?.usagePreferences);
  const rules = record(saved.alertRules);
  const normalized: UsagePreferences = {
    notchProviders: [],
    notchWindow: saved.notchWindow === 'fiveHour' || saved.notchWindow === 'weekly' ? saved.notchWindow : 'limiting',
    alertRules: {
      ...defaultUsagePreferences.alertRules,
      codex: { ...defaultUsagePreferences.alertRules.codex },
      antigravity: { ...defaultUsagePreferences.alertRules.antigravity },
      claude: { ...defaultUsagePreferences.alertRules.claude },
    },
    accountPreferences: {},
    recommendationPurpose: purpose(saved.recommendationPurpose),
  };
  if (typeof saved.smartNotch === 'boolean') normalized.smartNotch = saved.smartNotch;
  // Preserve the order selected by the person, while removing duplicates.
  if (Array.isArray(saved.notchProviders)) normalized.notchProviders = [...new Set(saved.notchProviders.filter((provider): provider is Provider => providers.includes(provider as Provider)))];
  for (const provider of providers) {
    const savedRule = record(rules[provider]);
    const warning = savedRule.warningPercent;
    const critical = savedRule.criticalPercent;
    const warningPercent = typeof warning === 'number' && Number.isFinite(warning) && warning > 0 && warning <= 100 ? warning : 20;
    const criticalPercent = typeof critical === 'number' && Number.isFinite(critical) && critical >= 0 && critical < warningPercent ? critical : Math.min(10, warningPercent / 2);
    normalized.alertRules[provider] = { warningPercent, criticalPercent };
  }
  for (const key of ['lowEnabled', 'resetEnabled', 'quietHoursEnabled'] as const) {
    if (typeof rules[key] === 'boolean') normalized.alertRules[key] = rules[key];
  }
  for (const key of ['quietStart', 'quietEnd'] as const) {
    if (typeof rules[key] === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(rules[key])) normalized.alertRules[key] = rules[key];
  }
  if (typeof rules.snoozedUntil === 'number' && Number.isFinite(rules.snoozedUntil) && rules.snoozedUntil > 0) normalized.alertRules.snoozedUntil = rules.snoozedUntil;
  const accountEntries = Object.entries(record(saved.accountPreferences)).filter(([id]) => /^(codex|antigravity):.+$/.test(id));
  normalized.accountPreferences = Object.fromEntries(accountEntries.map(([id, value]) => {
    const preference = record(value);
    return [id, { purpose: purpose(preference.purpose), excludeFromSuggestions: preference.excludeFromSuggestions === true }];
  }));
  return normalized;
}

export function notchProviders(source: string, preferences: UsagePreferences, hidden: readonly string[] = []): Provider[] {
  const selected = source === 'custom' || source.startsWith('custom:') ? preferences.notchProviders
    : isBothNotch(source) ? ['codex', 'antigravity'] as Provider[]
    : isAntigravityNotch(source) ? ['antigravity'] as Provider[]
    : source === 'claude' ? ['claude'] as Provider[] : ['codex'] as Provider[];
  const visible = [...new Set(selected)].filter(provider => providers.includes(provider) && !hidden.includes(provider));
  return visible.length ? visible : providers.filter(provider => !hidden.includes(provider)).slice(0, 1);
}

export function previewWindow(fiveHour: UsageWindow | null, weekly: UsageWindow | null, mode: PreviewWindowMode): { label: '5h' | 'Week'; window: UsageWindow | null } {
  if (mode === 'weekly') return weekly || !fiveHour ? { label: 'Week', window: weekly } : { label: '5h', window: fiveHour };
  if (!fiveHour && weekly) return { label: 'Week', window: weekly };
  if (mode === 'limiting' && weekly && (!fiveHour || weekly.remaining < fiveHour.remaining)) return { label: 'Week', window: weekly };
  return { label: '5h', window: fiveHour };
}

export interface ProviderHealth {
  status: 'checking' | 'ready' | 'signInRequired' | 'toolMissing' | 'rateLimited' | 'offline' | 'error';
  message: string;
  lastSuccessAt: number | null;
  nextRetryAt: number | null;
  recoveryCommand: string | null;
}

export interface HistorySample {
  at: number;
  remaining: number;
  resetsAt: number | null;
}

export interface PacingEstimate {
  percentagePointsPerHour: number;
  estimatedExhaustsAt: number;
  resetAt: number | null;
  mayRunOutBeforeReset: boolean;
  observedMinutes: number;
}

export interface HistorySeries {
  id: string;
  provider: Provider;
  accountId: string;
  label: string;
  groupLabel: string | null;
  window: 'fiveHour' | 'weekly';
  samples: HistorySample[];
  pacing: PacingEstimate | null;
}

export interface UsageHistory {
  series: HistorySeries[];
  retentionDays: number;
  recordingSince: number | null;
}

export interface NotificationStatus {
  availability: 'available' | 'disabledForApp' | 'disabledForUser' | 'disabledByPolicy' | 'unavailable';
  message: string;
  lastAttemptAt: number | null;
  lastError: string | null;
}

export function providerColor(colors: Partial<Record<Provider, string>> | undefined, provider: Provider): string {
  const color = colors?.[provider];
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : defaultProviderColors[provider];
}

export function effectiveNotchSource(source: string, hidden: readonly string[] = []): string {
  const visible = (provider: Provider) => !hidden.includes(provider);
  if ((source === 'custom' || source.startsWith('custom:')) && providers.some(visible)) return source;
  if (isBothNotch(source)) {
    if (visible('codex') && visible('antigravity')) return source;
    if (visible('codex')) return 'codex';
    if (visible('antigravity')) return source.replace(/^both/, 'antigravity');
  } else if (isAntigravityNotch(source) && visible('antigravity')) return source;
  else if (source === 'claude' && visible('claude')) return source;
  else if (source === 'codex' && visible('codex')) return source;
  return (['codex', 'antigravity', 'claude'] as const).find(visible) ?? 'none';
}

export function cycleNotchSource(currentSource: string, hidden: readonly string[] = [], antigravity?: AntigravityStatus | null): string {
  const visible = (provider: Provider) => !hidden.includes(provider);
  const groupId = selectedAntigravityGroup(antigravity, currentSource)?.id ?? antigravity?.groups[0]?.id;
  const agySource = groupId ? `antigravity:${groupId}` : 'antigravity';
  const bothSource = groupId ? `both:${groupId}` : 'both';
  const cycle: string[] = [];
  if (visible('codex')) cycle.push('codex');
  if (visible('antigravity')) cycle.push(agySource);
  if (visible('claude')) cycle.push('claude');
  if (visible('codex') && visible('antigravity')) cycle.push(bothSource);
  if (!cycle.length) return 'none';
  const effective = effectiveNotchSource(currentSource, hidden);
  const index = cycle.findIndex(item => item === effective || (item.startsWith('antigravity') && isAntigravityNotch(effective)) || (item.startsWith('both') && isBothNotch(effective)));
  return cycle[(index + 1) % cycle.length];
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
  health?: Record<Provider, ProviderHealth>;
  pacing?: Record<string, PacingEstimate>;
  settings: { startWithWindows: boolean; refreshSeconds: number; notchSource: string; notificationsEnabled: boolean; providerColors: Record<Provider, string>; hiddenProviders: Provider[]; appTheme: AppTheme; usagePreferences?: UsagePreferences; privacyMode?: boolean; historyRetentionDays?: number };
}

function privateAccountNames(snapshot: Snapshot): Map<string, string> {
  const aliases = new Map<string, string>();
  const identities = new Map<string, string>();
  let codexNumber = 0;
  for (const account of uniqueAccounts(snapshot.accounts, snapshot.activeAccountId)) {
    const alias = `Codex account ${++codexNumber}`;
    aliases.set(`codex:${account.id}`, alias);
    if (account.identity) identities.set(account.identity, alias);
  }
  for (const account of snapshot.accounts) {
    const alias = account.identity ? identities.get(account.identity) : undefined;
    if (!aliases.has(`codex:${account.id}`)) aliases.set(`codex:${account.id}`, alias ?? `Codex account ${++codexNumber}`);
  }
  const antigravity = snapshot.antigravity.accounts ?? [];
  antigravity.forEach((account, index) => aliases.set(`antigravity:${account.id}`, `Antigravity account ${index + 1}`));
  return aliases;
}

/** Redact display text only. Authentication and account IDs remain in the original snapshot. */
export function privacyText(value: string, snapshot: Snapshot): string {
  if (!snapshot.settings.privacyMode || !value) return value;
  const aliases = privateAccountNames(snapshot);
  const replacements = new Map<string, string>();
  const add = (name: string | null | undefined, alias: string) => {
    if (!name?.trim()) return;
    const key = name.toLocaleLowerCase();
    const existing = replacements.get(key);
    replacements.set(key, existing && existing !== alias ? 'Account' : alias);
  };
  for (const account of snapshot.accounts) {
    const alias = aliases.get(`codex:${account.id}`) ?? 'Codex account';
    add(account.label, alias); add(account.email, alias);
  }
  for (const account of snapshot.antigravity.accounts ?? []) {
    const alias = aliases.get(`antigravity:${account.id}`) ?? 'Antigravity account';
    add(account.label, alias); add(account.email, alias);
  }
  add(snapshot.antigravity.email, 'Antigravity account');
  add(snapshot.claude.email, 'Claude account');
  const names = [...replacements.keys()].sort((a, b) => b.length - a.length).map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const redacted = names.length ? value.replace(new RegExp(`(^|[^\\p{L}\\p{N}_])(${names.join('|')})(?=$|[^\\p{L}\\p{N}_])`, 'giu'), (_match, prefix: string, name: string) => prefix + replacements.get(name.toLocaleLowerCase())) : value;
  return redacted.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, 'Hidden account');
}

/** A render-only copy; callers must retain the original snapshot for account actions. */
export function privacySnapshot(snapshot: Snapshot): Snapshot {
  if (!snapshot.settings.privacyMode) return snapshot;
  const names = privateAccountNames(snapshot);
  const text = (value: string | null) => value == null ? null : privacyText(value, snapshot);
  return {
    ...snapshot,
    accounts: snapshot.accounts.map(account => ({ ...account, label: names.get(`codex:${account.id}`) ?? 'Codex account', email: null, error: text(account.error) })),
    antigravity: {
      ...snapshot.antigravity, email: null, error: text(snapshot.antigravity.error),
      groups: snapshot.antigravity.groups.map(group => ({ ...group, description: text(group.description) })),
      accounts: snapshot.antigravity.accounts?.map(account => ({ ...account, label: names.get(`antigravity:${account.id}`) ?? 'Antigravity account', email: null, error: text(account.error), groups: account.groups.map(group => ({ ...group, description: text(group.description) })) })),
    },
    claude: { ...snapshot.claude, email: null, error: text(snapshot.claude.error) },
    alerts: snapshot.alerts.map(alert => ({ ...alert, title: privacyText(alert.title, snapshot), message: privacyText(alert.message, snapshot) })),
    health: snapshot.health ? Object.fromEntries(Object.entries(snapshot.health).map(([provider, health]) => [provider, { ...health, message: privacyText(health.message, snapshot) }])) as Snapshot['health'] : undefined,
    desktopError: text(snapshot.desktopError),
    login: snapshot.login ? { ...snapshot.login, status: privacyText(snapshot.login.status, snapshot), error: text(snapshot.login.error) } : null,
    switching: text(snapshot.switching),
    update: { ...snapshot.update, error: text(snapshot.update.error) },
  };
}

export interface SwitchPlan {
  provider: 'codex' | 'antigravity';
  processNames: string[];
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
      : notchSource?.startsWith('custom:') ? notchSource.slice('custom:'.length) : null;
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

export interface AccountRecommendation {
  id: string;
  label: string;
  reason: string;
  remaining: number;
}

type AllowanceReading = { fiveHour: UsageWindow | null; weekly: UsageWindow | null; updatedAt: number | null; error: string | null };
type Capacity = { remaining: number; label: '5h' | 'Week'; resetsAt: number | null };
const recommendationFreshnessSeconds = 15 * 60;

function readingCapacity(reading: AllowanceReading, now: number, requireFiveHour: boolean, requireWeekly: boolean): Capacity | null {
  if (reading.error || reading.updatedAt == null || !Number.isFinite(reading.updatedAt) || reading.updatedAt > now / 1000 + 60 || now / 1000 - reading.updatedAt > recommendationFreshnessSeconds) return null;
  if ((requireFiveHour && !reading.fiveHour) || (requireWeekly && !reading.weekly)) return null;
  const windows: Capacity[] = [];
  for (const [label, window] of [['5h', reading.fiveHour], ['Week', reading.weekly]] as const) {
    if (!window) continue;
    if (!Number.isFinite(window.remaining) || window.remaining < 0 || window.remaining > 100 || (window.resetsAt != null && (!Number.isFinite(window.resetsAt) || window.resetsAt <= now / 1000))) return null;
    windows.push({ label, remaining: window.remaining, resetsAt: window.resetsAt });
  }
  return windows.sort((a, b) => a.remaining - b.remaining || (a.resetsAt ?? Infinity) - (b.resetsAt ?? Infinity))[0] ?? null;
}

function activeBottleneck(reading: AllowanceReading, now: number, warningPercent: number): Capacity | null {
  const windows = [['5h', reading.fiveHour], ['Week', reading.weekly]] as const;
  return windows.filter((entry): entry is readonly ['5h' | 'Week', UsageWindow] => entry[1] != null)
    .filter(([, window]) => window.remaining <= warningPercent && (window.resetsAt == null || window.resetsAt - now / 1000 > recommendationFreshnessSeconds))
    .map(([label, window]) => ({ label, remaining: window.remaining, resetsAt: window.resetsAt }))
    .sort((a, b) => a.remaining - b.remaining)[0] ?? null;
}

export interface SmartNotchFocus {
  provider: Provider;
  source: string;
  remaining: number;
  label: string;
}

/** When smartNotch is enabled, surface the most constrained visible subscription below its warning threshold. */
export function smartNotchFocus(snapshot: Snapshot, preferences = usagePreferences(snapshot.settings), now = Date.now()): SmartNotchFocus | null {
  if (!preferences.smartNotch) return null;
  const hidden = snapshot.settings.hiddenProviders ?? [];
  const visible = (provider: Provider) => !hidden.includes(provider);
  const currentProviders = notchProviders(snapshot.settings.notchSource, preferences, hidden);
  const candidates: SmartNotchFocus[] = [];
  if (visible('codex')) {
    const active = uniqueAccounts(snapshot.accounts, snapshot.activeAccountId).find(a => isActiveAccount(a, snapshot.accounts, snapshot.activeAccountId));
    if (active && readingCapacity(active, now, false, false)) {
      const low = activeBottleneck(active, now, preferences.alertRules.codex.warningPercent);
      if (low) candidates.push({ provider: 'codex', source: 'codex', remaining: low.remaining, label: active.label });
    }
  }
  if (visible('antigravity') && snapshot.antigravity.groups.length) {
    for (const group of snapshot.antigravity.groups) {
      const reading = { ...group, updatedAt: snapshot.antigravity.updatedAt, error: snapshot.antigravity.error };
      if (!readingCapacity(reading, now, false, false)) continue;
      const low = activeBottleneck(reading, now, preferences.alertRules.antigravity.warningPercent);
      if (low) candidates.push({ provider: 'antigravity', source: `antigravity:${group.id}`, remaining: low.remaining, label: group.label });
    }
  }
  if (visible('claude') && readingCapacity(snapshot.claude, now, false, false)) {
    const low = activeBottleneck(snapshot.claude, now, preferences.alertRules.claude.warningPercent);
    if (low) candidates.push({ provider: 'claude', source: 'claude', remaining: low.remaining, label: 'Claude' });
  }
  candidates.sort((a, b) => a.remaining - b.remaining);
  const best = candidates[0];
  if (!best) return null;
  if (currentProviders.includes(best.provider)) {
    if (best.provider !== 'antigravity') return null;
    const currentGroup = selectedAntigravityGroup(snapshot.antigravity, snapshot.settings.notchSource);
    if (currentGroup && `antigravity:${currentGroup.id}` === best.source) return null;
  }
  return best;
}

export function formatInlinePacing(pacing: PacingEstimate | null | undefined, now = Date.now()): { label: string; rateLabel: string; attention: boolean } | null {
  if (!pacing || !Number.isFinite(pacing.percentagePointsPerHour) || pacing.percentagePointsPerHour <= 0) return null;
  const rate = pacing.percentagePointsPerHour.toFixed(1).replace(/\.0$/, '');
  const rateLabel = `${rate}%/h`;
  if (pacing.mayRunOutBeforeReset) {
    return { label: `May run out ${compactResetLabel(pacing.estimatedExhaustsAt, now)}`, rateLabel, attention: true };
  }
  return { label: 'Pace steady until reset', rateLabel, attention: false };
}

function canRecommend(provider: 'codex' | 'antigravity', id: string, preferences: UsagePreferences): boolean {
  const saved = preferences.accountPreferences[`${provider}:${id}`];
  return !saved?.excludeFromSuggestions && (preferences.recommendationPurpose === 'any' || !saved || saved.purpose === 'any' || saved.purpose === preferences.recommendationPurpose);
}

function worthSwitching(active: Capacity, candidate: Capacity, warningPercent: number): boolean {
  return candidate.remaining > warningPercent && candidate.remaining >= active.remaining + 10;
}

function recommendationReason(active: Capacity, candidate: Capacity, now: number): string {
  const reset = active.resetsAt == null ? '' : ` Current ${active.label} allowance resets ${compactResetLabel(active.resetsAt, now)}.`;
  return `${percentage(candidate.remaining)} in its lowest window (${candidate.label}), compared with ${percentage(active.remaining)} in the current ${active.label} window.${reset}`;
}

/** Compare fresh allowances within Codex; switching remains an explicit user action. */
export function codexRecommendation(accounts: Account[], activeAccountId: string | null, preferences: UsagePreferences, now = Date.now()): AccountRecommendation | null {
  const distinct = uniqueAccounts(accounts, activeAccountId);
  const active = distinct.find(account => isActiveAccount(account, accounts, activeAccountId));
  if (!active) return null;
  const warning = preferences.alertRules.codex.warningPercent;
  if (!readingCapacity(active, now, true, true)) return null;
  const current = activeBottleneck(active, now, warning);
  if (!current) return null;
  let best: { account: Account; capacity: Capacity } | null = null;
  for (const account of distinct) {
    if (account.desktop || isActiveAccount(account, accounts, activeAccountId) || !canRecommend('codex', account.id, preferences)) continue;
    const capacity = readingCapacity(account, now, true, true);
    if (!capacity || !worthSwitching(current, capacity, warning)) continue;
    if (!best || capacity.remaining > best.capacity.remaining || (capacity.remaining === best.capacity.remaining && (capacity.resetsAt ?? Infinity) < (best.capacity.resetsAt ?? Infinity))) best = { account, capacity };
  }
  return best ? { id: best.account.id, label: best.account.label, remaining: best.capacity.remaining, reason: recommendationReason(current, best.capacity, now) } : null;
}

/** Compare the same Antigravity model group across saved accounts. */
export function antigravityRecommendation(status: AntigravityStatus, selectedGroupId: string | null | undefined, preferences: UsagePreferences, now = Date.now()): AccountRecommendation | null {
  const group = selectedGroupId ? status.groups.find(group => group.id === selectedGroupId) : status.groups[0];
  if (!group) return null;
  const activeReading = { ...group, updatedAt: status.updatedAt, error: status.error };
  const warning = preferences.alertRules.antigravity.warningPercent;
  if (!readingCapacity(activeReading, now, Boolean(group.fiveHour), Boolean(group.weekly))) return null;
  const current = activeBottleneck(activeReading, now, warning);
  if (!current) return null;
  let best: { account: AntigravityAccount; capacity: Capacity } | null = null;
  for (const account of status.accounts ?? []) {
    if (account.active || (account.email && status.email && account.email.toLowerCase() === status.email.toLowerCase()) || !canRecommend('antigravity', account.id, preferences)) continue;
    const matching = account.groups.find(candidate => candidate.id === group.id);
    if (!matching) continue;
    const capacity = readingCapacity({ ...matching, updatedAt: account.updatedAt, error: account.error }, now, Boolean(group.fiveHour), Boolean(group.weekly));
    if (!capacity || !worthSwitching(current, capacity, warning)) continue;
    if (!best || capacity.remaining > best.capacity.remaining || (capacity.remaining === best.capacity.remaining && (capacity.resetsAt ?? Infinity) < (best.capacity.resetsAt ?? Infinity))) best = { account, capacity };
  }
  return best ? { id: best.account.id, label: best.account.label, remaining: best.capacity.remaining, reason: `${group.label}: ${recommendationReason(current, best.capacity, now)}` } : null;
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

export function compactResetLabel(seconds: number | null | undefined, now = Date.now()): string {
  if (seconds == null || !Number.isFinite(seconds)) return 'Reset unknown';
  const minutes = Math.ceil((seconds * 1000 - now) / 60000);
  if (minutes <= 0) return 'Reset due';
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `in ${hours}h ${minutes % 60}m`;
  return `in ${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function freshness(reading: { updatedAt: number | null; error: string | null }, now = Date.now()): string {
  if (reading.updatedAt == null || !Number.isFinite(reading.updatedAt)) return reading.error ? 'Usage unavailable' : 'Waiting for usage';
  const age = Math.max(0, Math.floor(now / 1000 - reading.updatedAt));
  const ageLabel = age < 90 ? 'just now' : age < 3600 ? `${Math.floor(age / 60)}m ago` : age < 86400 ? `${Math.floor(age / 3600)}h ago` : `${Math.floor(age / 86400)}d ago`;
  return reading.error ? `Last known usage · ${ageLabel}` : `Updated ${ageLabel}`;
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
