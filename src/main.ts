import './style.css';
import chatgptLogo from './assets/chatgpt-logo.svg';
import claudeLogo from './assets/claude-logo.svg';
import antigravityLogo from './assets/antigravity-logo.svg';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { defaultAppTheme, themePalette, themePresets, providerColorPresets, readableAccent, type AppTheme } from './theme';
import {
  escapeHtml as esc,
  freshness,
  percentage,
  resetLabel,
  compactResetLabel,
  uniqueAccounts,
  isActiveAccount,
  isAntigravityNotch,
  isBothNotch,
  selectedAntigravityGroup,
  codexRecommendation,
  antigravityRecommendation,
  notchProviders,
  previewWindow,
  usagePreferences,
  providerColor,
  defaultProviderColors,
  effectiveNotchSource,
  cycleNotchSource,
  smartNotchFocus,
  formatInlinePacing,
  privacySnapshot,
  privacyText,
  claudeNotchLimits,
  isClaudeNotch,
  visibleSessions,
  focusedSession,
  sessionStatusLabels,
  type Session,
  type Provider,
  type Account,
  type AntigravityAccount,
  type AntigravityGroup,
  type Snapshot,
  type SwitchPlan,
  type UsageWindow,
  type UsagePreferences,
  type UsageHistory,
  type HistorySeries,
  type PacingEstimate,
  type NotificationStatus,
} from './model';

const native = isTauri();
const params = new URLSearchParams(location.search);
const preview = !native && params.has('preview');
const root = document.querySelector<HTMLElement>('#app')!;
let snapshot: Snapshot = {
  accounts: [],
  activeAccountId: null,
  antigravity: { email: null, groups: [], accounts: [], updatedAt: null, error: null },
  claude: { email: null, plan: null, fiveHour: null, weekly: null, updatedAt: null, error: null },
  alerts: [],
  update: { currentVersion: '0.2.0', latestVersion: null, releaseUrl: null, installerUrl: null, updateAvailable: false, checking: false, error: null },
  refreshing: false,
  desktopError: null,
  login: null,
  switching: null,
  settings: { startWithWindows: true, refreshSeconds: 60, notchSource: 'codex', notificationsEnabled: true, providerColors: { ...defaultProviderColors }, hiddenProviders: [], appTheme: { ...defaultAppTheme } },
};
let expanded = false;
let pinned = false;
let pointerPosition = { x: -1, y: -1 };
let hoverCloseTimer: ReturnType<typeof setTimeout> | undefined;
let hoverOpenTimer: ReturnType<typeof setTimeout> | undefined;
let revealLatched = false;
const REVEAL_DELAY_MS = 200;
const REVEAL_STRIP_PX = 8;
let upward = false;
type DockEdge = 'floating' | 'top' | 'bottom' | 'left' | 'right';
type NotchLayout = { upward: boolean; height: number; width?: number; edge?: DockEdge; compactOffsetY?: number };
let dockEdge: DockEdge = 'floating';
function applyLayout(layout: NotchLayout) {
  upward = layout.upward;
  dockEdge = layout.edge ?? 'floating';
  root.dataset.edge = dockEdge;
  root.classList.toggle('upward', upward);
  if (layout.compactOffsetY === undefined) root.style.removeProperty('--compact-offset-y');
  else root.style.setProperty('--compact-offset-y', `${layout.compactOffsetY}px`);
  if (preview) {
    root.style.width = `${layout.width ?? 440}px`;
    root.style.height = `${layout.height}px`;
  }
}
type SettingsTab = 'all' | 'general' | 'appearance' | 'alerts' | 'system';
type PanelView = 'overview' | 'settings' | 'history' | Provider;
let panelView: PanelView = 'overview';
let overviewLead: Provider | undefined;
let settingsTab: SettingsTab = 'general';
let onboardingProviders = new Set<Provider>(['codex']);
const renderedRegions = new WeakMap<Element, string>();
let appliedThemeKey = '';
let adding = false;
let savingAgy = false;
let savingClaude = false;
let sessions: Session[] = [];
let managing: string | null = null;
let managingAgy: string | null = null;
let disconnectConfirmation: string | null = null;
let disconnectAgyConfirmation: string | null = null;
let error = '';
let transition = false;
let opening = false;
let preparingOpen = false;
let desiredHeight = 0;
let suppressToggleClick = false;
let dragging = false;
let colorPickerOpen = false;
let switchPlan: SwitchPlan | null = null;
let preparingSwitch: string | null = null;
let notice = '';
let rendering = false;
let preferenceDraft: UsagePreferences | null = null;
let notchSourceDraft: string | null = null;
let preferenceRevision = 0;
let preferenceSaves: Promise<unknown> = Promise.resolve();
let historyRange: 24 | 168 = 24;
let historyCompare = false;
let history: UsageHistory | null = null;
let historySeriesId = '';
let historyLoading = false;
let historyError = '';
let historyRequest = 0;
let historyRefreshTimer: ReturnType<typeof setTimeout> | undefined;
let clearHistoryConfirmation = false;
let notificationStatus: NotificationStatus | null = null;
let notificationChecking = false;
let renderSourceSnapshot: Snapshot | null = null;
let renderedPrivacy = false;
const redact = (value: string) => privacyText(value, renderSourceSnapshot ?? snapshot);

const paths: Record<string, string> = {
  pin: '<path d="m8 3 4 0-1 5 3 3v1H6v-1l3-3-1-5ZM10 12v5"/>',
  chevron: '<path d="m5 8 5 5 5-5"/>',
  plus: '<path d="M10 4v12M4 10h12"/>',
  refresh: '<path d="M16 8a6.2 6.2 0 1 0 .1 4M16 3v5h-5"/>',
  settings: `<path d="M8.6 2.5h2.8L11.8 4.2 13 4.7 14.5 3.8 16.2 5.5 15.3 7 15.8 8.2 17.5 8.6
    v2.8L15.8 11.8 15.3 13 16.2 14.5 14.5 16.2 13 15.3 11.8 15.8 11.4 17.5
    H8.6L8.2 15.8 7 15.3 5.5 16.2 3.8 14.5 4.7 13 4.2 11.8 2.5 11.4
    V8.6L4.2 8.2 4.7 7 3.8 5.5 5.5 3.8 7 4.7 8.2 4.2Z"/><circle cx="10" cy="10" r="2.5"/>`,
  hide: '<path d="M4 10h12"/>',
  x: '<path d="m5 5 10 10M15 5 5 15"/>',
  more: '<circle cx="4" cy="10" r=".6"/><circle cx="10" cy="10" r=".6"/><circle cx="16" cy="10" r=".6"/>',
  swap: '<path d="M3 6h13m-3-3 3 3-3 3M17 14H4m3-3-3 3 3 3"/>',
  history: '<path d="M3 15h14M4 12l4-4 3 2 5-6"/><path d="M3 3v14"/>',
  privacy: '<path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Z"/><circle cx="10" cy="10" r="2"/><path d="m3 3 14 14"/>',
};
const icon = (name: string) => `<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? ''}</svg>`;
const iconButton = (action: string, name: string, label: string, extra = '') => `<button type="button" class="icon-button" data-action="${action}" aria-label="${label}" title="${label}" ${extra}>${icon(name)}</button>`;

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (native) return invoke<T>(command, args);
  if (!preview) throw new Error('Open the YouSage desktop app to connect your accounts.');
  if (command === 'set_expanded') {
    const edge = dockEdge;
    const side = edge === 'left' || edge === 'right';
    const compact = side ? 184 : edge === 'floating' ? 80 : 40;
    return { edge, width: Math.min(innerWidth, side && !args?.expanded ? 58 : side || edge === 'floating' ? 440 : 480), upward: edge === 'bottom' || (edge === 'floating' && params.has('up')), height: args?.expanded ? Math.min(Math.max(compact, Number(args?.height ?? 80)), innerHeight - 64) : compact } as T;
  }
  if (command === 'get_snapshot') return snapshot as T;
  if (command === 'get_sessions') return sessions as T;
  if (command === 'set_session_tracking') snapshot.settings.sessionsEnabled = Boolean(args?.enabled);
  if (command === 'save_claude_account') {
    snapshot.claude.accounts = [...(snapshot.claude.accounts ?? []).filter(account => !account.active), { id: 'claude-personal', label: String(args?.label), email: snapshot.claude.email ?? 'personal@example.com', active: true }];
  }
  if (command === 'disconnect_claude_account') snapshot.claude.accounts = snapshot.claude.accounts?.filter(account => account.id !== args?.id);
  if (command === 'prepare_claude_switch') {
    const account = snapshot.claude.accounts?.find(account => account.id === args?.id)!;
    return { id: account.id, label: account.label, provider: 'claude', desktopRunning: false, cliRunning: true, processNames: ['claude.exe'] } as T;
  }
  if (command === 'switch_claude_account') {
    snapshot.claude.accounts?.forEach(account => { account.active = account.id === args?.id; if (account.active) snapshot.claude.email = account.email; });
  }
  if (command === 'get_usage_history') return previewHistory(Number(args?.rangeHours ?? 24)) as T;
  if (command === 'get_notification_status') return { availability: 'unavailable', message: 'Windows notifications can be checked in the desktop app. This screen uses preview data.', lastAttemptAt: null, lastError: null } as T;
  if (command === 'prepare_antigravity_switch') {
    const account = snapshot.antigravity.accounts?.find(a => a.id === args?.id)!;
    return { id: account.id, label: account.label, provider: 'antigravity', desktopRunning: false, cliRunning: true, processNames: ['agy.exe', 'pwsh.exe'] } as T;
  }
  if (command === 'prepare_switch') {
    const account = snapshot.accounts.find(a => a.id === args?.id)!;
    return { id: account.id, label: account.label, provider: 'codex', desktopRunning: true, cliRunning: params.has('cli'), processNames: ['Codex.exe', ...(params.has('cli') ? ['pwsh.exe'] : [])] } as T;
  }
  if (command === 'switch_account') {
    snapshot.switching = 'Switching desktop and CLI…'; render();
    await new Promise(resolve => setTimeout(resolve, 700));
    const account = snapshot.accounts.find(a => a.id === args?.id)!;
    const previous = snapshot.accounts.find(a => a.id === 'desktop');
    if (previous && !snapshot.accounts.some(a => !a.desktop && a.identity === previous.identity)) snapshot.accounts.push({ ...previous, id: 'preview-work', desktop: false });
    snapshot.accounts = snapshot.accounts.filter(a => a.id !== 'desktop');
    snapshot.accounts.push({ ...account, id: 'desktop', desktop: true });
    snapshot.activeAccountId = 'desktop'; snapshot.switching = null; render();
    return undefined as T;
  }
  if (command === 'refresh_usage') {
    const now = Date.now() / 1000;
    snapshot.accounts.forEach(account => { account.updatedAt = now; });
    snapshot.antigravity.updatedAt = now;
    if (snapshot.health) for (const health of Object.values(snapshot.health)) if (health && (!health.nextRetryAt || health.nextRetryAt <= now)) { health.lastSuccessAt = now; health.nextRetryAt = null; health.status = 'ready'; }
  } else if (command === 'set_privacy_mode') {
    snapshot.settings.privacyMode = Boolean(args?.enabled);
  } else if (command === 'update_history_settings') {
    snapshot.settings.historyRetentionDays = Number(args?.retentionDays);
  } else if (command === 'clear_usage_history') {
    previewHistoryCleared = true;
  } else if (command === 'export_usage_history') {
    return 'timestamp,provider,account,window,remaining_percent\n2026-10-23T00:00:00Z,codex,Codex account 1,fiveHour,75\n' as T;
  } else if (command === 'update_usage_preferences') {
    snapshot.settings.usagePreferences = args?.preferences as UsagePreferences;
  } else if (command === 'dismiss_alert') {
    snapshot.alerts = snapshot.alerts.filter(a => a.id !== args?.id);
  } else if (command === 'clear_alerts') {
    snapshot.alerts = [];
  } else if (command === 'save_antigravity_account') {
    const list = snapshot.antigravity.accounts ?? [];
    list.push({ id: `agy-${Date.now()}`, label: String(args?.label ?? 'Antigravity'), email: snapshot.antigravity.email, groups: snapshot.antigravity.groups, updatedAt: snapshot.antigravity.updatedAt, error: null, active: true });
    snapshot.antigravity.accounts = list;
  } else if (command === 'switch_antigravity_account') {
    const list = snapshot.antigravity.accounts ?? [];
    const target = list.find(a => a.id === args?.id);
    if (target) {
      list.forEach(a => { a.active = a.id === target.id; });
      snapshot.antigravity.email = target.email;
      snapshot.antigravity.groups = target.groups;
    }
  } else if (command === 'rename_antigravity_account') {
    const target = snapshot.antigravity.accounts?.find(a => a.id === args?.id);
    if (target) target.label = String(args?.label);
  } else if (command === 'disconnect_antigravity_account') {
    snapshot.antigravity.accounts = (snapshot.antigravity.accounts ?? []).filter(a => a.id !== args?.id || a.active);
  } else if (command === 'check_for_updates') {
    snapshot.update = { ...snapshot.update, latestVersion: snapshot.update.currentVersion, updateAvailable: false, checking: false, error: null };
  } else if (command === 'open_release_url') {
    window.open(String(args?.url ?? 'https://github.com/yabswannalearn/yousage/releases/latest'), '_blank', 'noopener');
  } else if (command === 'rename_account') {
    const account = snapshot.accounts.find(a => a.id === args?.id);
    if (account) account.label = String(args?.label);
  } else if (command === 'disconnect_account') {
    snapshot.accounts = snapshot.accounts.filter(account => account.id !== args?.id);
  } else if (command === 'set_provider_tracking') {
    const provider = args?.provider as Provider;
    const paused = (snapshot.settings.pausedProviders ?? []).filter(name => name !== provider);
    snapshot.settings.pausedProviders = args?.enabled ? paused : [...paused, provider];
  } else if (command === 'update_settings') {
    snapshot.settings = {
      ...snapshot.settings,
      startWithWindows: Boolean(args?.startWithWindows),
      refreshSeconds: Number(args?.refreshSeconds),
      notchSource: typeof args?.notchSource === 'string' ? args.notchSource : snapshot.settings.notchSource,
      notificationsEnabled: typeof args?.notificationsEnabled === 'boolean' ? args.notificationsEnabled : snapshot.settings.notificationsEnabled,
      providerColors: (args?.providerColors as Snapshot['settings']['providerColors']) ?? snapshot.settings.providerColors,
      hiddenProviders: (args?.hiddenProviders as Provider[]) ?? snapshot.settings.hiddenProviders,
      appTheme: (args?.appTheme as AppTheme) ?? snapshot.settings.appTheme,
    };
  } else if (command === 'test_notification') {
    throw new Error('Native notifications are available in the Windows app. This screen uses preview data.');
  } else if (command === 'connect_account') {
    throw new Error('Account sign-in is available in the Windows app. This screen uses preview data.');
  } else if (command === 'hide_notch') {
    expanded = false;
  }
  render();
  return undefined as T;
}

function usageRing(label: string, value: number | null | undefined) {
  const known = value != null && Number.isFinite(value);
  const remaining = known ? Math.min(100, Math.max(0, value)) : 0;
  return `<svg class="usage-ring ${known ? '' : 'unknown'}" viewBox="0 0 36 36" role="meter" aria-label="${esc(label)} remaining" aria-valuemin="0" aria-valuemax="100" ${known ? `aria-valuenow="${remaining}"` : 'aria-valuetext="Unavailable"'}><circle class="ring-track" cx="18" cy="18" r="15"/><circle class="ring-value" cx="18" cy="18" r="15" pathLength="100" stroke-dasharray="${remaining} 100"/></svg>`;
}

function smallReading(label: string, window: UsageWindow | null, provider: Provider) {
  const value = window?.remaining;
  const status = providerReading(provider);
  const stale = readingIsStale(status);
  const tooltip = `${providerNames[provider]} · ${status ? freshness(status) : 'Usage unavailable'}${status?.error ? ` · ${status.error}` : ''} · ${window ? resetLabel(window.resetsAt) : 'Usage unavailable'}`;
  return `<span class="small-reading ${stale ? 'cached-reading' : ''} ${value != null && value <= preferences().alertRules[provider].warningPercent ? 'low' : ''}" data-provider="${provider}" style="--sage:${providerColor(snapshot.settings.providerColors, provider)}" title="${esc(tooltip)}"><span class="provider-meter">${usageRing(`${providerNames[provider]} ${label}`, value)}${providerLogo(provider)}</span><span class="reading-copy"><span class="reading-line"><span class="reading-label">${label}</span><strong>${percentage(value)}</strong></span><span class="reading-reset" data-reset-at="${window?.resetsAt ?? ''}">${esc(compactResetLabel(window?.resetsAt))}</span></span></span>`;
}

const providerLogos: Record<Provider, string> = { codex: chatgptLogo, claude: claudeLogo, antigravity: antigravityLogo };
function providerLogo(provider: Provider) {
  return `<span class="provider-logo provider-logo-${provider}" data-logo="${provider}" aria-hidden="true" style="${esc(`--provider-logo:url(${JSON.stringify(providerLogos[provider])})`)}"></span>`;
}

const visible = (provider: Provider) => !snapshot.settings.hiddenProviders.includes(provider);
const tracking = (provider: Provider) => !snapshot.settings.pausedProviders?.includes(provider);
const notchSource = () => effectiveNotchSource(snapshot.settings.notchSource, snapshot.settings.hiddenProviders);
const providerNames: Record<Provider, string> = { codex: 'Codex', antigravity: 'Antigravity', claude: 'Claude' };
const providerSetup = {
  codex: 'Sign in to Codex on this PC, or connect a ChatGPT account.',
  antigravity: 'Install the Antigravity CLI and sign in with agy.',
  claude: 'Install Claude Code and run claude auth login.',
};
const preferences = () => preferenceDraft ?? usagePreferences(snapshot.settings);
const selectedProviders = () => notchProviders(snapshot.settings.notchSource, preferences(), snapshot.settings.hiddenProviders);
const inPreview = (provider: Provider) => selectedProviders().includes(provider);
const activeCodexAccount = () => snapshot.accounts.find(account => isActiveAccount(account, snapshot.accounts, snapshot.activeAccountId));
const providerReading = (provider: Provider) => provider === 'codex' ? activeCodexAccount() : snapshot[provider];
const readingIsStale = (reading: { error: string | null; updatedAt: number | null } | undefined) => Boolean(!reading?.updatedAt || reading.error || Date.now() / 1000 - reading.updatedAt > 900);

async function savePreferences(next: UsagePreferences, source?: string) {
  const revision = ++preferenceRevision;
  preferenceDraft = next;
  snapshot.settings.usagePreferences = next;
  if (source) { notchSourceDraft = source; snapshot.settings.notchSource = source; }
  render();
  const save = preferenceSaves.catch(() => undefined).then(async () => {
    await call('update_usage_preferences', { preferences: next });
    if (source) await call('update_settings', { ...snapshot.settings, notchSource: source });
  });
  preferenceSaves = save;
  try {
    await save;
    if (revision === preferenceRevision) {
      snapshot.settings.usagePreferences = next;
      if (notchSourceDraft) snapshot.settings.notchSource = notchSourceDraft;
      preferenceDraft = null; notchSourceDraft = null;
    }
  } catch (err) {
    if (revision === preferenceRevision) {
      preferenceDraft = null; notchSourceDraft = null;
      snapshot = await call<Snapshot>('get_snapshot');
    }
    throw err;
  }
}

function accountPreferenceControls(accountId: string, provider: Provider = 'codex') {
  const id = `${provider}:${accountId}`;
  const pref = preferences().accountPreferences[id] ?? { purpose: 'any', excludeFromSuggestions: false };
  return `<div class="account-preferences"><label class="setting-row" for="purpose-${esc(id)}"><span>Use for</span><select id="purpose-${esc(id)}" data-account-purpose="${esc(id)}">${(['any', 'work', 'personal'] as const).map(value => `<option value="${value}" ${pref.purpose === value ? 'selected' : ''}>${value === 'any' ? 'Any purpose' : value === 'work' ? 'Work' : 'Personal'}</option>`).join('')}</select></label><label class="setting-row" for="suggest-${esc(id)}"><span>Include in suggestions</span><input class="switch" id="suggest-${esc(id)}" type="checkbox" data-account-suggestions="${esc(id)}" ${pref.excludeFromSuggestions ? '' : 'checked'}/></label></div>`;
}

function elapsedLabel(at: number | null | undefined, now = Date.now() / 1000) {
  if (at == null) return 'No successful check yet';
  const seconds = Math.max(0, Math.floor(now - at));
  return `Last checked ${seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`} ago`;
}

function retryLabel(at: number | null | undefined) {
  if (at == null) return '';
  const seconds = Math.max(0, Math.ceil(at - Date.now() / 1000));
  return seconds > 0 ? `Next retry in ${seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`}` : 'Ready to retry';
}

const previewHistoryNow = Math.floor(Date.now() / 1000);
let previewHistoryCleared = false;
function previewHistory(rangeHours: number): UsageHistory {
  const at = previewHistoryNow;
  const series: HistorySeries[] = previewHistoryCleared ? [] : [
    { id: 'preview-codex-fiveHour', provider: 'codex', accountId: 'desktop', label: 'Work', groupLabel: null, window: 'fiveHour', samples: Array.from({ length: 13 }, (_, i) => ({ at: at - (12 - i) * 900, remaining: 90 - i * 6, resetsAt: at + 7200 })), pacing: { percentagePointsPerHour: 24, estimatedExhaustsAt: at + 2700, resetAt: at + 7200, mayRunOutBeforeReset: true, observedMinutes: 180 } },
    { id: 'preview-codex-personal-fiveHour', provider: 'codex', accountId: 'preview-personal', label: 'Personal', groupLabel: null, window: 'fiveHour', samples: Array.from({ length: 13 }, (_, i) => ({ at: at - (12 - i) * 900, remaining: 98 - i * 1, resetsAt: at + 10800 })), pacing: { percentagePointsPerHour: 4, estimatedExhaustsAt: at + 22 * 3600, resetAt: at + 10800, mayRunOutBeforeReset: false, observedMinutes: 180 } },
    { id: 'preview-claude-weekly', provider: 'claude', accountId: 'claude', label: 'Claude subscription', groupLabel: null, window: 'weekly', samples: Array.from({ length: 13 }, (_, i) => ({ at: at - (12 - i) * 3600, remaining: 94 - i, resetsAt: at + 345600 })), pacing: { percentagePointsPerHour: 1, estimatedExhaustsAt: at + 82 * 3600, resetAt: at + 345600, mayRunOutBeforeReset: true, observedMinutes: 720 } },
  ];
  return { series: series.map(item => ({ ...item, samples: item.samples.filter(sample => sample.at >= at - rangeHours * 3600) })), retentionDays: snapshot.settings.historyRetentionDays ?? 30, recordingSince: previewHistoryCleared ? null : at - 43200 };
}

function resolvePacing(provider: Provider, accountId: string, windowKey: 'fiveHour' | 'weekly', groupId?: string): PacingEstimate | null {
  const map = snapshot.pacing;
  if (map) {
    const direct = map[`${provider}:${accountId}:${groupId ?? ''}:${windowKey}`] ?? map[`${provider}:active:${groupId ?? ''}:${windowKey}`];
    if (direct) return direct;
  }
  const sourceSeries = history?.series ?? (preview && !previewHistoryCleared ? previewHistory(24).series : []);
  const match = sourceSeries.find(item => item.provider === provider && item.window === windowKey && (item.accountId === accountId || (provider === 'claude' && accountId === 'active')));
  return match?.pacing ?? null;
}

function cardPacingBadge(provider: Provider, accountId: string, groupId?: string) {
  const five = resolvePacing(provider, accountId, 'fiveHour', groupId);
  const week = resolvePacing(provider, accountId, 'weekly', groupId);
  const chosen = (five?.mayRunOutBeforeReset ? five : week?.mayRunOutBeforeReset ? week : five ?? week) ?? null;
  const formatted = formatInlinePacing(chosen);
  if (!formatted) return '';
  return `<span class="inline-pacing ${formatted.attention ? 'attention' : ''}" title="Recent allowance pace: ${esc(formatted.rateLabel)}"><span>${esc(formatted.label)}</span><span class="pacing-rate">${esc(formatted.rateLabel)}</span></span>`;
}

async function loadHistory() {
  if (panelView !== 'history') return;
  const request = ++historyRequest;
  historyLoading = true; historyError = ''; render();
  try {
    const result = await call<UsageHistory>('get_usage_history', { rangeHours: historyRange });
    if (request !== historyRequest || panelView !== 'history') return;
    history = result ?? { series: [], retentionDays: snapshot.settings.historyRetentionDays ?? 30, recordingSince: null };
    if (!history.series.some(series => series.id === historySeriesId)) historySeriesId = history.series[0]?.id ?? '';
  } catch (err) {
    if (request === historyRequest) historyError = err instanceof Error ? err.message : String(err);
  } finally {
    if (request === historyRequest) { historyLoading = false; render(); }
  }
}

function scheduleHistoryRefresh() {
  if (panelView !== 'history') return;
  clearTimeout(historyRefreshTimer);
  historyRefreshTimer = setTimeout(() => { void loadHistory(); }, 250);
}

async function checkNotifications() {
  if (notificationChecking) return;
  notificationChecking = true; render();
  try { notificationStatus = await call<NotificationStatus>('get_notification_status') ?? null; }
  catch (err) { notificationStatus = { availability: 'unavailable', message: 'Windows notification status could not be checked.', lastAttemptAt: null, lastError: err instanceof Error ? err.message : String(err) }; }
  finally { notificationChecking = false; render(); }
}

function notificationHealthSettings() {
  const status = notificationStatus;
  const blocked = status && status.availability !== 'available';
  return `<div class="notification-health" role="status"><p class="fine-print ${blocked ? 'attention' : ''}">${esc(redact(status?.message ?? 'Check whether Windows allows notifications for YouSage.'))}</p>${status?.lastError ? `<p class="health-message attention">${esc(redact(status.lastError))}</p>` : ''}<div class="history-actions"><button type="button" class="text-button" data-action="check-notifications" ${notificationChecking ? 'disabled' : ''}>${notificationChecking ? 'Checking Windows…' : 'Check notification status'}</button><button type="button" class="text-button" data-action="open-notification-settings">Open Windows notification settings</button></div></div>`;
}

const sampleTime = (at: number) => new Date(at * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
function buildChartSegments(series: HistorySeries, start: number, end: number) {
  const samples = series.samples.filter(sample => Number.isFinite(sample.at) && Number.isFinite(sample.remaining) && sample.at >= start && sample.at <= end).sort((a, b) => a.at - b.at);
  const x = (at: number) => 34 + (at - start) / (end - start) * 306;
  const y = (remaining: number) => 14 + (100 - Math.min(100, Math.max(0, remaining))) * 1.1;
  const intervals = samples.slice(1).map((sample, i) => sample.at - samples[i].at).filter(gap => gap > 0).sort((a, b) => a - b);
  const gapLimit = Math.max(900, (intervals[Math.floor(intervals.length / 2)] ?? 60) * 3);
  const segments: string[] = [];
  let segment: string[] = [];
  const resetMarkers: string[] = [];
  samples.forEach((sample, i) => {
    const previous = samples[i - 1];
    const reset = previous && (sample.remaining > previous.remaining + 3 || previous.resetsAt != null && sample.resetsAt != null && Math.abs(previous.resetsAt - sample.resetsAt) > 120);
    if (previous && (reset || sample.at - previous.at > gapLimit)) { if (segment.length > 1) segments.push(segment.join(' ')); segment = []; }
    if (reset) resetMarkers.push(`<line class="history-reset" x1="${x(sample.at)}" x2="${x(sample.at)}" y1="14" y2="124"><title>New allowance window observed ${esc(sampleTime(sample.at))}</title></line>`);
    segment.push(`${x(sample.at).toFixed(2)},${y(sample.remaining).toFixed(2)}`);
  });
  if (segment.length > 1) segments.push(segment.join(' '));
  return { samples, segments, resetMarkers, x, y };
}

function historyChart(series: HistorySeries, peerSeries: HistorySeries[] = []) {
  const end = Date.now() / 1000;
  const start = end - historyRange * 3600;
  const { samples, segments, resetMarkers, x, y } = buildChartSegments(series, start, end);
  if (!samples.length) return '<div class="history-empty"><p>No readings in this range.</p><span>Fresh usage checks are recorded while YouSage is running.</span></div>';
  const compareColors = ['#8ab4d8', '#d99a7c', '#e0af72', '#a89be6'];
  const overlays = historyCompare ? peerSeries.filter(peer => peer.id !== series.id).map((peer, idx) => {
    const built = buildChartSegments(peer, start, end);
    const stroke = compareColors[idx % compareColors.length];
    return { peer, stroke, latest: built.samples.at(-1)?.remaining, svg: built.segments.map(points => `<polyline class="history-line-compare" style="stroke:${stroke}" points="${points}"/>`).join('') };
  }).filter(item => item.svg) : [];
  const legend = overlays.length ? `<div class="history-legend" aria-label="Compared accounts"><span class="legend-item"><span class="legend-dot" style="background:var(--sage)"></span>${esc(redact(series.label))} (${percentage(samples.at(-1)?.remaining)})</span>${overlays.map(item => `<span class="legend-item"><span class="legend-dot" style="background:${item.stroke}"></span>${esc(redact(item.peer.label))} (${percentage(item.latest)})</span>`).join('')}</div>` : '';
  return `<svg class="history-chart" viewBox="0 0 354 168" role="img" aria-labelledby="history-chart-title history-chart-description"><title id="history-chart-title">${esc(redact(series.label))}, ${series.window === 'fiveHour' ? '5 hour' : 'weekly'} allowance remaining over ${historyRange === 24 ? '24 hours' : '7 days'}</title><desc id="history-chart-description">${samples.length} observed readings. Horizontal position is the actual sample time. Gaps and allowance resets are not connected. Latest reading: ${percentage(samples.at(-1)!.remaining)} remaining, ${esc(sampleTime(samples.at(-1)!.at))}.</desc>${[0, 50, 100].map(value => `<line class="history-grid" x1="34" x2="340" y1="${y(value)}" y2="${y(value)}"/><text class="history-axis" x="26" y="${y(value) + 3}" text-anchor="end">${value}%</text>`).join('')}${resetMarkers.join('')}${overlays.map(item => item.svg).join('')}${segments.map(points => `<polyline class="history-line" points="${points}"/>`).join('')}${samples.map(sample => `<circle class="history-point" cx="${x(sample.at)}" cy="${y(sample.remaining)}" r="2.4"><title>${esc(sampleTime(sample.at))} · ${percentage(sample.remaining)} remaining</title></circle>`).join('')}<text class="history-axis" x="34" y="147">${esc(sampleTime(start))}</text><text class="history-axis" x="340" y="147" text-anchor="end">${esc(sampleTime(end))}</text></svg>${legend}<p class="fine-print history-chart-caption">Observed allowance remaining · hover a reading for its time. Gaps and resets stay separate.</p>`;
}

function pacingCopy(series: HistorySeries) {
  const pacing = series.pacing;
  if (!pacing) return '<p class="fine-print pacing-empty">Not enough recent, comparable readings to estimate your pace. Keep YouSage running as you use this allowance.</p>';
  const observed = pacing.observedMinutes < 60 ? `${Math.round(pacing.observedMinutes)} minutes` : `${(pacing.observedMinutes / 60).toFixed(1).replace(/\.0$/, '')} hours`;
  const rate = pacing.percentagePointsPerHour.toFixed(1).replace(/\.0$/, '');
  return `<div class="pacing-summary ${pacing.mayRunOutBeforeReset ? 'attention' : ''}"><strong>${pacing.mayRunOutBeforeReset ? 'May run out before reset' : 'Allowance may last until reset'}</strong><p>At the recent pace, this allowance may run out around ${esc(sampleTime(pacing.estimatedExhaustsAt))}.${pacing.resetAt ? ` Reset: ${esc(sampleTime(pacing.resetAt))}.` : ''}</p><span>Approximate · ${rate} percentage points/hour over ${observed}. Your pace can change; this is account-wide usage.</span></div>`;
}

function historyPanel() {
  const series = history?.series ?? [];
  const selected = series.find(item => item.id === historySeriesId);
  const peers = selected ? series.filter(item => item.window === selected.window) : [];
  return `<section class="history-panel" aria-label="Usage history"><div class="settings-heading"><div><span class="eyebrow">${preview ? 'PREVIEW HISTORY' : 'LOCAL HISTORY'}</span><h2>History & pace</h2></div><div class="history-ranges" role="group" aria-label="History range"><button type="button" data-action="history-range" data-hours="24" aria-pressed="${historyRange === 24}">24 hours</button><button type="button" data-action="history-range" data-hours="168" aria-pressed="${historyRange === 168}">7 days</button></div></div>${historyError ? `<p class="health-message attention" role="alert">${esc(redact(historyError))}</p>` : ''}${historyLoading ? '<p class="fine-print" role="status">Loading history…</p>' : selected ? `<div class="history-controls-head"><label class="field-label" for="history-series">Account & allowance</label>${peers.length > 1 ? `<button type="button" class="text-button compare-toggle" data-action="toggle-history-compare" aria-pressed="${historyCompare}">${historyCompare ? 'Single series' : `Compare (${peers.length})`}</button>` : ''}</div><select id="history-series">${series.map(item => `<option value="${esc(item.id)}" ${item.id === selected.id ? 'selected' : ''}>${esc(providerNames[item.provider])} · ${esc(redact(item.label))}${item.groupLabel ? ` · ${esc(redact(item.groupLabel))}` : ''} · ${item.window === 'fiveHour' ? '5 hour' : 'Weekly'}</option>`).join('')}</select><div ${accentStyle(selected.provider)}>${historyChart(selected, peers)}${pacingCopy(selected)}</div>` : '<div class="history-empty"><p>Your history starts with fresh usage checks.</p><span>Keep YouSage running to see allowance changes and estimates here. Previous usage cannot be recovered.</span></div>'}<div class="history-actions"><button type="button" class="text-button" data-action="refresh-history" ${historyLoading ? 'disabled' : ''}>Refresh history</button><button type="button" class="text-button" data-action="export-history" ${historyLoading || !series.length ? 'disabled' : ''}>Export CSV</button><span class="fine-print">${history?.retentionDays ?? snapshot.settings.historyRetentionDays ?? 30} days stored locally</span></div></section>`;
}

function historySettings() {
  return `<div class="settings-pod"><h3>Local history</h3><label class="setting-row" for="history-retention"><span>Keep readings for</span><select id="history-retention">${[7, 30, 90].map(days => `<option value="${days}" ${(snapshot.settings.historyRetentionDays ?? 30) === days ? 'selected' : ''}>${days} days</option>`).join('')}</select></label><p class="fine-print">Only fresh allowance percentages and reset times are recorded. Reducing retention removes older readings.</p><div class="history-actions"><button type="button" class="text-button danger" data-action="clear-history">${clearHistoryConfirmation ? 'Confirm clear history' : 'Clear history'}</button>${clearHistoryConfirmation ? '<button type="button" class="text-button" data-action="cancel-clear-history">Cancel</button><span class="fine-print">Delete all recorded readings from this computer?</span>' : ''}</div></div>`;
}

function connectionHealthSettings() {
  const statusNames = { checking: 'Checking', ready: 'Connected', signInRequired: 'Sign in required', toolMissing: 'Tool missing', rateLimited: 'Rate limited', offline: 'Offline', error: 'Needs attention' };
  return `<div class="settings-pod"><h3>Connection health</h3>${(Object.keys(providerNames) as Provider[]).filter(visible).map(provider => {
    if (!tracking(provider)) {
      return `<div class="health-card" ${accentStyle(provider)}><div class="health-heading"><strong>${providerNames[provider]}</strong><span class="health-status">Tracking paused</span></div><p class="fine-print">Resume automatic checks in Settings → Preview, or use Refresh usage to check now.</p></div>`;
    }
    const fallback = provider === 'codex' ? snapshot.accounts.find(account => isActiveAccount(account, snapshot.accounts, snapshot.activeAccountId)) : snapshot[provider];
    const health = snapshot.health?.[provider];
    const ready = health?.status === 'ready';
    const coolingDown = Boolean(health?.nextRetryAt && health.nextRetryAt > Date.now() / 1000 && (provider === 'claude' || health.status === 'rateLimited'));
    return `<div class="health-card" ${accentStyle(provider)}><div class="health-heading"><strong>${providerNames[provider]}</strong><span class="health-status ${health && !ready ? 'attention' : ''}">${health ? statusNames[health.status] : fallback?.error ? 'Needs attention' : fallback?.updatedAt ? 'Connected' : 'Not checked'}</span></div><p class="fine-print" data-last-check="${health?.lastSuccessAt ?? fallback?.updatedAt ?? ''}">${esc(elapsedLabel(health?.lastSuccessAt ?? fallback?.updatedAt))}</p>${health?.message ? `<p class="health-message">${esc(health.message)}</p>` : ''}<div class="health-actions"><span class="fine-print" data-retry-at="${health?.nextRetryAt ?? ''}" data-retry-ready="${ready}">${esc(retryLabel(health?.nextRetryAt).replace(ready ? 'Next retry' : 'Never replace', 'Next check'))}</span><button type="button" class="text-button" data-action="refresh-health" data-provider="${provider}" ${snapshot.refreshing || coolingDown ? 'disabled' : ''}>${coolingDown ? 'Waiting to retry' : 'Refresh'}</button>${health?.recoveryCommand ? `<button type="button" class="text-button" data-action="copy-recovery" data-command="${esc(health.recoveryCommand)}">Copy sign-in command</button>` : ''}</div></div>`;
  }).join('')}</div>`;
}

function autoSwitchSettings() {
  const automatic = preferences().autoSwitch ?? { codex: false, antigravity: false, claude: false, sessions: 'wait' };
  const rows = (['codex', 'antigravity', 'claude'] as const).map(provider => {
    const count = provider === 'codex' ? snapshot.accounts.filter(account => !account.desktop).length : provider === 'antigravity' ? (snapshot.antigravity.accounts ?? []).filter(account => account.id !== 'active').length : snapshot.claude.accounts?.length ?? 0;
    const status = automatic[provider] ? snapshot.autoSwitch?.[provider] : null;
    return `<div class="auto-switch-provider"><label class="setting-row" for="auto-switch-${provider}"><span>${providerNames[provider]}<span class="fine-print">${count} saved account${count === 1 ? '' : 's'}</span></span><input class="switch" id="auto-switch-${provider}" type="checkbox" aria-label="Auto switch ${providerNames[provider]}" data-auto-switch="${provider}" ${automatic[provider] ? 'checked' : ''}/></label>${automatic[provider] ? `<p class="fine-print" role="status">${esc(status?.message ?? 'Watching for 0% remaining.')}${status?.nextAttemptAt && status.nextAttemptAt > Date.now() / 1000 ? ` Next attempt ${esc(retryLabel(status.nextAttemptAt))}.` : ''}</p>` : ''}</div>`;
  }).join('');
  return `<div class="settings-pod auto-switch-settings"><h3>Auto switch account</h3><p class="fine-print">At 0% remaining, use another saved account with available allowance. Account purpose and exclusions also apply here.</p>${rows}<label class="setting-row" for="auto-switch-sessions"><span>Open coding sessions</span><select id="auto-switch-sessions"><option value="wait" ${automatic.sessions === 'wait' ? 'selected' : ''}>Wait until sessions close</option><option value="close" ${automatic.sessions === 'close' ? 'selected' : ''}>Force-close sessions and switch</option></select></label>${automatic.sessions === 'close' ? '<p class="auto-switch-warning">Enabling a provider allows YouSage to force-close its apps and related terminal sessions at 0%. Tasks stop and unsaved work can be lost. Desktop apps reopen; start new terminal sessions yourself.</p>' : '<p class="fine-print">Waits for the affected apps and terminal sessions to close before switching.</p>'}<p class="fine-print">Antigravity follows your notch model group. Selecting Fable also monitors its separate weekly allowance. Switching is checked in the background, even when the notch is hidden.</p></div>`;
}

function alertSettings() {
  const rules = preferences().alertRules;
  return `<div class="settings-pod"><h3>Allowance alerts</h3><p class="fine-print">Thresholds are the percentage remaining. Critical must be lower than warning.</p><div class="threshold-grid"><span>Provider</span><span>Warning %</span><span>Critical %</span>${(Object.keys(providerNames) as Provider[]).map(provider => `<label for="warning-${provider}">${providerNames[provider]}</label><input id="warning-${provider}" aria-label="${providerNames[provider]} warning percent" type="number" min="1" max="100" step="1" data-alert-provider="${provider}" data-alert-level="warningPercent" value="${rules[provider].warningPercent}"/><input id="critical-${provider}" aria-label="${providerNames[provider]} critical percent" type="number" min="0" max="99" step="1" data-alert-provider="${provider}" data-alert-level="criticalPercent" value="${rules[provider].criticalPercent}"/>`).join('')}</div>${([['lowEnabled', 'Low allowance alerts'], ['resetEnabled', 'Reset alerts'], ['quietHoursEnabled', 'Quiet hours']] as const).map(([key, label]) => `<label class="setting-row" for="alert-${key}"><span>${label}</span><input id="alert-${key}" class="switch" type="checkbox" data-alert-toggle="${key}" ${rules[key] ? 'checked' : ''}/></label>`).join('')}<div class="quiet-times"><label for="quiet-start">From<input id="quiet-start" type="time" data-quiet-time="quietStart" value="${esc(rules.quietStart)}" ${rules.quietHoursEnabled ? '' : 'disabled'}/></label><label for="quiet-end">Until<input id="quiet-end" type="time" data-quiet-time="quietEnd" value="${esc(rules.quietEnd)}" ${rules.quietHoursEnabled ? '' : 'disabled'}/></label></div><p class="fine-print">Quiet hours follow your computer’s local time.</p><div class="setting-row"><span class="fine-print" data-snooze-until="${rules.snoozedUntil ?? ''}">${rules.snoozedUntil && rules.snoozedUntil > Date.now() / 1000 ? `Alerts snoozed · ${retryLabel(rules.snoozedUntil).replace('Next retry in ', '')} left` : 'Alerts active'}</span><button type="button" class="subtle-button" data-action="${rules.snoozedUntil && rules.snoozedUntil > Date.now() / 1000 ? 'resume-alerts' : 'snooze-alerts'}">${rules.snoozedUntil && rules.snoozedUntil > Date.now() / 1000 ? 'Resume alerts' : 'Snooze 1 hour'}</button></div></div>`;
}

function customPreviewSettings() {
  const prefs = preferences();
  const providers = notchProviders(snapshot.settings.notchSource, prefs, []);
  const group = selectedAntigravityGroup(snapshot.antigravity, snapshot.settings.notchSource);
  return `<div class="custom-preview"><div class="preview-providers" role="group" aria-label="Providers in notch">${(Object.keys(providerNames) as Provider[]).map(provider => `<label for="preview-${provider}" ${accentStyle(provider)}><input id="preview-${provider}" type="checkbox" aria-label="${providerNames[provider]} in notch" data-notch-provider="${provider}" ${providers.includes(provider) ? 'checked' : ''}/><span>${providerNames[provider]}${!visible(provider) ? ' · hidden' : ''}</span></label>`).join('')}</div><label class="setting-row" for="notch-window"><span>Preview window</span><select id="notch-window"><option value="limiting" ${prefs.notchWindow === 'limiting' ? 'selected' : ''}>Lowest remaining</option><option value="fiveHour" ${prefs.notchWindow === 'fiveHour' ? 'selected' : ''}>5 hour</option><option value="weekly" ${prefs.notchWindow === 'weekly' ? 'selected' : ''}>Weekly</option></select></label>${snapshot.antigravity.groups.length ? `<label class="setting-row" for="notch-group"><span>Antigravity group</span><select id="notch-group">${snapshot.antigravity.groups.map(item => `<option value="${esc(item.id)}" ${group?.id === item.id ? 'selected' : ''}>${esc(item.label)}</option>`).join('')}</select></label>` : ''}<label class="setting-row" for="smart-notch"><span>Smart auto-focus low allowance</span><input id="smart-notch" class="switch" type="checkbox" ${prefs.smartNotch ? 'checked' : ''}/></label><p class="fine-print">Combine any providers. Lowest remaining shows the tightest allowance for each. Smart auto-focus temporarily promotes low subscriptions.</p></div>`;
}

const accentVariables = (provider: Provider) => {
  const color = providerColor(snapshot.settings.providerColors, provider);
  return `--sage:${color};--accent-ink:${readableAccent(color, themePalette(snapshot.settings.appTheme)['--card'])}`;
};
const accentStyle = (provider: Provider) => `style="${accentVariables(provider)}"`;

function applyAppTheme(theme: AppTheme) {
  const key = `${theme.background}:${theme.accent}`;
  if (key === appliedThemeKey) return;
  appliedThemeKey = key;
  const palette = themePalette(theme);
  for (const [property, value] of Object.entries(palette)) root.style.setProperty(property, value);
  for (const element of root.querySelectorAll<HTMLElement>('[style]')) {
    const accent = element.style.getPropertyValue('--sage');
    if (accent) element.style.setProperty('--accent-ink', readableAccent(accent, palette['--card']));
  }
}

function appearanceSettings() {
  const theme = snapshot.settings.appTheme ?? defaultAppTheme;
  const presets = themePresets.map(preset => {
    const active = theme.background.toLowerCase() === preset.background.toLowerCase() && theme.accent.toLowerCase() === preset.accent.toLowerCase();
    return `<button type="button" class="preset-chip" data-action="theme-preset" data-bg="${preset.background}" data-accent="${preset.accent}" aria-pressed="${active}"><span class="preset-swatch" style="background:linear-gradient(135deg,${preset.background} 50%,${preset.accent} 50%)"></span><span>${esc(preset.label)}</span></button>`;
  }).join('');
  return `<div class="settings-pod appearance-settings"><div class="settings-heading"><h3>Appearance</h3><button type="button" class="text-button" data-action="reset-app-theme">Reset colors</button></div><p class="fine-print">Applies to the whole notch and detail panel.</p><div class="theme-presets" role="group" aria-label="Theme presets">${presets}</div>${(['background', 'accent'] as const).map(key => `<label class="setting-row" for="app-${key}"><span>${key === 'background' ? 'App background' : 'UI accent'}</span><span class="color-control"><span class="color-value" data-theme-value="${key}">${esc(theme[key])}</span><input type="color" id="app-${key}" aria-label="${key === 'background' ? 'App background' : 'UI accent'}" data-theme="${key}" value="${esc(theme[key])}"/></span></label>`).join('')}</div>`;
}

function claudeSection() {
  const { claude } = snapshot;
  const inNotch = inPreview('claude');
  const paceBadge = cardPacingBadge('claude', 'claude');
  const saveForm = savingClaude && !snapshot.settings.privacyMode ? `<form class="manage-form" data-form="save-claude"><label class="field-label" for="claude-save-label">Name this Claude Code account</label><div class="inline-input"><input id="claude-save-label" name="label" value="${esc(claude.accounts?.find(account => account.active)?.label ?? claude.email?.split('@')[0] ?? 'Personal')}" maxlength="48" required autocomplete="off"/><button class="subtle-button" type="submit">Save</button><button class="text-button" type="button" data-action="cancel-save-claude">Cancel</button></div></form>` : '';
  const models = (claude.modelLimits ?? []).map(group => `<article class="account-card model-allowance"><div class="account-heading"><span class="avatar">${esc(group.label[0])}</span><div class="account-identity"><div class="account-name">${esc(group.label)}${snapshot.settings.notchSource === `claude:${group.id}` ? '<span class="active-badge">In notch</span>' : `<button class="text-button notch-pill" data-action="set-notch" data-source="claude:${esc(group.id)}">Show in notch</button>`}</div><div class="account-email">${esc(group.description ?? 'Separate weekly allowance')}</div></div></div><div class="limits weekly-only">${limitRow('Weekly', group.weekly, 'claude')}</div></article>`).join('');
  const accounts = (claude.accounts ?? []).map(account => `<div class="saved-claude-account"><div class="account-identity"><strong>${esc(account.label)}</strong><span class="account-email">${esc(account.email)}${account.active ? ' · Active' : ''}</span></div>${!account.active ? `<button class="subtle-button" data-action="switch-claude" data-id="${esc(account.id)}" ${snapshot.switching || preparingSwitch || switchPlan ? 'disabled' : ''}>Switch account</button>` : ''}${iconButton('remove-claude', 'x', 'Remove saved Claude account', `data-id="${esc(account.id)}" ${snapshot.switching ? 'disabled' : ''}`)}</div>`).join('');
  return `<section class="provider-section" aria-label="Claude usage" ${accentStyle('claude')}><div class="section-divider"><span class="eyebrow">CLAUDE</span><div class="provider-heading"><h2>Subscription usage</h2>${claude.email && !snapshot.settings.privacyMode ? '<button class="text-button" data-action="save-claude">Save sign-in</button>' : ''}</div></div><article class="account-card ${inNotch ? 'active' : ''}"><div class="account-heading"><span class="avatar">C</span><div class="account-identity"><div class="account-name">Claude${claude.plan ? `<span class="plan"> · ${esc(claude.plan)}</span>` : ''}${inNotch && !snapshot.settings.notchSource.startsWith('claude:') ? '<span class="active-badge">In notch</span>' : '<button type="button" class="text-button notch-pill" data-action="set-notch" data-source="claude">Show in notch</button>'}</div><div class="account-email">${esc(claude.email ?? 'Claude Code subscription')}</div></div></div><div class="limits">${limitRow('5 hour', claude.fiveHour, 'claude')}${limitRow('Weekly', claude.weekly, 'claude')}</div><div class="account-status ${claude.error ? 'attention' : ''}"><span class="status-dot"></span><span>${esc(freshness(claude))}</span>${paceBadge}</div>${claude.error ? `<p class="account-error">${esc(claude.error)}</p>` : ''}${!claude.email ? providerRecovery('claude') : ''}${saveForm}</article>${models}${accounts ? `<div class="claude-accounts">${accounts}${(claude.accounts ?? []).map(account => `<details id="claude-preferences-${esc(account.id)}" class="claude-account-preferences"><summary>${esc(account.label)} preferences</summary>${accountPreferenceControls(account.id, 'claude')}</details>`).join('')}</div>` : ''}<p class="fine-print">Save each sign-in once to switch Claude Code accounts. To add another, run <code>claude auth login</code>, then save that sign-in here.</p></section>`;
}

function currentSessions() {
  return visibleSessions(sessions, snapshot.settings.hiddenProviders, Boolean(snapshot.settings.privacyMode));
}

function sessionList(list: Session[]) {
  if (!list.length) return '';
  return `<section class="session-list" aria-label="Coding sessions">${list.map(session => `<div class="session-item" data-status="${session.status}"><span class="session-indicator" aria-hidden="true"></span><span class="session-label">${esc(session.title ?? session.label)}</span><span class="session-provider">${session.provider === 'claude' ? 'Claude Code' : providerNames[session.provider]}</span><span class="session-status">${sessionStatusLabels[session.status]}</span></div>`).join('')}</section>`;
}

function limitRow(label: string, window: UsageWindow | null, provider: Provider = 'codex') {
  const value = window?.remaining;
  return `<div class="limit ${value != null && value <= preferences().alertRules[provider].warningPercent ? 'low' : ''}">${usageRing(label, value)}<div class="limit-copy"><div class="limit-heading"><span>${label}</span><strong>${percentage(value)}<span class="remaining-word"> left</span></strong></div><div class="reset">${window ? esc(resetLabel(window.resetsAt)) : 'Limit unavailable'}</div></div></div>`;
}

function alertsBanner() {
  const visibleAlerts = snapshot.alerts.filter(alert => !(snapshot.settings.hiddenProviders ?? []).some(provider => alert.id.startsWith(`${provider === 'antigravity' ? 'agy' : provider}:`)));
  if (!visibleAlerts.length) return '';
  return `<div class="alerts-header"><span class="eyebrow">NOTIFICATIONS (${visibleAlerts.length})</span><button type="button" class="text-button" data-action="clear-alerts">Clear all</button></div>${visibleAlerts.map(alert => `<div class="alert-banner ${alert.kind === 'reset' ? 'reset' : 'low'}" role="status"><div class="suggest-copy"><strong>${esc(alert.title)}</strong><span>${esc(alert.message)}</span></div>${iconButton('dismiss-alert', 'x', 'Dismiss alert', `data-id="${esc(alert.id)}"`)}</div>`).join('')}`;
}

function accountSuggestion(provider: Provider) {
  if (switchPlan || snapshot.switching || provider === 'claude') return '';
  const prefs = preferences();
  const recommendation = provider === 'codex'
    ? codexRecommendation(snapshot.accounts, snapshot.activeAccountId, prefs)
    : antigravityRecommendation(snapshot.antigravity, selectedAntigravityGroup(snapshot.antigravity, snapshot.settings.notchSource)?.id ?? null, prefs);
  if (!recommendation) return '';
  const action = provider === 'codex' ? 'prepare-switch' : 'switch-agy';
  return `<div class="suggest-banner" role="status" data-recommendation="${provider}"><div class="suggest-copy"><strong>${providerNames[provider]} account suggestion</strong><span>${esc(recommendation.reason)}</span></div><button type="button" class="subtle-button" data-action="${action}" data-id="${esc(recommendation.id)}">Switch to ${esc(recommendation.label)}</button></div>`;
}

function accountCard(account: Account) {
  const active = isActiveAccount(account, snapshot.accounts, snapshot.activeAccountId);
  const inNotch = active && inPreview('codex');
  const initial = esc((account.label || account.email || 'C').charAt(0).toUpperCase());
  const id = esc(account.id);
  const notchAction = active && !inNotch ? `<button type="button" class="text-button notch-pill" data-action="set-notch" data-source="codex">Show in notch</button>` : '';
  const controls = managing === account.id ? `<form class="manage-form" data-form="rename" data-id="${id}"><label class="field-label" for="name-${id}">Account name</label><div class="inline-input"><input id="name-${id}" name="label" value="${esc(account.label)}" maxlength="48" required autocomplete="off" ${snapshot.settings.privacyMode ? 'disabled' : ''}/><button class="subtle-button" type="submit" ${snapshot.settings.privacyMode ? 'disabled' : ''}>Save</button></div>${account.desktop ? '<p class="fine-print">Connect this account to save its preferences.</p>' : accountPreferenceControls(account.id)}<div class="manage-actions">${account.desktop ? '<span class="fine-print">Sign-in is managed in Codex.</span>' : `<button type="button" class="text-button" data-action="reconnect" data-id="${id}">Sign in again</button><button type="button" class="text-button danger" data-action="disconnect" data-id="${id}">${disconnectConfirmation === account.id ? 'Confirm disconnect' : 'Disconnect'}</button>`}</div></form>` : '';
  const switchButton = !active && !account.desktop ? `<button class="switch-account-button" data-action="prepare-switch" data-id="${id}" ${snapshot.switching || preparingSwitch || switchPlan || snapshot.login && !snapshot.login.error ? 'disabled' : ''}>${icon('swap')}<span>${preparingSwitch === account.id ? 'Checking Codex…' : 'Switch to this account'}</span><span aria-hidden="true">→</span></button>` : '';
  const paceBadge = cardPacingBadge('codex', active ? 'desktop' : account.id);
  return `<article ${accentStyle('codex')} class="account-card ${active ? 'active' : ''}"><div class="account-heading"><span class="avatar">${initial}</span><div class="account-identity"><div class="account-name">${esc(account.label)}${active ? `<span class="active-badge">${inNotch ? 'Active · In notch' : 'Active'}</span>` : ''}${notchAction}</div><div class="account-email" title="${esc(account.email ?? '')}">${esc(account.email ?? 'ChatGPT account')}${account.plan ? `<span class="plan"> · ${esc(account.plan)}</span>` : ''}</div></div>${iconButton('manage', 'more', 'Manage account', `data-id="${id}" ${snapshot.switching || preparingSwitch || switchPlan ? 'disabled' : ''}`)}</div><div class="limits">${limitRow('5 hour', account.fiveHour)}${limitRow('Weekly', account.weekly)}</div><div class="account-status ${account.error ? 'attention' : ''}"><span class="status-dot"></span><span>${esc(freshness(account))}</span>${paceBadge}</div>${account.error ? `<p class="account-error">${esc(account.error)}</p>` : ''}${controls}${switchButton}</article>`;
}

function antigravityGroupCard(group: AntigravityGroup, selectedId: string | undefined) {
  const inNotch = inPreview('antigravity') && selectedId === group.id;
  const initial = esc((group.label || 'A').charAt(0).toUpperCase());
  const source = `antigravity:${esc(group.id)}`;
  const bothSource = `both:${esc(group.id)}`;
  const subtitle = group.description ?? snapshot.antigravity.email ?? 'Antigravity model group';
  return `<article class="account-card ${inNotch ? 'active' : ''}"><div class="account-heading"><span class="avatar">${initial}</span><div class="account-identity"><div class="account-name">${esc(group.label)}${inNotch ? '<span class="active-badge">In notch</span>' : `<button type="button" class="text-button notch-pill" data-action="set-notch" data-source="${source}">Show in notch</button><button type="button" class="text-button notch-pill" data-action="set-notch" data-source="${bothSource}" title="Show Codex + ${esc(group.label)} together in notch">Both in notch</button>`}</div><div class="account-email" title="${esc(subtitle)}">${esc(subtitle)}</div></div></div><div class="limits">${limitRow('5 hour', group.fiveHour, 'antigravity')}${limitRow('Weekly', group.weekly, 'antigravity')}</div></article>`;
}

function savedAntigravityAccountCard(acc: AntigravityAccount) {
  const id = esc(acc.id);
  const initial = esc((acc.label || acc.email || 'A').charAt(0).toUpperCase());
  const primary = acc.groups[0];
  const controls = managingAgy === acc.id ? `<form class="manage-form" data-form="rename-agy" data-id="${id}"><label class="field-label" for="agy-name-${id}">Account name</label><div class="inline-input"><input id="agy-name-${id}" name="label" value="${esc(acc.label)}" maxlength="48" required autocomplete="off" ${snapshot.settings.privacyMode ? 'disabled' : ''}/><button class="subtle-button" type="submit" ${snapshot.settings.privacyMode ? 'disabled' : ''}>Save</button></div>${accountPreferenceControls(acc.id, 'antigravity')}<div class="manage-actions"><button type="button" class="text-button danger" data-action="disconnect-agy" data-id="${id}">${disconnectAgyConfirmation === acc.id ? 'Confirm remove' : 'Remove saved account'}</button></div></form>` : '';
  return `<article class="account-card"><div class="account-heading"><span class="avatar">${initial}</span><div class="account-identity"><div class="account-name">${esc(acc.label)}<span class="active-badge">Saved AGY</span></div><div class="account-email" title="${esc(acc.email ?? '')}">${esc(acc.email ?? 'Google Antigravity account')}</div></div>${iconButton('manage-agy', 'more', 'Manage Antigravity account', `data-id="${id}"`)}</div>${primary ? `<div class="limits">${limitRow(`${primary.label} · 5h`, primary.fiveHour, 'antigravity')}${limitRow(`${primary.label} · Wk`, primary.weekly, 'antigravity')}</div>` : ''}<div class="account-status ${acc.error ? 'attention' : ''}"><span class="status-dot"></span>${esc(freshness(acc))}</div>${acc.error ? `<p class="account-error">${esc(acc.error)}</p>` : ''}${controls}<button class="switch-account-button" data-action="switch-agy" data-id="${id}">${icon('swap')}<span>Switch Antigravity to ${esc(acc.label)}</span><span aria-hidden="true">→</span></button></article>`;
}

function antigravitySection() {
  const { antigravity } = snapshot;
  const selected = selectedAntigravityGroup(antigravity, snapshot.settings.notchSource);
  const savedAccounts = (antigravity.accounts ?? []).filter(a => !a.active);
  const activeSaved = (antigravity.accounts ?? []).find(a => a.active && a.id !== 'active');
  const saveForm = savingAgy && !snapshot.settings.privacyMode ? `<form class="manage-form agy-save-form" data-form="save-agy"><label class="field-label" for="agy-save-label">Save current Antigravity sign-in (${esc(antigravity.email ?? 'active')})</label><div class="inline-input"><input id="agy-save-label" name="label" value="${esc(activeSaved?.label ?? antigravity.email?.split('@')[0] ?? 'Personal')}" placeholder="Work or Personal" maxlength="48" required autocomplete="off"/><button class="subtle-button" type="submit">Save</button><button class="text-button" type="button" data-action="cancel-save-agy">Cancel</button></div></form>` : '';
  return `<section class="provider-section" aria-label="Antigravity usage" ${accentStyle('antigravity')}><div class="section-divider"><div><span class="eyebrow">ANTIGRAVITY</span><div class="provider-heading"><h2>Model quotas<span class="account-count">${antigravity.groups.length}</span></h2><span class="account-status provider-status ${antigravity.error ? 'attention' : ''}"><span class="status-dot"></span>${esc(freshness(antigravity))}</span></div>${antigravity.email ? `<div class="provider-email">${esc(antigravity.email)}${activeSaved ? ` · <strong>${esc(activeSaved.label)}</strong>` : ''}${!savingAgy && !snapshot.settings.privacyMode ? ` <button type="button" class="text-button notch-pill" data-action="toggle-save-agy">${activeSaved ? 'Update saved' : 'Save sign-in'}</button>` : ''}</div>` : ''}</div></div>${saveForm}${antigravity.groups.map(group => antigravityGroupCard(group, selected?.id)).join('')}${savedAccounts.map(savedAntigravityAccountCard).join('')}${antigravity.groups.length === 0 ? `<div class="empty-state compact-empty"><h2>${snapshot.refreshing ? 'Checking Antigravity' : 'Antigravity quota'}</h2><p>${esc(antigravity.error ?? 'Sign in with Antigravity CLI (agy) to view model quotas.')}</p>${!antigravity.email ? providerRecovery('antigravity') : ''}</div>` : antigravity.error ? `<p class="account-error">${esc(antigravity.error)}</p>` : ''}</section>`;
}

function switchPanel() {
  if (snapshot.switching) return `<section class="switch-panel" role="status"><h2>Switching account</h2><p>${esc(snapshot.switching)}</p></section>`;
  if (!switchPlan) return '';
  const plan = switchPlan;
  const provider = plan.provider === 'claude' ? 'Claude Code' : plan.provider === 'antigravity' ? 'Antigravity' : 'Codex';
  const running = plan.processNames.length > 0;
  return `<section class="switch-panel" role="dialog" aria-labelledby="switch-title"><div class="section-heading"><h2 id="switch-title">Switch ${provider} account</h2>${iconButton('cancel-switch', 'x', 'Cancel account switch')}</div><div class="switch-route"><span>Current sign-in</span>${icon('swap')}<strong>${esc(redact(plan.label))}</strong></div><span class="switch-targets">${plan.provider === 'claude' ? 'Claude Code sign-in' : `${provider} desktop + CLI`}</span><p>${running ? `Continuing force-closes these apps and related terminal sessions: ${plan.processNames.map(name => esc(redact(name))).join(', ')}. Running tasks will stop and unsaved work may be lost. ${plan.provider === 'claude' ? 'Start new Claude Code sessions after switching.' : 'Desktop apps will reopen after switching; start new terminal sessions yourself.'}` : `New ${provider} sessions will use this account. If a session starts before you confirm, the switch will ask you to check again.`}</p><button id="confirm-switch" class="primary-button" data-action="confirm-switch">${running ? 'Close sessions and switch' : 'Switch account'}<span aria-hidden="true">→</span></button><p class="switch-footnote">Your current account stays connected in YouSage.</p></section>`;
}

function overviewReadings(provider: Provider, effectiveSource: string) {
  const reading = providerReading(provider);
  const group = provider === 'antigravity' ? selectedAntigravityGroup(snapshot.antigravity, effectiveSource)
    : provider === 'claude' ? snapshot.claude.modelLimits?.find(item => effectiveSource === `claude:${item.id}`) : null;
  const limits = group ?? (provider === 'claude' ? snapshot.claude : provider === 'codex' ? activeCodexAccount() : null);
  const context = group?.label ?? (provider === 'codex' && reading && 'label' in reading ? reading.label : '');
  const windows = [['5 hour', limits?.fiveHour], ['Weekly', limits?.weekly]] as const;
  const available = windows.filter(([, window]) => window);
  const paused = !tracking(provider);
  const stale = reading && available.length > 0 && readingIsStale(reading);
  const age = reading && (stale || paused) && available.length ? freshness({ ...reading, error: 'cached' }) : '';
  const health = snapshot.health?.[provider];
  const status = paused ? ['Tracking paused', age].filter(Boolean).join(' · ')
    : available.length ? age
    : snapshot.refreshing || health?.status === 'checking' ? 'Checking usage…' : 'Usage unavailable';
  const recovery = !paused && !snapshot.refreshing && !available.length && health?.status !== 'ready' && health?.status !== 'checking'
    ? health?.message || providerSetup[provider] : '';
  const warning = preferences().alertRules[provider].warningPercent;
  const readings = available.map(([label, window]) => `<div class="overview-limit${window!.remaining <= warning ? ' low' : ''}"><span>${label}</span><strong>${percentage(window!.remaining)}</strong><small>${esc(resetLabel(window!.resetsAt))}</small></div>`).join('');
  return `${context || status ? `<div class="overview-context">${context ? `<span>${esc(context)}</span>` : ''}${status ? `<span>${esc(status)}</span>` : ''}</div>` : ''}${readings ? `<div class="overview-limits">${readings}</div>` : ''}${recovery ? `<p class="overview-recovery">${esc(redact(recovery))}</p>` : ''}`;
}

function overview(providers: Provider[]) {
  if (!providers.length) return '<p class="overview-empty">All subscriptions are hidden. Open Settings to show one.</p>';
  return providers.map(provider => `<article class="overview-row" data-subscription="${provider}"><div class="overview-row-heading"><h2>${providerLogo(provider)}${providerNames[provider]}</h2><button type="button" class="subtle-button" data-action="subscription" data-provider="${provider}" aria-label="View ${providerNames[provider]} details">Details <span aria-hidden="true">›</span></button></div><div data-reading></div></article>`).join('');
}

function codexSection() {
  const accounts = uniqueAccounts(snapshot.accounts, snapshot.activeAccountId);
  const disabled = snapshot.switching || preparingSwitch || switchPlan || snapshot.login && !snapshot.login.error;
  return `<header class="panel-heading"><h2>Connected accounts<span class="account-count">${accounts.length}</span></h2><button type="button" class="subtle-button" data-action="add" ${disabled ? 'disabled' : ''}>Add Codex account</button></header>${accounts.map(accountCard).join('')}${accounts.length === 0 ? `<div class="empty-state"><p>${esc(snapshot.desktopError ?? 'Sign in to the Codex desktop app, or connect a ChatGPT account.')}</p></div>` : !providerReading('codex') && snapshot.desktopError ? `<p class="desktop-note">${esc(snapshot.desktopError)}</p>` : ''}${addPanel()}`;
}

function settingsPanel() {
  const { antigravity, settings, update } = snapshot;
  const activeGroup = selectedAntigravityGroup(antigravity, settings.notchSource);
  const effectiveSource = notchSource();
  const currentSource = effectiveSource.startsWith('custom') ? 'custom' : isBothNotch(effectiveSource)
    ? (activeGroup ? `both:${activeGroup.id}` : 'both')
    : isAntigravityNotch(effectiveSource)
      ? (activeGroup ? `antigravity:${activeGroup.id}` : 'antigravity')
      : isClaudeNotch(effectiveSource) ? effectiveSource : effectiveSource === 'none' ? 'none' : 'codex';
  const bothOptions = antigravity.groups.length
    ? antigravity.groups.map(group => `<option value="both:${esc(group.id)}" ${!visible('codex') || !visible('antigravity') ? 'disabled' : ''} ${currentSource === `both:${group.id}` ? 'selected' : ''}>Both · Codex + ${esc(group.label)}</option>`).join('')
    : `<option value="both" ${!visible('codex') || !visible('antigravity') ? 'disabled' : ''} ${currentSource === 'both' ? 'selected' : ''}>Both · Codex + Antigravity</option>`;
  const antigravityOptions = antigravity.groups.length
    ? antigravity.groups.map(group => `<option value="antigravity:${esc(group.id)}" ${!visible('antigravity') ? 'disabled' : ''} ${currentSource === `antigravity:${group.id}` ? 'selected' : ''}>Antigravity · ${esc(group.label)}</option>`).join('')
    : `<option value="antigravity" ${!visible('antigravity') ? 'disabled' : ''} ${currentSource === 'antigravity' ? 'selected' : ''}>Antigravity</option>`;
  const subscriptions = (Object.keys(defaultProviderColors) as Provider[]).map(provider => {
    const label = { codex: 'Codex', antigravity: 'Antigravity', claude: 'Claude' }[provider];
    const current = providerColor(settings.providerColors, provider);
    const swatches = providerColorPresets[provider].map(swatch => `<button type="button" class="swatch-dot" data-action="provider-swatch" data-provider="${provider}" data-color-value="${swatch}" aria-label="${label} preset ${swatch}" aria-pressed="${current.toLowerCase() === swatch.toLowerCase()}" style="background:${swatch}"></button>`).join('');
    return `<div class="subscription-setting"><label class="subscription-toggle" for="show-${provider}"><input class="switch" id="show-${provider}" type="checkbox" data-visibility="${provider}" ${visible(provider) ? 'checked' : ''}/><span>${label}</span></label><div class="color-control"><div class="swatch-list">${swatches}</div><label><span class="sr-only">${label} color</span><input type="color" id="color-${provider}" data-color="${provider}" value="${current}" title="${label} color"/></label></div></div>`;
  }).join('');
  const updateUrl = esc(update.installerUrl ?? update.releaseUrl ?? 'https://github.com/yabswannalearn/yousage/releases/latest');
  const updateStatusText = update.checking
    ? 'Checking GitHub Releases…'
    : update.error
      ? update.error
      : update.updateAvailable && update.latestVersion
        ? `Update v${update.latestVersion} available`
        : `Up to date (v${update.currentVersion})`;
  const tabs: readonly [SettingsTab, string][] = [
    ['all', 'All'],
    ['general', 'Preview'],
    ['appearance', 'Theme'],
    ['alerts', 'Alerts'],
    ['system', 'System'],
  ];
  const showSection = (tab: SettingsTab) => settingsTab === 'all' || settingsTab === tab;
  const tabBar = `<div class="settings-tabs" role="group" aria-label="Settings sections">${tabs.map(([id, label]) => `<button type="button" data-action="settings-tab" data-tab="${id}" aria-pressed="${settingsTab === id}">${label}</button>`).join('')}</div>`;
  const previewPod = `<div class="settings-pod"><div class="settings-heading"><h3>Notch preview</h3><button type="button" class="text-button" data-action="cycle-notch" title="Cycle visible notch preview (Alt+Shift+N)">Cycle source</button></div><label class="setting-row" for="notch-source"><span>Notch preview</span><select id="notch-source"><option value="custom" ${currentSource === 'custom' ? 'selected' : ''}>Custom combination</option><option value="codex" ${!visible('codex') ? 'disabled' : ''} ${currentSource === 'codex' ? 'selected' : ''}>Codex (active account)</option>${bothOptions}${antigravityOptions}${(snapshot.claude.modelLimits ?? []).map(group => `<option value="claude:${esc(group.id)}" ${!visible('claude') ? 'disabled' : ''} ${currentSource === `claude:${group.id}` ? 'selected' : ''}>Claude · ${esc(group.label)}</option>`).join('')}<option value="claude" ${!visible('claude') ? 'disabled' : ''} ${currentSource === 'claude' ? 'selected' : ''}>Claude</option>${effectiveSource === 'none' ? '<option value="none" selected disabled>All subscriptions hidden</option>' : ''}</select></label>${customPreviewSettings()}</div>`;
  const sessionsPod = `<div class="settings-pod"><div class="settings-heading"><h3>Coding sessions</h3><button class="subtle-button" data-action="session-tracking">${settings.sessionsEnabled ? 'Disable session status' : 'Enable session status'}</button></div><p class="fine-print">Show Codex, Claude Code, and Antigravity as Rest, Working, Needs permission, or Finished. Project names, available conversation titles, and status stay on this computer.</p><p class="fine-print">After enabling, review the new hooks in Codex Settings → Hooks (or /hooks), then start new coding sessions.</p></div>`;
  const subscriptionsPod = `<div class="settings-pod subscription-settings"><h3>Subscriptions</h3><p class="fine-print">Show or hide each subscription and choose its color.</p>${subscriptions}</div>`;
  const trackingPod = `<div class="settings-pod"><h3>Background tracking</h3><p class="fine-print">Pause automatic usage checks, alerts, and account switching for a provider. You can still refresh its reading manually.</p>${(Object.keys(providerNames) as Provider[]).map(provider => `<label class="setting-row" for="track-${provider}"><span>${providerNames[provider]}</span><input id="track-${provider}" class="switch" type="checkbox" data-track-provider="${provider}" aria-label="Track ${providerNames[provider]} in background" ${tracking(provider) ? 'checked' : ''}/></label>`).join('')}</div>`;
  const notificationsPod = `<div class="settings-pod"><h3>Notifications</h3><label class="setting-row" for="notifications"><span>Windows notifications</span><input class="switch" id="notifications" type="checkbox" ${settings.notificationsEnabled ? 'checked' : ''}/></label><div class="setting-row"><span class="fine-print">Low-allowance & reset alerts</span><button type="button" class="subtle-button" data-action="test-notification" ${settings.notificationsEnabled ? '' : 'disabled'}>Send test notification</button></div>${notificationHealthSettings()}</div>`;
  const suggestionsPod = `<div class="settings-pod"><h3>Account suggestions</h3><label class="setting-row" for="recommendation-purpose"><span>Suggest accounts for</span><select id="recommendation-purpose">${(['any', 'work', 'personal'] as const).map(value => `<option value="${value}" ${preferences().recommendationPurpose === value ? 'selected' : ''}>${value === 'any' ? 'Any purpose' : value === 'work' ? 'Work' : 'Personal'}</option>`).join('')}</select></label><p class="fine-print">Set an account’s purpose or exclude it through Manage account. Suggestions use fresh readings and reset times.</p></div>`;
  const privacyPod = `<div class="settings-pod"><h3>Privacy</h3><label class="setting-row" for="privacy-mode"><span>Privacy mode</span><input class="switch" id="privacy-mode" type="checkbox" ${settings.privacyMode ? 'checked' : ''}/></label><p class="fine-print">Hide account names and emails across the app and notifications. Alt+Shift+P toggles privacy anywhere.</p></div>`;
  const appSystemPod = `<div class="settings-pod"><h3>Desktop & updates</h3><label class="setting-row" for="startup"><span>Start with Windows</span><input class="switch" id="startup" type="checkbox" ${settings.startWithWindows ? 'checked' : ''}/></label><label class="setting-row" for="refresh-interval"><span>Refresh usage every</span><select id="refresh-interval">${[[30, '30 seconds'], [60, '1 minute'], [120, '2 minutes'], [300, '5 minutes'], [600, '10 minutes']].map(([value, label]) => `<option value="${value}" ${settings.refreshSeconds === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><div class="setting-row update-row"><span>${esc(updateStatusText)}</span>${update.updateAvailable ? `<button type="button" class="subtle-button" data-action="open-release" data-url="${updateUrl}">Install v${esc(update.latestVersion ?? '')}</button>` : `<button type="button" class="subtle-button" data-action="check-updates" ${update.checking ? 'disabled' : ''}>Check updates</button>`}</div><p class="fine-print">Press Alt+Shift+U to toggle the notch · Alt+Shift+N to cycle preview · Alt+Shift+P for privacy.</p></div>`;
  const pods = [
    ['appearance', showSection('appearance') ? appearanceSettings() : ''],
    ['privacy', showSection('system') ? privacyPod : ''],
    ['history', showSection('system') ? historySettings() : ''],
    ['preview', showSection('general') ? previewPod : ''],
    ['tracking', showSection('general') ? trackingPod : ''],
    ['sessions', showSection('general') ? sessionsPod : ''],
    ['subscriptions', showSection('appearance') || showSection('general') ? subscriptionsPod : ''],
    ['notifications', showSection('alerts') ? notificationsPod : ''],
    ['alerts', showSection('alerts') ? alertSettings() : ''],
    ['suggestions', showSection('alerts') ? suggestionsPod : ''],
    ['switching', showSection('general') || showSection('alerts') ? autoSwitchSettings() : ''],
    ['health', showSection('system') ? connectionHealthSettings() : ''],
    ['desktop', showSection('system') || showSection('general') ? appSystemPod : ''],
  ].filter(([, html]) => html);
  const layout = `<section class="settings-panel" aria-label="Settings"><div class="settings-heading"><span class="fine-print">v${esc(update.currentVersion)} · Alt+Shift+U</span></div>${tabBar}<div class="settings-pods">${pods.map(([name]) => `<div data-settings-pod="${name}"></div>`).join('')}</div></section>`;
  return { layout, pods };
}

function addPanel() {
  const signingIn = snapshot.login && !snapshot.login.error;
  if (signingIn) return `<section class="add-panel"><div class="connection-symbol">${icon('plus')}</div><h2>${esc(snapshot.login!.status)}</h2><p>Your current Codex sign-in stays connected.</p><button class="subtle-button" data-action="cancel-login">Cancel sign-in</button></section>`;
  if (!adding || snapshot.settings.privacyMode) return '';
  return `<section class="add-panel"><div class="section-heading"><h2>Connect a Codex account</h2>${iconButton('cancel-add', 'x', 'Cancel')}</div><form data-form="connect"><label class="field-label" for="account-label">Account name</label><input id="account-label" name="label" placeholder="Work or Personal" maxlength="48" autocomplete="off" required/><p>Sign in with ChatGPT in your browser. You only need to do this once per account.</p><button class="primary-button" type="submit">Continue in browser <span aria-hidden="true">↗</span></button></form></section>`;
}

function onboardingPanel() {
  const rows = (Object.keys(providerNames) as Provider[]).map(provider => {
    const connected = snapshot.health?.[provider]?.status === 'ready';
    return `<label class="setup-provider" ${accentStyle(provider)}>${providerLogo(provider)}<span><strong>${providerNames[provider]}</strong><span>${connected ? 'Sign-in detected' : providerSetup[provider]}</span></span><input type="checkbox" class="switch" id="setup-${provider}" data-setup-provider="${provider}" aria-label="Track ${providerNames[provider]}" ${onboardingProviders.has(provider) ? 'checked' : ''}/></label>`;
  }).join('');
  return `<section class="onboarding" aria-labelledby="onboarding-title"><span class="eyebrow">GET STARTED</span><h1 id="onboarding-title" tabindex="-1">Choose what to track</h1><p>See your remaining allowance and reset times in the notch.</p><div class="setup-providers">${rows}</div><button type="button" class="primary-button" data-action="finish-onboarding" ${onboardingProviders.size ? '' : 'disabled'}>See usage <span aria-hidden="true">→</span></button><button type="button" class="text-button setup-skip" data-action="skip-onboarding">Set up later</button></section>`;
}

function providerRecovery(provider: 'antigravity' | 'claude') {
  const command = snapshot.health?.[provider]?.recoveryCommand ?? (provider === 'claude' ? 'claude auth login' : 'agy');
  return `<button type="button" class="subtle-button provider-recovery" data-action="copy-recovery" data-command="${esc(command)}">Copy ${providerNames[provider]} sign-in command</button>`;
}

function updateRegion(region: Element, html: string, preserveText = true) {
  if (renderedRegions.get(region) === html) return false;
  const focused = document.activeElement instanceof HTMLElement && region.contains(document.activeElement) ? document.activeElement : null;
  const drafts = preserveText ? Array.from(region.querySelectorAll<HTMLInputElement>('input[type="text"], input[type="search"], input:not([type])')) : [];
  const draftValues = drafts.map(input => [input.id, input.value] as const);
  const focusedInput = focused instanceof HTMLInputElement ? focused : null;
  const openDetails = Array.from(region.querySelectorAll<HTMLDetailsElement>('details[open][id]'), item => item.id);
  region.innerHTML = html;
  renderedRegions.set(region, html);
  for (const [id, value] of draftValues) {
    const input = document.getElementById(id);
    if (input instanceof HTMLInputElement) input.value = value;
  }
  for (const id of openDetails) {
    const disclosure = document.getElementById(id);
    if (disclosure instanceof HTMLDetailsElement) disclosure.open = true;
  }
  if (focused && document.hasFocus()) {
    const target = focused.id ? document.getElementById(focused.id)
      : Array.from(region.querySelectorAll<HTMLElement>('[data-action]')).find(element => focused.dataset.action && Object.entries(focused.dataset).every(([key, value]) => element.dataset[key] === value));
    if (focusedInput && target instanceof HTMLInputElement && (['number', 'time'].includes(target.type) || preserveText && drafts.includes(focusedInput))) {
      target.value = focusedInput.value;
      if (focusedInput.selectionStart !== null && ['text', 'search'].includes(target.type)) {
        target.setSelectionRange(focusedInput.selectionStart, focusedInput.selectionEnd);
      }
    }
    target?.focus({ preventScroll: true });
  }
  return true;
}

function render(autoSync = true) {
  if (transition && autoSync || dragging || colorPickerOpen || rendering) return;
  const rawSnapshot = snapshot;
  const privacyChanged = renderedPrivacy !== Boolean(rawSnapshot.settings.privacyMode);
  if (privacyChanged && rawSnapshot.settings.privacyMode) { adding = false; savingAgy = false; savingClaude = false; }
  if (panelView in providerNames && !visible(panelView as Provider)) panelView = 'overview';
  renderSourceSnapshot = rawSnapshot;
  snapshot = privacySnapshot(rawSnapshot);
  rendering = true;
  let sizeChanged = false;
  try {
    applyAppTheme(snapshot.settings.appTheme ?? defaultAppTheme);
    const smartFocus = smartNotchFocus(snapshot, preferences());
    const providers = smartFocus ? [smartFocus.provider] : selectedProviders();
    const effectiveSource = smartFocus ? smartFocus.source : snapshot.settings.notchSource;
    const custom = !smartFocus && effectiveSource.startsWith('custom');
    const activeSessions = currentSessions();
    const firstSession = focusedSession(activeSessions);
    const status = firstSession?.status ?? 'rest';
    const readings = providers.map(provider => {
      const limits = provider === 'codex' ? activeCodexAccount()
        : provider === 'antigravity' ? selectedAntigravityGroup(snapshot.antigravity, effectiveSource)
        : claudeNotchLimits(snapshot.claude, effectiveSource);
      if (providers.length > 1 || custom) {
        const chosen = previewWindow(limits?.fiveHour ?? null, limits?.weekly ?? null, preferences().notchWindow);
        const prefix = provider === 'codex' ? 'C' : provider === 'antigravity' ? 'A' : 'Cl';
        return smallReading(`${providers.length > 1 ? `${prefix}·` : ''}${chosen.label}`, chosen.window, provider);
      }
      if (limits && !limits.fiveHour && limits.weekly) return smallReading('Week', limits.weekly, provider);
      return `${smallReading('5h', limits?.fiveHour ?? null, provider)}${smallReading('Week', limits?.weekly ?? null, provider)}`;
    }).join('');
    const sessionsCount = activeSessions.length;
    const identity = firstSession ? `<span class="compact-title">${providerLogo(firstSession.provider)}<span class="session-title">${esc(firstSession.title ?? firstSession.label)}</span>${sessionsCount > 1 ? `<span class="session-count" aria-label="${sessionsCount - 1} more sessions">+${sessionsCount - 1}</span>` : ''}</span><span class="compact-subtitle"><span class="session-state">${sessionStatusLabels[status]}</span></span>` : '';

    let compact = root.querySelector<HTMLButtonElement>('#notch-toggle');
    if (!compact) {
      root.innerHTML = '<div class="shell"><button type="button" id="notch-toggle" class="compact" data-action="toggle" aria-controls="detail-panel"><span class="compact-identity"></span><span class="compact-readings"></span><span class="expand-icon"></span></button></div>';
      compact = root.querySelector<HTMLButtonElement>('#notch-toggle')!;
    }
    root.classList.toggle('expanded', expanded);
    root.classList.toggle('pinned', pinned);
    root.classList.toggle('opening', opening);
    root.classList.toggle('preparing-open', preparingOpen);
    if (!transition) root.classList.remove('closing');
    const title = expanded ? (pinned ? 'Pinned open · click outside to close' : 'Click to pin open · drag the header to move') : 'Rest the pointer along the top edge to open · Alt+Shift+U';
    const attributes = { 'data-status': status, 'aria-expanded': String(expanded), style: accentVariables(providers[0] ?? 'codex'), title };
    for (const [name, value] of Object.entries(attributes)) {
      if (compact.getAttribute(name) !== value) compact.setAttribute(name, value);
    }
    compact.classList.toggle('three-providers', providers.length === 3);
    updateRegion(compact.querySelector('.compact-identity')!, identity);
    updateRegion(compact.querySelector('.compact-readings')!, readings);
    updateRegion(compact.querySelector('.expand-icon')!, icon(pinned ? 'pin' : 'chevron'));

    let detail = root.querySelector('#detail-panel');
    if (!expanded) {
      detail?.remove();
      renderedPrivacy = Boolean(rawSnapshot.settings.privacyMode);
      return;
    }
    if (!detail) {
      compact.insertAdjacentHTML('afterend', '<section id="detail-panel" class="details" aria-label="Usage details"><div class="panel-scroll"><div class="panel-content"><div data-panel-messages></div><div data-panel-heading></div><div data-panel-switch></div><div data-panel-suggestion></div><div data-panel-body></div><div data-panel-sessions></div><div data-panel-alerts></div></div></div><footer class="panel-footer"></footer></section>');
      detail = root.querySelector('#detail-panel')!;
      sizeChanged = true;
    }

    const firstRun = snapshot.settings.onboardingCompleted === false;
    const preserveText = !privacyChanged && !snapshot.settings.privacyMode;
    const scroll = detail.querySelector('.panel-scroll')!;
    const scrollTop = scroll.scrollTop;
    const put = (selector: string, html: string) => {
      if (updateRegion(detail.querySelector(selector)!, html, preserveText)) sizeChanged = true;
    };
    const message = error || snapshot.login?.error;
    put('[data-panel-messages]', `${message ? `<div class="error-banner" role="alert">${esc(redact(message))}${iconButton('clear-error', 'x', 'Dismiss error')}</div>` : ''}${notice ? `<div class="success-banner" role="status">${esc(redact(notice))}</div>` : ''}`);
    const provider = panelView in providerNames ? panelView as Provider : null;
    put('[data-panel-heading]', firstRun ? '' : panelView === 'overview'
      ? `<header class="overview-heading"><h1 id="panel-view-title" tabindex="-1">Usage remaining</h1>${preview ? '<span class="eyebrow">Preview data</span>' : ''}</header>`
      : `<header class="panel-view-heading"><button type="button" class="subtle-button" data-action="overview">‹ Overview</button><h1 id="panel-view-title" tabindex="-1">${provider ? providerNames[provider] : panelView === 'history' ? 'Usage history' : 'Settings'}</h1></header>`);
    put('[data-panel-switch]', firstRun ? '' : switchPanel());
    put('[data-panel-suggestion]', !firstRun && provider ? accountSuggestion(provider) : '');
    if (firstRun) {
      put('[data-panel-body]', onboardingPanel());
    } else if (panelView === 'overview') {
      const visibleProviders = (Object.keys(providerNames) as Provider[]).filter(visible);
      if (overviewLead && visible(overviewLead)) {
        visibleProviders.splice(visibleProviders.indexOf(overviewLead), 1);
        visibleProviders.unshift(overviewLead);
      }
      put('[data-panel-body]', overview(visibleProviders));
      for (const item of visibleProviders) {
        put(`[data-subscription="${item}"] [data-reading]`, overviewReadings(item, effectiveSource));
      }
    } else if (panelView === 'settings') {
      const { layout, pods } = settingsPanel();
      put('[data-panel-body]', layout);
      for (const [name, html] of pods) put(`[data-settings-pod="${name}"]`, html);
    } else {
      const body = panelView === 'history' ? historyPanel()
        : panelView === 'codex' ? codexSection() : panelView === 'antigravity' ? antigravitySection() : claudeSection();
      put('[data-panel-body]', body);
    }
    put('[data-panel-sessions]', !firstRun && panelView === 'overview' ? sessionList(activeSessions) : '');
    put('[data-panel-alerts]', !firstRun && panelView === 'overview' ? alertsBanner() : '');
    const footer = detail.querySelector('.panel-footer')!;
    if (updateRegion(footer, firstRun ? '<span class="fine-print">Reopen any time from the system tray.</span>' :
      `<button type="button" class="panel-tool" data-action="refresh" aria-label="Refresh usage">${icon('refresh')}<span>Refresh</span></button>
      <button type="button" class="panel-tool" data-action="history">${icon('history')}<span>History</span></button>
      <button type="button" class="panel-tool" data-action="settings">${icon('settings')}<span>Settings</span></button>
      <div class="footer-tools">${iconButton('privacy', 'privacy', 'Toggle privacy mode')}${iconButton('hide', 'hide', 'Hide to system tray')}</div>`)) sizeChanged = true;
    if (!firstRun) {
      const refresh = footer.querySelector<HTMLButtonElement>('[data-action="refresh"]')!;
      refresh.disabled = snapshot.refreshing || Boolean(snapshot.switching);
      const refreshLabel = snapshot.refreshing ? 'Checking…' : 'Refresh';
      const label = refresh.querySelector('span')!;
      if (label.textContent !== refreshLabel) label.textContent = refreshLabel;
      refresh.setAttribute('aria-label', snapshot.refreshing ? 'Checking usage' : 'Refresh usage');
      footer.querySelector('[data-action="history"]')!.setAttribute('aria-pressed', String(panelView === 'history'));
      footer.querySelector('[data-action="settings"]')!.setAttribute('aria-pressed', String(panelView === 'settings'));
      footer.querySelector('[data-action="privacy"]')!.setAttribute('aria-pressed', String(Boolean(snapshot.settings.privacyMode)));
    }
    if (scroll.scrollTop !== scrollTop) scroll.scrollTop = scrollTop;
    renderedPrivacy = Boolean(rawSnapshot.settings.privacyMode);
  } finally {
    snapshot = rawSnapshot;
    renderSourceSnapshot = null;
    rendering = false;
  }
  if (sizeChanged && autoSync) void syncHeight();
}

async function syncHeight() {
  const details = root.querySelector<HTMLElement>('.details');
  if (!expanded || !details) return;
  const content = root.querySelector<HTMLElement>('.panel-content')!;
  const footer = root.querySelector<HTMLElement>('.panel-footer')!;
  const height = Math.min(680, 80 + content.offsetHeight + footer.offsetHeight);
  if (Math.abs(desiredHeight - height) < 2) return;
  desiredHeight = height;
  try {
    const layout = await call<NotchLayout>('set_expanded', { expanded: true, height });
    if (!expanded || desiredHeight !== height) return;
    applyLayout(layout);
  } catch (err) { error = String(err); }
}

function setPanelView(view: PanelView) {
  if (view === panelView) return;
  const previous = panelView;
  if (previous === 'history') {
    historyRequest++;
    clearTimeout(historyRefreshTimer);
    historyLoading = false;
  }
  panelView = view;
  render(!opening);
  const scroll = root.querySelector('.panel-scroll');
  if (scroll) scroll.scrollTop = 0;
  const trigger = view === 'overview' && previous in providerNames
    ? root.querySelector<HTMLElement>(`[data-action="subscription"][data-provider="${previous}"]`) : null;
  (trigger ?? document.getElementById('panel-view-title'))?.focus({ preventScroll: true });
}

function resetPanel() {
  pinned = false;
  expanded = false;
  opening = false;
  preparingOpen = false;
  panelView = 'overview';
  settingsTab = 'general';
  historyRequest++;
  clearTimeout(historyRefreshTimer);
  historyLoading = false;
  adding = false;
  savingAgy = false;
  savingClaude = false;
  managing = null;
  managingAgy = null;
  disconnectConfirmation = null;
  disconnectAgyConfirmation = null;
  switchPlan = null;
  desiredHeight = 0;
}

async function playShellMotion(phase: 'opening' | 'closing') {
  root.classList.add(phase);
  const motion = root.querySelector('.shell')?.getAnimations()[0];
  await motion?.finished.catch(() => undefined);
}

async function toggle(open = !expanded) {
  if (transition || open === expanded) return;
  const returnFocus = !open && document.hasFocus() && root.contains(document.activeElement);
  transition = true;
  if (open) {
    preparingOpen = true;
    overviewLead = smartNotchFocus(snapshot, preferences())?.provider ?? selectedProviders()[0];
    expanded = true; desiredHeight = 0; render(false);
    await syncHeight();
    if (dockEdge === 'left' || dockEdge === 'right') await syncHeight();
    if (!expanded) return;
    const initialView = panelView;
    preparingOpen = false;
    opening = true;
    root.classList.remove('preparing-open');
    await playShellMotion('opening');
    opening = false;
    if (initialView !== panelView) void syncHeight();
  } else {
    pinned = false;
    opening = false;
    await playShellMotion('closing');
    resetPanel();
    applyLayout(await call<NotchLayout>('set_expanded', { expanded: false, height: 80 }));
  }
  transition = false;
  render();
  if (returnFocus) root.querySelector<HTMLButtonElement>('#notch-toggle')?.focus({ preventScroll: true });
}

async function attempt(action: () => Promise<unknown>) {
  error = '';
  try { await action(); } catch (err) { error = err instanceof Error ? err.message : String(err); }
  render();
}

async function setPrivacy(enabled: boolean) {
  await call('set_privacy_mode', { enabled });
  snapshot = await call<Snapshot>('get_snapshot');
  if (enabled) { adding = false; savingAgy = false; }
  notice = enabled ? 'Privacy mode on. Account names and emails are hidden.' : 'Privacy mode off.';
}

async function exportHistory() {
  const privateAtStart = Boolean(snapshot.settings.privacyMode);
  const csv = await call<string>('export_usage_history', { rangeHours: historyRange });
  if (privateAtStart !== Boolean(snapshot.settings.privacyMode)) throw new Error('Privacy mode changed during export. Export again to use the current setting.');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `yousage-history-${historyRange === 24 ? '24h' : '7d'}.csv`;
  document.body.append(link);
  link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notice = snapshot.settings.privacyMode ? 'History exported with private account aliases.' : 'History exported to CSV.';
}

async function prepareSwitch(id: string, provider: Provider = 'codex') {
  if (snapshot.switching || preparingSwitch) return;
  setPanelView(provider);
  preparingSwitch = id; switchPlan = null; notice = ''; error = ''; render();
  try {
    const plan = await call<SwitchPlan>(provider === 'claude' ? 'prepare_claude_switch' : provider === 'antigravity' ? 'prepare_antigravity_switch' : 'prepare_switch', { id });
    if (expanded && panelView === provider) { switchPlan = plan; adding = false; managing = null; }
  } finally { preparingSwitch = null; render(); }
  const scroll = root.querySelector('.panel-scroll');
  if (scroll) scroll.scrollTop = 0;
  document.getElementById('confirm-switch')?.focus({ preventScroll: true });
}

async function confirmSwitch() {
  const plan = switchPlan;
  if (!plan || snapshot.switching) return;
  switchPlan = null; snapshot.switching = 'Preparing the account switch…'; notice = ''; render();
  try {
    await call(plan.provider === 'claude' ? 'switch_claude_account' : plan.provider === 'antigravity' ? 'switch_antigravity_account' : 'switch_account', { id: plan.id, restartDesktop: plan.processNames.length > 0 });
    notice = plan.provider === 'claude' ? `New Claude Code sessions will use ${plan.label}.` : `Now using ${plan.label} in ${plan.provider === 'antigravity' ? 'Antigravity' : 'Codex'} desktop and new CLI sessions.`;
  } finally { snapshot.switching = null; render(); }
}

async function cycleNotch() {
  const next = cycleNotchSource(snapshot.settings.notchSource, snapshot.settings.hiddenProviders, snapshot.antigravity);
  if (next === 'none') return;
  await savePreferences(preferences(), next);
}

function pinOpen() {
  clearTimeout(hoverCloseTimer);
  pinned = true;
  root.classList.add('pinned');
  const indicator = root.querySelector('.expand-icon');
  if (indicator) updateRegion(indicator, icon('pin'));
  root.querySelector('#notch-toggle')?.setAttribute('title', 'Pinned open · click outside to minimize');
}

root.addEventListener('click', event => {
  if (expanded && !suppressToggleClick) pinOpen();
  const target = (event.target as Element).closest<HTMLElement>('[data-action]');
  if (!target || (target instanceof HTMLButtonElement && target.disabled)) return;
  const id = target.dataset.id;
  switch (target.dataset.action) {
    case 'toggle': break;
    case 'finish-onboarding':
    case 'skip-onboarding':
      void attempt(async () => {
        const providers = target.dataset.action === 'finish-onboarding' ? [...onboardingProviders] : null;
        await call('finish_onboarding', { providers });
        snapshot = await call<Snapshot>('get_snapshot');
        render();
        root.querySelector<HTMLElement>('#notch-toggle')?.focus({ preventScroll: true });
      });
      break;
    case 'session-tracking': void attempt(async () => {
      await call('set_session_tracking', { enabled: !snapshot.settings.sessionsEnabled });
      notice = snapshot.settings.sessionsEnabled ? 'Session status enabled. Review the new hooks in Codex Settings → Hooks and start new coding sessions.' : 'Session status disabled.';
      render();
    }); break;
    case 'save-claude': savingClaude = !savingClaude; render(); break;
    case 'cancel-save-claude': savingClaude = false; render(); break;
    case 'switch-claude': if (id) void attempt(() => prepareSwitch(id, 'claude')); break;
    case 'remove-claude': if (id) void attempt(() => call('disconnect_claude_account', { id })); break;
    case 'refresh': void attempt(() => call('refresh_usage')); break;
    case 'history':
      setPanelView(panelView === 'history' ? 'overview' : 'history');
      if (panelView === 'history') void loadHistory();
      break;
    case 'history-range': {
      const range = Number(target.dataset.hours);
      if ((range === 24 || range === 168) && range !== historyRange) { historyRange = range; void loadHistory(); }
      break;
    }
    case 'toggle-history-compare':
      historyCompare = !historyCompare;
      render();
      break;
    case 'refresh-history': void loadHistory(); break;
    case 'export-history': void attempt(exportHistory); break;
    case 'clear-history':
      if (!clearHistoryConfirmation) { clearHistoryConfirmation = true; render(); }
      else void attempt(async () => { await call('clear_usage_history'); clearHistoryConfirmation = false; history = null; notice = 'Local history cleared. Fresh checks will start a new history.'; });
      break;
    case 'cancel-clear-history': clearHistoryConfirmation = false; render(); break;
    case 'privacy': void attempt(() => setPrivacy(!snapshot.settings.privacyMode)); break;
    case 'check-notifications': void checkNotifications(); break;
    case 'open-notification-settings': void attempt(() => call('open_notification_settings')); break;
    case 'refresh-health': {
      const provider = target.dataset.provider as Provider;
      const health = snapshot.health?.[provider];
      if (health?.nextRetryAt && health.nextRetryAt > Date.now() / 1000 && (provider === 'claude' || health.status === 'rateLimited')) return;
      void attempt(() => call('refresh_usage')); break;
    }
    case 'copy-recovery': void attempt(async () => { await navigator.clipboard.writeText(target.dataset.command ?? ''); notice = 'Sign-in command copied. Run it in your terminal, then refresh usage.'; }); break;
    case 'snooze-alerts': void attempt(() => savePreferences({ ...preferences(), alertRules: { ...preferences().alertRules, snoozedUntil: Math.floor(Date.now() / 1000) + 3600 } })); break;
    case 'resume-alerts': void attempt(() => savePreferences({ ...preferences(), alertRules: { ...preferences().alertRules, snoozedUntil: null } })); break;
    case 'hide': void attempt(async () => { await call('hide_notch'); resetPanel(); }); break;
    case 'settings':
      clearHistoryConfirmation = false;
      setPanelView(panelView === 'settings' ? 'overview' : 'settings');
      if (panelView === 'settings') void checkNotifications();
      break;
    case 'settings-tab': {
      const tab = target.dataset.tab as SettingsTab | undefined;
      if (tab) { settingsTab = tab; render(); }
      break;
    }
    case 'overview': setPanelView('overview'); break;
    case 'subscription': {
      const provider = target.dataset.provider as Provider;
      if (provider in providerNames && visible(provider)) setPanelView(provider);
      break;
    }
    case 'theme-preset': {
      const background = target.dataset.bg;
      const accent = target.dataset.accent;
      if (background && accent) void attempt(() => call('update_settings', { ...snapshot.settings, appTheme: { background, accent } }));
      break;
    }
    case 'provider-swatch': {
      const provider = target.dataset.provider as Provider | undefined;
      const color = target.dataset.colorValue;
      if (provider && color) void attempt(() => call('update_settings', { ...snapshot.settings, providerColors: { ...snapshot.settings.providerColors, [provider]: color } }));
      break;
    }
    case 'cycle-notch': void attempt(cycleNotch); break;
    case 'reset-app-theme': void attempt(() => call('update_settings', { ...snapshot.settings, appTheme: { ...defaultAppTheme } })); break;
    case 'add': if (snapshot.settings.privacyMode) { notice = 'Turn off privacy mode to connect an account.'; render(); break; } adding = true; error = ''; render(); document.getElementById('account-label')?.focus(); break;
    case 'cancel-add': adding = false; render(); break;
    case 'cancel-login': void attempt(() => call('cancel_sign_in')); break;
    case 'manage': managing = managing === id ? null : id!; disconnectConfirmation = null; render(); break;
    case 'manage-agy': managingAgy = managingAgy === id ? null : id!; disconnectAgyConfirmation = null; render(); break;
    case 'toggle-save-agy': if (snapshot.settings.privacyMode) return; savingAgy = !savingAgy; render(); document.getElementById('agy-save-label')?.focus(); break;
    case 'cancel-save-agy': savingAgy = false; render(); break;
    case 'switch-agy': if (id) void attempt(() => prepareSwitch(id, 'antigravity')); break;
    case 'disconnect-agy':
      if (disconnectAgyConfirmation !== id) { disconnectAgyConfirmation = id!; render(); }
      else void attempt(async () => { await call('disconnect_antigravity_account', { id }); managingAgy = null; disconnectAgyConfirmation = null; });
      break;
    case 'dismiss-alert': if (id) void attempt(() => call('dismiss_alert', { id })); break;
    case 'clear-alerts': void attempt(() => call('clear_alerts')); break;
    case 'test-notification': void attempt(async () => {
      notice = '';
      try {
        const result = await call<NotificationStatus>('test_notification');
        if (result) notificationStatus = result;
        notice = result && result.availability !== 'available' ? 'Windows is blocking notifications. Check the status in Settings.' : 'Windows accepted the test notification. A banner depends on Windows settings; check Notification Center too.';
      } finally { await checkNotifications(); }
    }); break;
    case 'check-updates': void attempt(() => call('check_for_updates')); break;
    case 'open-release': {
      const url = target.dataset.url;
      if (url) void attempt(() => call('open_release_url', { url }));
      break;
    }
    case 'clear-error': error = ''; if (snapshot.login?.error) { snapshot.login = null; void attempt(() => call('dismiss_login_error')); } render(); break;
    case 'disconnect':
      if (disconnectConfirmation !== id) { disconnectConfirmation = id!; render(); }
      else void attempt(async () => { await call('disconnect_account', { id }); managing = null; disconnectConfirmation = null; });
      break;
    case 'reconnect': {
      const account = snapshot.accounts.find(a => a.id === id);
      void attempt(() => call('connect_account', { label: account?.label ?? '', reconnectId: id })); break;
    }
    case 'prepare-switch': if (id) void attempt(() => prepareSwitch(id)); break;
    case 'confirm-switch': void attempt(confirmSwitch); break;
    case 'cancel-switch': switchPlan = null; render(); break;
    case 'set-notch': {
      const source = target.dataset.source;
      if (source) void attempt(() => savePreferences(preferences(), source));
      break;
    }
  }
});

root.addEventListener('submit', event => {
  const form = event.target as HTMLFormElement;
  event.preventDefault();
  if (snapshot.settings.privacyMode) { error = 'Turn off privacy mode before editing account names.'; render(); return; }
  const label = String(new FormData(form).get('label') ?? '').trim();
  if (!label) return;
  if (form.dataset.form === 'connect') void attempt(async () => { await call('connect_account', { label, reconnectId: null }); adding = false; });
  if (form.dataset.form === 'rename') void attempt(async () => { await call('rename_account', { id: form.dataset.id, label }); managing = null; });
  if (form.dataset.form === 'save-claude') void attempt(async () => { await call('save_claude_account', { label }); savingClaude = false; notice = `Saved ${label} in Claude accounts.`; });
  if (form.dataset.form === 'save-agy') void attempt(async () => { await call('save_antigravity_account', { label }); savingAgy = false; notice = `Saved ${label} in Antigravity accounts.`; });
  if (form.dataset.form === 'rename-agy') void attempt(async () => { await call('rename_antigravity_account', { id: form.dataset.id, label }); managingAgy = null; });
});

root.addEventListener('input', event => {
  const input = event.target as HTMLInputElement;
  if (!input.dataset.theme) return;
  const key = input.dataset.theme as keyof AppTheme;
  applyAppTheme({ ...(snapshot.settings.appTheme ?? defaultAppTheme), [key]: input.value });
  const value = root.querySelector<HTMLElement>(`[data-theme-value="${key}"]`);
  if (value) value.textContent = input.value;
});

root.addEventListener('change', event => {
  const input = event.target as HTMLInputElement;
  if (input.dataset.setupProvider) {
    const provider = input.dataset.setupProvider as Provider;
    if (input.checked) onboardingProviders.add(provider); else onboardingProviders.delete(provider);
    render();
    return;
  }
  if (input.dataset.trackProvider) {
    void attempt(() => call('set_provider_tracking', { provider: input.dataset.trackProvider, enabled: input.checked }));
    return;
  }
  if (input.id === 'privacy-mode') { void attempt(() => setPrivacy(input.checked)); return; }
  if (input.id === 'smart-notch') { void attempt(() => savePreferences({ ...preferences(), smartNotch: input.checked })); return; }
  if (input.dataset.autoSwitch || input.id === 'auto-switch-sessions') {
    const automatic = preferences().autoSwitch ?? { codex: false, antigravity: false, claude: false, sessions: 'wait' as const };
    const forceCloseConfirmed = input.value === 'close';
    const next = input.dataset.autoSwitch
      ? { ...automatic, [input.dataset.autoSwitch]: input.checked }
      : { ...automatic, sessions: forceCloseConfirmed ? 'close' as const : 'wait' as const, forceCloseConfirmed };
    void attempt(() => savePreferences({ ...preferences(), autoSwitch: next }));
    return;
  }
  if (input.id === 'history-series') { historySeriesId = input.value; render(); return; }
  if (input.id === 'history-retention') {
    void attempt(async () => { await call('update_history_settings', { retentionDays: Number(input.value) }); snapshot = await call<Snapshot>('get_snapshot'); });
    return;
  }
  if (input.dataset.notchProvider || input.id === 'notch-window' || input.id === 'notch-group' || input.id === 'notch-source' && input.value === 'custom') {
    const prefs = preferences();
    const currentProviders = notchProviders(snapshot.settings.notchSource, prefs, []);
    const chosen = input.dataset.notchProvider ? currentProviders.filter(provider => provider !== input.dataset.notchProvider).concat(input.checked ? [input.dataset.notchProvider as Provider] : []) : currentProviders;
    if (!chosen.length) { input.checked = true; error = 'Choose at least one provider for the notch.'; render(); return; }
    const notchWindow = input.id === 'notch-window' ? input.value as UsagePreferences['notchWindow'] : prefs.notchWindow;
    const group = root.querySelector<HTMLSelectElement>('#notch-group')?.value;
    void attempt(() => savePreferences({ ...prefs, notchProviders: chosen, notchWindow }, group ? `custom:${group}` : 'custom'));
    return;
  }
  if (input.id === 'notch-source') {
    void attempt(() => savePreferences(preferences(), input.value));
    return;
  }
  if (input.dataset.accountPurpose || input.dataset.accountSuggestions) {
    const prefs = preferences();
    const id = (input.dataset.accountPurpose ?? input.dataset.accountSuggestions)!;
    const current = prefs.accountPreferences[id] ?? { purpose: 'any' as const, excludeFromSuggestions: false };
    const next = { ...current, ...(input.dataset.accountPurpose ? { purpose: input.value as 'any' | 'work' | 'personal' } : { excludeFromSuggestions: !input.checked }) };
    void attempt(() => savePreferences({ ...prefs, accountPreferences: { ...prefs.accountPreferences, [id]: next } }));
    return;
  }
  if (input.id === 'recommendation-purpose') {
    void attempt(() => savePreferences({ ...preferences(), recommendationPurpose: input.value as 'any' | 'work' | 'personal' }));
    return;
  }
  if (input.dataset.alertProvider) {
    const provider = input.dataset.alertProvider as Provider;
    const rules = preferences().alertRules;
    const next = { ...rules[provider], [input.dataset.alertLevel!]: input.valueAsNumber };
    if (!input.validity.valid || !Number.isFinite(next.warningPercent) || !Number.isFinite(next.criticalPercent) || next.criticalPercent < 0 || next.warningPercent > 100 || next.criticalPercent >= next.warningPercent) {
      error = `${providerNames[provider]} thresholds must be between 0 and 100, with critical lower than warning.`;
      input.value = String(rules[provider][input.dataset.alertLevel as 'warningPercent' | 'criticalPercent']);
      render(); return;
    }
    void attempt(() => savePreferences({ ...preferences(), alertRules: { ...rules, [provider]: next } }));
    return;
  }
  if (input.dataset.alertToggle || input.dataset.quietTime) {
    const key = (input.dataset.alertToggle ?? input.dataset.quietTime)!;
    if (input.dataset.quietTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.value)) { error = 'Choose a valid quiet-hours time.'; render(); return; }
    void attempt(() => savePreferences({ ...preferences(), alertRules: { ...preferences().alertRules, [key]: input.dataset.alertToggle ? input.checked : input.value } }));
    return;
  }
  if (input.dataset.theme) {
    colorPickerOpen = false;
    const key = input.dataset.theme as keyof AppTheme;
    void attempt(() => call('update_settings', { ...snapshot.settings, appTheme: { ...(snapshot.settings.appTheme ?? defaultAppTheme), [key]: input.value } }));
    return;
  }
  if (input.dataset.color || input.dataset.visibility) {
    colorPickerOpen = false;
    const provider = (input.dataset.color ?? input.dataset.visibility) as Provider;
    const providerColors = input.dataset.color ? { ...snapshot.settings.providerColors, [provider]: input.value } : snapshot.settings.providerColors;
    const hiddenProviders = input.dataset.visibility ? input.checked ? snapshot.settings.hiddenProviders.filter(p => p !== provider) : [...snapshot.settings.hiddenProviders.filter(p => p !== provider), provider] : snapshot.settings.hiddenProviders;
    void attempt(() => call('update_settings', { ...snapshot.settings, providerColors, hiddenProviders }));
    return;
  }
  if (!['startup', 'refresh-interval', 'notifications'].includes(input.id)) return;
  const start = root.querySelector<HTMLInputElement>('#startup')!.checked;
  const notificationsEnabled = root.querySelector<HTMLInputElement>('#notifications')?.checked ?? snapshot.settings.notificationsEnabled;
  const seconds = Number(root.querySelector<HTMLSelectElement>('#refresh-interval')!.value);
  void attempt(() => call('update_settings', { ...snapshot.settings, startWithWindows: start, refreshSeconds: seconds, notificationsEnabled }));
});

async function requestClose() {
  if (!expanded || dragging || colorPickerOpen) return;
  if (transition) {
    clearTimeout(hoverCloseTimer);
    hoverCloseTimer = setTimeout(() => { void requestClose(); }, 60);
    return;
  }
  await attempt(() => toggle(false));
}

// Only physical pointer movement closes a hover preview. Resizing the native
// window can itself generate pointerleave, even while the mouse is still.
window.addEventListener('pointermove', event => {
  const moved = event.screenX !== pointerPosition.x || event.screenY !== pointerPosition.y;
  pointerPosition = { x: event.screenX, y: event.screenY };
  const shell = root.querySelector('.shell');
  const rect = shell?.getBoundingClientRect();
  const inside = Boolean(rect && event.clientX >= rect.left && event.clientX < rect.right && event.clientY >= rect.top && event.clientY < rect.bottom);
  const reveal = Boolean(rect && event.clientX >= rect.left + 6 && event.clientX < rect.right - 6 && event.clientY >= rect.top && event.clientY < rect.top + REVEAL_STRIP_PX);
  if (!reveal) { clearTimeout(hoverOpenTimer); hoverOpenTimer = undefined; revealLatched = false; }
  if (inside) {
    clearTimeout(hoverCloseTimer);
    if (!expanded && !transition && !dragging && reveal && !revealLatched && !hoverOpenTimer && event.buttons === 0) {
      hoverOpenTimer = setTimeout(() => {
        hoverOpenTimer = undefined; revealLatched = true;
        if (!expanded && !transition && !dragging) void attempt(() => toggle(true));
      }, REVEAL_DELAY_MS);
    }
  } else if (moved && expanded && !pinned) void requestClose();
});
document.addEventListener('pointerdown', event => {
  if (!root.querySelector('.shell')?.contains(event.target as Node)) void requestClose();
});

root.addEventListener('pointerdown', event => {
  colorPickerOpen = Boolean((event.target as HTMLElement).dataset.color || (event.target as HTMLElement).dataset.theme);
  if (event.button !== 0 || !(event.target as Element).closest('#notch-toggle')) return;
  suppressToggleClick = false;
  if (!native || transition) return;
  const origin = { x: event.screenX, y: event.screenY };
  const cleanup = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', cleanup); window.removeEventListener('pointercancel', cleanup); };
  const move = (next: PointerEvent) => {
    if (Math.hypot(next.screenX - origin.x, next.screenY - origin.y) < 5) return;
    cleanup(); suppressToggleClick = true; dragging = true;
    void call('start_notch_drag').catch(err => { dragging = false; error = String(err); render(); });
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', cleanup, { once: true });
  window.addEventListener('pointercancel', cleanup, { once: true });
});

window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && colorPickerOpen) { colorPickerOpen = false; render(); return; }
  if (((event.target as HTMLElement).dataset.color || (event.target as HTMLElement).dataset.theme) && ['Enter', ' '].includes(event.key)) colorPickerOpen = true;
  if (['Enter', ' '].includes(event.key) && (event.target as Element).closest('#notch-toggle')) {
    event.preventDefault();
    pinOpen();
    if (!expanded) void attempt(() => toggle(true));
  }
  if (event.altKey && event.shiftKey && event.key.toLowerCase() === 'n') { event.preventDefault(); void attempt(cycleNotch); return; }
  if (event.key === 'Escape' && expanded) void requestClose();
});

async function start() {
  if (preview) {
    document.documentElement.classList.add('browser-preview');
    root.style.height = '80px';
    const now = Math.floor(Date.now() / 1000);
    snapshot = {
      ...snapshot, activeAccountId: 'desktop', accounts: [
        { id: 'desktop', label: 'Work', email: 'work@example.com', plan: 'business', identity: 'demo-work', fiveHour: { remaining: 18, resetsAt: now + 7200 }, weekly: { remaining: 70, resetsAt: now + 432000 }, updatedAt: now, error: null, desktop: true },
        { id: 'preview-personal', label: 'Personal', email: 'personal@example.com', plan: 'plus', identity: 'demo-personal', fiveHour: { remaining: 88, resetsAt: now + 10800 }, weekly: { remaining: 76, resetsAt: now + 172800 }, updatedAt: now, error: null, desktop: false },
      ],
      claude: { email: 'personal@example.com', plan: 'max', fiveHour: { remaining: 68, resetsAt: now + 9600 }, weekly: { remaining: 82, resetsAt: now + 345600 }, modelLimits: [{ id: 'fable', label: 'Fable this week', description: 'Separate weekly allowance for Fable', fiveHour: null, weekly: { remaining: 73, resetsAt: now + 345600 } }], accounts: [{ id: 'claude-work', label: 'Work', email: 'work@example.com', active: false }], updatedAt: now, error: null },
      antigravity: {
        email: 'developer@example.com',
        updatedAt: now,
        error: null,
        accounts: [{ id: 'agy-work', label: 'AGY Work', email: 'work@example.com', updatedAt: now, error: null, active: false, groups: [{ id: 'gemini-models', label: 'Gemini Models', description: null, fiveHour: { remaining: 86, resetsAt: now + 14400 }, weekly: { remaining: 91, resetsAt: now + 518400 } }] }],
        groups: [
          { id: 'gemini-models', label: 'Gemini Models', description: 'Models within this group: Gemini Flash, Gemini Pro', fiveHour: { remaining: 14, resetsAt: now + 14400 }, weekly: { remaining: 72, resetsAt: now + 518400 } },
          { id: 'claude-and-gpt-models', label: 'Claude and GPT models', description: 'Models within this group: Claude Opus, Claude Sonnet, GPT-OSS', fiveHour: { remaining: 97, resetsAt: now + 5760 }, weekly: { remaining: 83, resetsAt: now + 496800 } },
          { id: 'gemini-4-argon', label: 'Gemini 4 Argon', description: 'Separate weekly quota for paid Pro plans', fiveHour: null, weekly: { remaining: 90, resetsAt: now + 597600 } },
        ],
      },
      health: {
        codex: { status: 'ready', message: 'Codex desktop and connected accounts are available.', lastSuccessAt: now, nextRetryAt: now + 60, recoveryCommand: null },
        antigravity: { status: 'ready', message: 'Antigravity CLI is connected.', lastSuccessAt: now, nextRetryAt: now + 60, recoveryCommand: null },
        claude: { status: 'ready', message: 'Claude subscription is connected.', lastSuccessAt: now, nextRetryAt: now + 60, recoveryCommand: null },
      },
    };
    if (params.has('sessions')) sessions = [
      { id: 'demo-session-1', provider: 'claude', label: 'yousage', status: (['rest', 'working', 'needsPermission', 'finished'].includes(params.get('status') ?? '') ? params.get('status') : 'working') as Session['status'], startedAt: now * 1000, updatedAt: now * 1000 },
      { id: 'demo-session-2', provider: 'codex', label: 'website', status: params.has('status') ? 'rest' : 'working', startedAt: now * 1000 + 1, updatedAt: now * 1000 },
      { id: 'demo-session-3', provider: 'antigravity', label: 'model-tests', status: 'rest', startedAt: now * 1000 + 2, updatedAt: now * 1000 },
    ];
    const previewEdge = params.get('edge');
    if (previewEdge && ['top', 'bottom', 'left', 'right'].includes(previewEdge)) dockEdge = previewEdge as DockEdge;
    applyLayout(await call<NotchLayout>('set_expanded', { expanded: false, height: 80 }));
    render();
    if (params.has('expanded')) await toggle(true);
    return;
  }
  if (!native) {
    root.innerHTML = '<main class="browser-message"><span class="eyebrow">WINDOWS DESKTOP NOTCH</span><h1>YouSage</h1><p>See the allowance left in Codex, Antigravity, and Claude Code. The interactive demo uses sample accounts and keeps them in this tab.</p><a href="?preview=1&expanded=1">Open the interface preview</a><a href="https://github.com/yabswannalearn/yousage/releases/latest">Download for Windows</a></main>';
    document.documentElement.classList.add('browser-landing');
    return;
  }
  await listen<Snapshot>('usage-updated', event => {
    const refreshCompleted = snapshot.refreshing && !event.payload.refreshing;
    snapshot = event.payload;
    if (preferenceDraft) snapshot.settings.usagePreferences = preferenceDraft;
    if (notchSourceDraft) snapshot.settings.notchSource = notchSourceDraft;
    render();
    if (refreshCompleted) scheduleHistoryRefresh();
  });
  await listen<Session[]>('sessions-updated', event => { sessions = event.payload; render(); });
  sessions = await call<Session[]>('get_sessions') ?? [];
  await listen<NotchLayout>('notch-layout', event => { applyLayout(event.payload); });
  await listen('hotkey-toggle', () => { if (!transition) { if (!expanded) pinOpen(); void toggle(); } });
  await listen('tray-open-dashboard', () => { pinOpen(); if (!expanded) void attempt(() => toggle(true)); });
  await listen('hotkey-cycle-notch', () => { void attempt(cycleNotch); });
  await listen('tray-review-switch', () => {
    void (async () => {
      if (!expanded && !transition) { pinOpen(); await toggle(true); }
      const prefs = preferences();
      const codexRec = visible('codex') ? codexRecommendation(snapshot.accounts, snapshot.activeAccountId, prefs) : null;
      if (codexRec) { await prepareSwitch(codexRec.id, 'codex'); return; }
      const agyRec = visible('antigravity') ? antigravityRecommendation(snapshot.antigravity, selectedAntigravityGroup(snapshot.antigravity, snapshot.settings.notchSource)?.id ?? null, prefs) : null;
      if (agyRec) await prepareSwitch(agyRec.id, 'antigravity');
    })();
  });
  await listen('collapse-requested', () => { if (expanded && !dragging && !colorPickerOpen) void requestClose(); });
  await listen('notch-hover-requested', () => {
    clearTimeout(hoverOpenTimer); hoverOpenTimer = undefined; revealLatched = true;
    if (!expanded && !transition && !dragging) void attempt(() => toggle(true));
  });
  await listen('notch-pointer-left', () => { if (!pinned) void requestClose(); });
  await listen('notch-focused', () => { if (colorPickerOpen) { colorPickerOpen = false; render(); } });
  await listen('notch-drag-finished', () => { dragging = false; render(); });
  await listen('panel-collapsed', () => { resetPanel(); transition = false; render(); });
  snapshot = await call<Snapshot>('get_snapshot');
  applyLayout(await call<NotchLayout>('set_expanded', { expanded: false, height: 80 }));
  render();
  if (snapshot.settings.onboardingCompleted === false) {
    const detected = (Object.keys(providerNames) as Provider[]).filter(provider => snapshot.health?.[provider]?.status === 'ready');
    if (detected.length) onboardingProviders = new Set(detected);
    pinOpen();
    await toggle(true);
    document.getElementById('onboarding-title')?.focus({ preventScroll: true });
  }
}

void start().catch(err => { error = String(err); expanded = true; render(); });

// Keep countdowns current without replacing focused controls or the drag target.
let lastResetClock = 0;
setInterval(() => {
  if (document.hidden) return;
  if (Date.now() - lastResetClock >= 30000) {
    lastResetClock = Date.now();
    for (const label of root.querySelectorAll<HTMLElement>('.reading-reset')) {
      const text = compactResetLabel(label.dataset.resetAt ? Number(label.dataset.resetAt) : null);
      if (label.textContent !== text) label.textContent = text;
    }
  }
  if (!expanded || panelView !== 'settings') return;
  for (const label of root.querySelectorAll<HTMLElement>('[data-last-check]')) {
    const text = elapsedLabel(label.dataset.lastCheck ? Number(label.dataset.lastCheck) : null);
    if (label.textContent !== text) label.textContent = text;
  }
  for (const label of root.querySelectorAll<HTMLElement>('[data-retry-at]')) {
    const at = label.dataset.retryAt ? Number(label.dataset.retryAt) : null;
    const text = retryLabel(at).replace(label.dataset.retryReady === 'true' ? 'Next retry' : 'Never replace', 'Next check');
    if (label.textContent !== text) label.textContent = text;
    const button = label.parentElement?.querySelector<HTMLButtonElement>('[data-action="refresh-health"]');
    const provider = button?.dataset.provider as Provider | undefined;
    const health = provider ? snapshot.health?.[provider] : null;
    const cooldown = Boolean(at && at > Date.now() / 1000 && (provider === 'claude' || health?.status === 'rateLimited'));
    if (button) {
      button.disabled = snapshot.refreshing || cooldown;
      const text = cooldown ? 'Waiting to retry' : 'Refresh';
      if (button.textContent !== text) button.textContent = text;
    }
  }
  for (const label of root.querySelectorAll<HTMLElement>('[data-snooze-until]')) {
    const until = label.dataset.snoozeUntil ? Number(label.dataset.snoozeUntil) : 0;
    const snoozed = until > Date.now() / 1000;
    const text = snoozed ? `Alerts snoozed · ${retryLabel(until).replace('Next retry in ', '')} left` : 'Alerts active';
    if (label.textContent !== text) label.textContent = text;
    const button = label.parentElement?.querySelector<HTMLButtonElement>('[data-action="snooze-alerts"], [data-action="resume-alerts"]');
    if (button) {
      const text = snoozed ? 'Resume alerts' : 'Snooze 1 hour';
      if (button.textContent !== text) { button.textContent = text; button.dataset.action = snoozed ? 'resume-alerts' : 'snooze-alerts'; }
    }
  }
}, 1000);
