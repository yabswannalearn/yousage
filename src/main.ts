import './style.css';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { defaultAppTheme, themePalette, readableAccent, type AppTheme } from './theme';
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
  type Provider,
  type Account,
  type AntigravityAccount,
  type AntigravityGroup,
  type Snapshot,
  type SwitchPlan,
  type UsageWindow,
  type UsagePreferences,
} from './model';

const native = isTauri();
const params = new URLSearchParams(location.search);
const preview = !native && import.meta.env.DEV && params.has('preview');
const root = document.querySelector<HTMLElement>('#app')!;
let snapshot: Snapshot = {
  accounts: [],
  activeAccountId: null,
  antigravity: { email: null, groups: [], accounts: [], updatedAt: null, error: null },
  claude: { email: null, plan: null, fiveHour: null, weekly: null, updatedAt: null, error: null },
  alerts: [],
  update: { currentVersion: '0.1.0', latestVersion: null, releaseUrl: null, installerUrl: null, updateAvailable: false, checking: false, error: null },
  refreshing: false,
  desktopError: null,
  login: null,
  switching: null,
  settings: { startWithWindows: true, refreshSeconds: 60, notchSource: 'codex', notificationsEnabled: true, providerColors: { ...defaultProviderColors }, hiddenProviders: [], appTheme: { ...defaultAppTheme } },
};
let expanded = false;
let upward = false;
type DockEdge = 'floating' | 'top' | 'bottom' | 'left' | 'right';
type NotchLayout = { upward: boolean; height: number; width?: number; edge?: DockEdge };
let dockEdge: DockEdge = 'floating';
function applyLayout(layout: NotchLayout) {
  upward = layout.upward;
  dockEdge = layout.edge ?? 'floating';
  root.dataset.edge = dockEdge;
  root.classList.toggle('upward', upward);
  if (preview) {
    root.style.width = `${layout.width ?? 440}px`;
    root.style.height = `${layout.height}px`;
  }
}
let settingsOpen = false;
let adding = false;
let savingAgy = false;
let managing: string | null = null;
let managingAgy: string | null = null;
let disconnectConfirmation: string | null = null;
let disconnectAgyConfirmation: string | null = null;
let error = '';
let transition = false;
let opening = false;
let preparingOpen = false;
let desiredHeight = 0;
const OPEN_MS = 420;
const CLOSE_MS = 240;
const motionMs = (duration: number) => matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : duration;
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

const paths: Record<string, string> = {
  chevron: '<path d="m5 8 5 5 5-5"/>',
  plus: '<path d="M10 4v12M4 10h12"/>',
  refresh: '<path d="M16 8a6.2 6.2 0 1 0 .1 4M16 3v5h-5"/>',
  settings: '<path d="m8 3 4 0 .7 2 2 .8 1.9-.4 2 3.5-1.5 1.4-.3 2.2 1 1.7-2.8 2.8-1.7-1-2.2.3-1.4 1.5-3.5-2 .4-1.9-.8-2L3 12V8l2-.7.8-2-.4-1.9L8 3Z"/><circle cx="10" cy="10" r="2.5"/>',
  hide: '<path d="M4 10h12"/>',
  x: '<path d="m5 5 10 10M15 5 5 15"/>',
  more: '<circle cx="4" cy="10" r=".6"/><circle cx="10" cy="10" r=".6"/><circle cx="16" cy="10" r=".6"/>',
  swap: '<path d="M3 6h13m-3-3 3 3-3 3M17 14H4m3-3-3 3 3 3"/>',
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
    return { edge, width: side && !args?.expanded ? 58 : side || edge === 'floating' ? 440 : 480, upward: edge === 'bottom' || (edge === 'floating' && params.has('up')), height: args?.expanded ? Math.min(Math.max(compact, Number(args?.height ?? 80)), innerHeight - 64) : compact } as T;
  }
  if (command === 'get_snapshot') return snapshot as T;
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
  } else if (command === 'update_usage_preferences') {
    snapshot.settings.usagePreferences = args?.preferences as UsagePreferences;
  } else if (command === 'dismiss_alert') {
    snapshot.alerts = snapshot.alerts.filter(a => a.id !== args?.id);
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
    snapshot.update = { ...snapshot.update, latestVersion: '0.1.0', updateAvailable: false, checking: false, error: null };
  } else if (command === 'open_release_url') {
    window.open(String(args?.url ?? 'https://github.com/yabswannalearn/yousage/releases/latest'), '_blank', 'noopener');
  } else if (command === 'rename_account') {
    const account = snapshot.accounts.find(a => a.id === args?.id);
    if (account) account.label = String(args?.label);
  } else if (command === 'disconnect_account') {
    snapshot.accounts = snapshot.accounts.filter(account => account.id !== args?.id);
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
  return `<span class="small-reading ${stale ? 'cached-reading' : ''} ${value != null && value <= preferences().alertRules[provider].warningPercent ? 'low' : ''}" style="--sage:${providerColor(snapshot.settings.providerColors, provider)}" title="${esc(tooltip)}">${usageRing(`${providerNames[provider]} ${label}`, value)}<span class="reading-copy"><span class="reading-line"><span class="reading-label">${label}</span><strong>${percentage(value)}</strong></span><span class="reading-reset" data-reset-at="${window?.resetsAt ?? ''}">${esc(compactResetLabel(window?.resetsAt))}</span></span></span>`;
}

const visible = (provider: Provider) => !snapshot.settings.hiddenProviders.includes(provider);
const notchSource = () => effectiveNotchSource(snapshot.settings.notchSource, snapshot.settings.hiddenProviders);
const providerNames: Record<Provider, string> = { codex: 'Codex', antigravity: 'Antigravity', claude: 'Claude' };
const preferences = () => preferenceDraft ?? usagePreferences(snapshot.settings);
const selectedProviders = () => notchProviders(snapshot.settings.notchSource, preferences(), snapshot.settings.hiddenProviders);
const inPreview = (provider: Provider) => selectedProviders().includes(provider);
const providerReading = (provider: Provider) => provider === 'codex' ? snapshot.accounts.find(account => isActiveAccount(account, snapshot.accounts, snapshot.activeAccountId)) : snapshot[provider];
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

function connectionHealthSettings() {
  const statusNames = { checking: 'Checking', ready: 'Connected', signInRequired: 'Sign in required', toolMissing: 'Tool missing', rateLimited: 'Rate limited', offline: 'Offline', error: 'Needs attention' };
  return `<div class="settings-group"><h3>Connection health</h3>${(Object.keys(providerNames) as Provider[]).filter(visible).map(provider => {
    const fallback = provider === 'codex' ? snapshot.accounts.find(account => isActiveAccount(account, snapshot.accounts, snapshot.activeAccountId)) : snapshot[provider];
    const health = snapshot.health?.[provider];
    const ready = health?.status === 'ready';
    const coolingDown = Boolean(health?.nextRetryAt && health.nextRetryAt > Date.now() / 1000 && (provider === 'claude' || health.status === 'rateLimited'));
    return `<div class="health-card" ${accentStyle(provider)}><div class="health-heading"><strong>${providerNames[provider]}</strong><span class="health-status ${health && !ready ? 'attention' : ''}">${health ? statusNames[health.status] : fallback?.error ? 'Needs attention' : fallback?.updatedAt ? 'Connected' : 'Not checked'}</span></div><p class="fine-print" data-last-check="${health?.lastSuccessAt ?? fallback?.updatedAt ?? ''}">${esc(elapsedLabel(health?.lastSuccessAt ?? fallback?.updatedAt))}</p>${health?.message ? `<p class="health-message">${esc(health.message)}</p>` : ''}<div class="health-actions"><span class="fine-print" data-retry-at="${health?.nextRetryAt ?? ''}" data-retry-ready="${ready}">${esc(retryLabel(health?.nextRetryAt).replace(ready ? 'Next retry' : 'Never replace', 'Next check'))}</span><button type="button" class="text-button" data-action="refresh-health" data-provider="${provider}" ${snapshot.refreshing || coolingDown ? 'disabled' : ''}>${coolingDown ? 'Waiting to retry' : 'Refresh'}</button>${health?.recoveryCommand ? `<button type="button" class="text-button" data-action="copy-recovery" data-command="${esc(health.recoveryCommand)}">Copy sign-in command</button>` : ''}</div></div>`;
  }).join('')}</div>`;
}

function alertSettings() {
  const rules = preferences().alertRules;
  return `<div class="settings-group"><h3>Allowance alerts</h3><p class="fine-print">Thresholds are the percentage remaining. Critical must be lower than warning.</p><div class="threshold-grid"><span>Provider</span><span>Warning %</span><span>Critical %</span>${(Object.keys(providerNames) as Provider[]).map(provider => `<label for="warning-${provider}">${providerNames[provider]}</label><input id="warning-${provider}" aria-label="${providerNames[provider]} warning percent" type="number" min="1" max="100" step="1" data-alert-provider="${provider}" data-alert-level="warningPercent" value="${rules[provider].warningPercent}"/><input id="critical-${provider}" aria-label="${providerNames[provider]} critical percent" type="number" min="0" max="99" step="1" data-alert-provider="${provider}" data-alert-level="criticalPercent" value="${rules[provider].criticalPercent}"/>`).join('')}</div>${([['lowEnabled', 'Low allowance alerts'], ['resetEnabled', 'Reset alerts'], ['quietHoursEnabled', 'Quiet hours']] as const).map(([key, label]) => `<label class="setting-row" for="alert-${key}"><span>${label}</span><input id="alert-${key}" class="switch" type="checkbox" data-alert-toggle="${key}" ${rules[key] ? 'checked' : ''}/></label>`).join('')}<div class="quiet-times"><label for="quiet-start">From<input id="quiet-start" type="time" data-quiet-time="quietStart" value="${esc(rules.quietStart)}" ${rules.quietHoursEnabled ? '' : 'disabled'}/></label><label for="quiet-end">Until<input id="quiet-end" type="time" data-quiet-time="quietEnd" value="${esc(rules.quietEnd)}" ${rules.quietHoursEnabled ? '' : 'disabled'}/></label></div><p class="fine-print">Quiet hours follow your computer’s local time.</p><div class="setting-row"><span class="fine-print" data-snooze-until="${rules.snoozedUntil ?? ''}">${rules.snoozedUntil && rules.snoozedUntil > Date.now() / 1000 ? `Alerts snoozed · ${retryLabel(rules.snoozedUntil).replace('Next retry in ', '')} left` : 'Alerts active'}</span><button type="button" class="subtle-button" data-action="${rules.snoozedUntil && rules.snoozedUntil > Date.now() / 1000 ? 'resume-alerts' : 'snooze-alerts'}">${rules.snoozedUntil && rules.snoozedUntil > Date.now() / 1000 ? 'Resume alerts' : 'Snooze 1 hour'}</button></div></div>`;
}

function customPreviewSettings() {
  const prefs = preferences();
  const providers = notchProviders(snapshot.settings.notchSource, prefs, []);
  const group = selectedAntigravityGroup(snapshot.antigravity, snapshot.settings.notchSource);
  return `<div class="custom-preview"><div class="preview-providers" role="group" aria-label="Providers in notch">${(Object.keys(providerNames) as Provider[]).map(provider => `<label for="preview-${provider}" ${accentStyle(provider)}><input id="preview-${provider}" type="checkbox" aria-label="${providerNames[provider]} in notch" data-notch-provider="${provider}" ${providers.includes(provider) ? 'checked' : ''}/><span>${providerNames[provider]}${!visible(provider) ? ' · hidden' : ''}</span></label>`).join('')}</div><label class="setting-row" for="notch-window"><span>Preview window</span><select id="notch-window"><option value="limiting" ${prefs.notchWindow === 'limiting' ? 'selected' : ''}>Lowest remaining</option><option value="fiveHour" ${prefs.notchWindow === 'fiveHour' ? 'selected' : ''}>5 hour</option><option value="weekly" ${prefs.notchWindow === 'weekly' ? 'selected' : ''}>Weekly</option></select></label>${snapshot.antigravity.groups.length ? `<label class="setting-row" for="notch-group"><span>Antigravity group</span><select id="notch-group">${snapshot.antigravity.groups.map(item => `<option value="${esc(item.id)}" ${group?.id === item.id ? 'selected' : ''}>${esc(item.label)}</option>`).join('')}</select></label>` : ''}<p class="fine-print">Combine any providers. Lowest remaining shows the tightest allowance for each. Hidden subscriptions return when shown again.</p></div>`;
}
const accentStyle = (provider: Provider) => {
  const color = providerColor(snapshot.settings.providerColors, provider);
  return `style="--sage:${color};--accent-ink:${readableAccent(color, themePalette(snapshot.settings.appTheme)['--card'])}"`;
};

function applyAppTheme(theme: AppTheme) {
  const palette = themePalette(theme);
  for (const [property, value] of Object.entries(palette)) root.style.setProperty(property, value);
  for (const element of root.querySelectorAll<HTMLElement>('[style]')) {
    const accent = element.style.getPropertyValue('--sage');
    if (accent) element.style.setProperty('--accent-ink', readableAccent(accent, palette['--card']));
  }
}

function appearanceSettings() {
  const theme = snapshot.settings.appTheme ?? defaultAppTheme;
  return `<div class="appearance-settings"><div class="settings-heading"><h3>Appearance</h3><button type="button" class="text-button" data-action="reset-app-theme">Reset colors</button></div><p class="fine-print">Applies to the whole notch and detail panel.</p>${(['background', 'accent'] as const).map(key => `<label class="setting-row" for="app-${key}"><span>${key === 'background' ? 'App background' : 'UI accent'}</span><span class="color-control"><span class="color-value" data-theme-value="${key}">${esc(theme[key])}</span><input type="color" id="app-${key}" aria-label="${key === 'background' ? 'App background' : 'UI accent'}" data-theme="${key}" value="${esc(theme[key])}"/></span></label>`).join('')}</div>`;
}

function claudeSection() {
  if (!visible('claude')) return '';
  const { claude } = snapshot;
  const inNotch = inPreview('claude');
  return `<section class="provider-section" aria-label="Claude usage" ${accentStyle('claude')}><div class="section-divider"><span class="eyebrow">CLAUDE</span><div class="provider-heading"><h2>Subscription usage</h2></div></div><article class="account-card ${inNotch ? 'active' : ''}"><div class="account-heading"><span class="avatar">C</span><div class="account-identity"><div class="account-name">Claude${claude.plan ? `<span class="plan"> · ${esc(claude.plan)}</span>` : ''}${inNotch ? '<span class="active-badge">In notch</span>' : '<button type="button" class="text-button notch-pill" data-action="set-notch" data-source="claude">Show in notch</button>'}</div><div class="account-email">${esc(claude.email ?? 'Claude Code subscription')}</div></div></div><div class="limits">${limitRow('5 hour', claude.fiveHour, 'claude')}${limitRow('Weekly', claude.weekly, 'claude')}</div><div class="account-status ${claude.error ? 'attention' : ''}"><span class="status-dot"></span>${esc(freshness(claude))}</div>${claude.error ? `<p class="account-error">${esc(claude.error)}</p>` : ''}</article></section>`;
}

function limitRow(label: string, window: UsageWindow | null, provider: Provider = 'codex') {
  const value = window?.remaining;
  return `<div class="limit ${value != null && value <= preferences().alertRules[provider].warningPercent ? 'low' : ''}">${usageRing(label, value)}<div class="limit-copy"><div class="limit-heading"><span>${label}</span><strong>${percentage(value)}<span class="remaining-word"> left</span></strong></div><div class="reset">${window ? esc(resetLabel(window.resetsAt)) : 'Limit unavailable'}</div></div></div>`;
}

function alertsBanner() {
  const parts: string[] = [];
  if (snapshot.update.updateAvailable && snapshot.update.latestVersion) {
    const url = esc(snapshot.update.installerUrl ?? snapshot.update.releaseUrl ?? 'https://github.com/yabswannalearn/yousage/releases/latest');
    parts.push(`<div class="suggest-banner update-banner" role="status"><div class="suggest-copy"><strong>Update available · v${esc(snapshot.update.latestVersion)}</strong><span>Download the latest Windows Setup Wizard installer.</span></div><button type="button" class="subtle-button" data-action="open-release" data-url="${url}">Download</button></div>`);
  }
  for (const alert of snapshot.alerts.filter(alert => !(snapshot.settings.hiddenProviders ?? []).some(provider => alert.id.startsWith(`${provider === 'antigravity' ? 'agy' : provider}:`)))) {
    parts.push(`<div class="alert-banner ${alert.kind === 'reset' ? 'reset' : 'low'}" role="status"><div class="suggest-copy"><strong>${esc(alert.title)}</strong><span>${esc(alert.message)}</span></div>${iconButton('dismiss-alert', 'x', 'Dismiss alert', `data-id="${esc(alert.id)}"`)}</div>`);
  }
  const prefs = preferences();
  const suggestions = [
    { provider: 'codex' as const, recommendation: codexRecommendation(snapshot.accounts, snapshot.activeAccountId, prefs), action: 'prepare-switch' },
    { provider: 'antigravity' as const, recommendation: antigravityRecommendation(snapshot.antigravity, selectedAntigravityGroup(snapshot.antigravity, snapshot.settings.notchSource)?.id ?? null, prefs), action: 'switch-agy' },
  ];
  for (const { provider, recommendation, action } of suggestions) if (visible(provider) && recommendation && !switchPlan && !snapshot.switching) {
    parts.push(`<div class="suggest-banner" role="status" data-recommendation="${provider}"><div class="suggest-copy"><strong>${providerNames[provider]} account suggestion</strong><span>${esc(recommendation.reason)}</span></div><button type="button" class="subtle-button" data-action="${action}" data-id="${esc(recommendation.id)}">Switch to ${esc(recommendation.label)}</button></div>`);
  }
  return parts.join('');
}

function accountCard(account: Account) {
  const active = isActiveAccount(account, snapshot.accounts, snapshot.activeAccountId);
  const inNotch = active && inPreview('codex');
  const initial = esc((account.label || account.email || 'C').charAt(0).toUpperCase());
  const id = esc(account.id);
  const notchAction = active && !inNotch ? `<button type="button" class="text-button notch-pill" data-action="set-notch" data-source="codex">Show in notch</button>` : '';
  const controls = managing === account.id ? `<form class="manage-form" data-form="rename" data-id="${id}"><label class="field-label" for="name-${id}">Account name</label><div class="inline-input"><input id="name-${id}" name="label" value="${esc(account.label)}" maxlength="48" required autocomplete="off"/><button class="subtle-button" type="submit">Save</button></div>${account.desktop ? '<p class="fine-print">Connect this account to save its preferences.</p>' : accountPreferenceControls(account.id)}<div class="manage-actions">${account.desktop ? '<span class="fine-print">Sign-in is managed in Codex.</span>' : `<button type="button" class="text-button" data-action="reconnect" data-id="${id}">Sign in again</button><button type="button" class="text-button danger" data-action="disconnect" data-id="${id}">${disconnectConfirmation === account.id ? 'Confirm disconnect' : 'Disconnect'}</button>`}</div></form>` : '';
  const switchButton = !active && !account.desktop ? `<button class="switch-account-button" data-action="prepare-switch" data-id="${id}" ${snapshot.switching || preparingSwitch || switchPlan || snapshot.login && !snapshot.login.error ? 'disabled' : ''}>${icon('swap')}<span>${preparingSwitch === account.id ? 'Checking Codex…' : 'Switch to this account'}</span><span aria-hidden="true">→</span></button>` : '';
  return `<article ${accentStyle('codex')} class="account-card ${active ? 'active' : ''}"><div class="account-heading"><span class="avatar">${initial}</span><div class="account-identity"><div class="account-name">${esc(account.label)}${active ? `<span class="active-badge">${inNotch ? 'Active · In notch' : 'Active'}</span>` : ''}${notchAction}</div><div class="account-email" title="${esc(account.email ?? '')}">${esc(account.email ?? 'ChatGPT account')}${account.plan ? `<span class="plan"> · ${esc(account.plan)}</span>` : ''}</div></div>${iconButton('manage', 'more', 'Manage account', `data-id="${id}" ${snapshot.switching || preparingSwitch || switchPlan ? 'disabled' : ''}`)}</div><div class="limits">${limitRow('5 hour', account.fiveHour)}${limitRow('Weekly', account.weekly)}</div><div class="account-status ${account.error ? 'attention' : ''}"><span class="status-dot"></span>${esc(freshness(account))}</div>${account.error ? `<p class="account-error">${esc(account.error)}</p>` : ''}${controls}${switchButton}</article>`;
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
  const controls = managingAgy === acc.id ? `<form class="manage-form" data-form="rename-agy" data-id="${id}"><label class="field-label" for="agy-name-${id}">Account name</label><div class="inline-input"><input id="agy-name-${id}" name="label" value="${esc(acc.label)}" maxlength="48" required autocomplete="off"/><button class="subtle-button" type="submit">Save</button></div>${accountPreferenceControls(acc.id, 'antigravity')}<div class="manage-actions"><button type="button" class="text-button danger" data-action="disconnect-agy" data-id="${id}">${disconnectAgyConfirmation === acc.id ? 'Confirm remove' : 'Remove saved account'}</button></div></form>` : '';
  return `<article class="account-card"><div class="account-heading"><span class="avatar">${initial}</span><div class="account-identity"><div class="account-name">${esc(acc.label)}<span class="active-badge">Saved AGY</span></div><div class="account-email" title="${esc(acc.email ?? '')}">${esc(acc.email ?? 'Google Antigravity account')}</div></div>${iconButton('manage-agy', 'more', 'Manage Antigravity account', `data-id="${id}"`)}</div>${primary ? `<div class="limits">${limitRow(`${primary.label} · 5h`, primary.fiveHour, 'antigravity')}${limitRow(`${primary.label} · Wk`, primary.weekly, 'antigravity')}</div>` : ''}<div class="account-status ${acc.error ? 'attention' : ''}"><span class="status-dot"></span>${esc(freshness(acc))}</div>${acc.error ? `<p class="account-error">${esc(acc.error)}</p>` : ''}${controls}<button class="switch-account-button" data-action="switch-agy" data-id="${id}">${icon('swap')}<span>Switch Antigravity to ${esc(acc.label)}</span><span aria-hidden="true">→</span></button></article>`;
}

function antigravitySection() {
  if (!visible('antigravity')) return '';
  const { antigravity } = snapshot;
  const selected = selectedAntigravityGroup(antigravity, snapshot.settings.notchSource);
  const savedAccounts = (antigravity.accounts ?? []).filter(a => !a.active);
  const activeSaved = (antigravity.accounts ?? []).find(a => a.active && a.id !== 'active');
  const saveForm = savingAgy ? `<form class="manage-form agy-save-form" data-form="save-agy"><label class="field-label" for="agy-save-label">Save current Antigravity sign-in (${esc(antigravity.email ?? 'active')})</label><div class="inline-input"><input id="agy-save-label" name="label" value="${esc(activeSaved?.label ?? antigravity.email?.split('@')[0] ?? 'Personal')}" placeholder="Work or Personal" maxlength="48" required autocomplete="off"/><button class="subtle-button" type="submit">Save</button><button class="text-button" type="button" data-action="cancel-save-agy">Cancel</button></div></form>` : '';
  return `<section class="provider-section" aria-label="Antigravity usage" ${accentStyle('antigravity')}><div class="section-divider"><div><span class="eyebrow">ANTIGRAVITY</span><div class="provider-heading"><h2>Model quotas<span class="account-count">${antigravity.groups.length}</span></h2><span class="account-status provider-status ${antigravity.error ? 'attention' : ''}"><span class="status-dot"></span>${esc(freshness(antigravity))}</span></div>${antigravity.email ? `<div class="provider-email">${esc(antigravity.email)}${activeSaved ? ` · <strong>${esc(activeSaved.label)}</strong>` : ''}${!savingAgy ? ` <button type="button" class="text-button notch-pill" data-action="toggle-save-agy">${activeSaved ? 'Update saved' : 'Save sign-in'}</button>` : ''}</div>` : ''}</div></div>${saveForm}${antigravity.groups.map(group => antigravityGroupCard(group, selected?.id)).join('')}${savedAccounts.map(savedAntigravityAccountCard).join('')}${antigravity.groups.length === 0 ? `<div class="empty-state compact-empty"><h2>${snapshot.refreshing ? 'Checking Antigravity' : 'Antigravity quota'}</h2><p>${esc(antigravity.error ?? 'Sign in with Antigravity CLI (agy) to view model quotas.')}</p></div>` : antigravity.error ? `<p class="account-error">${esc(antigravity.error)}</p>` : ''}</section>`;
}

function switchPanel() {
  if (snapshot.switching) return `<section class="switch-panel" role="status"><h2>Switching account</h2><p>${esc(snapshot.switching)}</p></section>`;
  if (!switchPlan) return '';
  const plan = switchPlan;
  const provider = plan.provider === 'antigravity' ? 'Antigravity' : 'Codex';
  const running = plan.processNames.length > 0;
  return `<section class="switch-panel" role="dialog" aria-labelledby="switch-title"><div class="section-heading"><h2 id="switch-title">Switch ${provider} account</h2>${iconButton('cancel-switch', 'x', 'Cancel account switch')}</div><div class="switch-route"><span>Current sign-in</span>${icon('swap')}<strong>${esc(plan.label)}</strong></div><span class="switch-targets">${provider} desktop + CLI</span><p>${running ? `Continuing force-closes these apps and related terminal sessions: ${plan.processNames.map(esc).join(', ')}. Running tasks will stop and unsaved work may be lost. Desktop apps will reopen after switching; start new terminal sessions yourself.` : `New ${provider} sessions will use this account. If a session starts before you confirm, the switch will ask you to check again.`}</p><button id="confirm-switch" class="primary-button" data-action="confirm-switch">${running ? 'Close sessions and switch' : 'Switch account'}<span aria-hidden="true">→</span></button><p class="switch-footnote">Your current account stays connected in YouSage.</p></section>`;
}

function settingsPanel() {
  const { antigravity, settings, update } = snapshot;
  const activeGroup = selectedAntigravityGroup(antigravity, settings.notchSource);
  const effectiveSource = notchSource();
  const currentSource = effectiveSource.startsWith('custom') ? 'custom' : isBothNotch(effectiveSource)
    ? (activeGroup ? `both:${activeGroup.id}` : 'both')
    : isAntigravityNotch(effectiveSource)
      ? (activeGroup ? `antigravity:${activeGroup.id}` : 'antigravity')
      : effectiveSource === 'claude' ? 'claude' : effectiveSource === 'none' ? 'none' : 'codex';
  const bothOptions = antigravity.groups.length
    ? antigravity.groups.map(group => `<option value="both:${esc(group.id)}" ${!visible('codex') || !visible('antigravity') ? 'disabled' : ''} ${currentSource === `both:${group.id}` ? 'selected' : ''}>Both · Codex + ${esc(group.label)}</option>`).join('')
    : `<option value="both" ${!visible('codex') || !visible('antigravity') ? 'disabled' : ''} ${currentSource === 'both' ? 'selected' : ''}>Both · Codex + Antigravity</option>`;
  const antigravityOptions = antigravity.groups.length
    ? antigravity.groups.map(group => `<option value="antigravity:${esc(group.id)}" ${!visible('antigravity') ? 'disabled' : ''} ${currentSource === `antigravity:${group.id}` ? 'selected' : ''}>Antigravity · ${esc(group.label)}</option>`).join('')
    : `<option value="antigravity" ${!visible('antigravity') ? 'disabled' : ''} ${currentSource === 'antigravity' ? 'selected' : ''}>Antigravity</option>`;
  const subscriptions = (Object.keys(defaultProviderColors) as Provider[]).map(provider => {
    const label = { codex: 'Codex', antigravity: 'Antigravity', claude: 'Claude' }[provider];
    return `<div class="subscription-setting"><label class="subscription-toggle" for="show-${provider}"><input class="switch" id="show-${provider}" type="checkbox" data-visibility="${provider}" ${visible(provider) ? 'checked' : ''}/><span>${label}</span></label><label class="color-control"><span class="sr-only">${label} color</span><input type="color" id="color-${provider}" data-color="${provider}" value="${providerColor(settings.providerColors, provider)}" title="${label} color"/></label></div>`;
  }).join('');
  const updateUrl = esc(update.installerUrl ?? update.releaseUrl ?? 'https://github.com/yabswannalearn/yousage/releases/latest');
  const updateStatusText = update.checking
    ? 'Checking GitHub Releases…'
    : update.error
      ? update.error
      : update.updateAvailable && update.latestVersion
        ? `Update v${update.latestVersion} available`
        : `Up to date (v${update.currentVersion})`;
  return `<section class="settings-panel" aria-label="Settings"><div class="settings-heading"><h2>Settings</h2><span class="fine-print">v${esc(update.currentVersion)} · Alt+Shift+U</span></div>${appearanceSettings()}<label class="setting-row" for="notch-source"><span>Notch preview</span><select id="notch-source"><option value="custom" ${currentSource === 'custom' ? 'selected' : ''}>Custom combination</option><option value="codex" ${!visible('codex') ? 'disabled' : ''} ${currentSource === 'codex' ? 'selected' : ''}>Codex (active account)</option>${bothOptions}${antigravityOptions}<option value="claude" ${!visible('claude') ? 'disabled' : ''} ${currentSource === 'claude' ? 'selected' : ''}>Claude</option>${effectiveSource === 'none' ? '<option value="none" selected disabled>All subscriptions hidden</option>' : ''}</select></label>${customPreviewSettings()}<div class="subscription-settings"><h3>Subscriptions</h3><p class="fine-print">Show or hide each subscription and choose its color.</p>${subscriptions}</div><label class="setting-row" for="notifications"><span>Windows notifications</span><input class="switch" id="notifications" type="checkbox" ${settings.notificationsEnabled ? 'checked' : ''}/></label><div class="setting-row"><span class="fine-print">Low-allowance & reset alerts</span><button type="button" class="subtle-button" data-action="test-notification" ${settings.notificationsEnabled ? '' : 'disabled'}>Send test notification</button></div>${alertSettings()}<div class="settings-group"><h3>Account suggestions</h3><label class="setting-row" for="recommendation-purpose"><span>Suggest accounts for</span><select id="recommendation-purpose">${(['any', 'work', 'personal'] as const).map(value => `<option value="${value}" ${preferences().recommendationPurpose === value ? 'selected' : ''}>${value === 'any' ? 'Any purpose' : value === 'work' ? 'Work' : 'Personal'}</option>`).join('')}</select></label><p class="fine-print">Set an account’s purpose or exclude it through Manage account. Suggestions use fresh readings and reset times.</p></div>${connectionHealthSettings()}<label class="setting-row" for="startup"><span>Start with Windows</span><input class="switch" id="startup" type="checkbox" ${settings.startWithWindows ? 'checked' : ''}/></label><label class="setting-row" for="refresh-interval"><span>Refresh usage every</span><select id="refresh-interval">${[[30, '30 seconds'], [60, '1 minute'], [120, '2 minutes'], [300, '5 minutes'], [600, '10 minutes']].map(([value, label]) => `<option value="${value}" ${settings.refreshSeconds === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><div class="setting-row update-row"><span>${esc(updateStatusText)}</span>${update.updateAvailable ? `<button type="button" class="subtle-button" data-action="open-release" data-url="${updateUrl}">Install v${esc(update.latestVersion ?? '')}</button>` : `<button type="button" class="subtle-button" data-action="check-updates" ${update.checking ? 'disabled' : ''}>Check updates</button>`}</div><p class="fine-print">Press Alt+Shift+U anywhere to show or toggle the notch.</p></section>`;
}

function addPanel() {
  const signingIn = snapshot.login && !snapshot.login.error;
  if (signingIn) return `<section class="add-panel"><div class="connection-symbol">${icon('plus')}</div><h2>${esc(snapshot.login!.status)}</h2><p>Your current Codex sign-in stays connected.</p><button class="subtle-button" data-action="cancel-login">Cancel sign-in</button></section>`;
  if (!adding) return '';
  return `<section class="add-panel"><div class="section-heading"><h2>Connect an account</h2>${iconButton('cancel-add', 'x', 'Cancel')}</div><form data-form="connect"><label class="field-label" for="account-label">Account name</label><input id="account-label" name="label" placeholder="Work or Personal" maxlength="48" autocomplete="off" required/><p>Sign in with ChatGPT in your browser. You only need to do this once per account.</p><button class="primary-button" type="submit">Continue in browser <span aria-hidden="true">↗</span></button></form></section>`;
}

function render(autoSync = true) {
  // Background snapshots must not replace the shell mid-animation.
  if (transition && autoSync) return;
  if (dragging || colorPickerOpen || rendering) return;
  applyAppTheme(snapshot.settings.appTheme ?? defaultAppTheme);
  const focused = document.activeElement instanceof HTMLElement && root.contains(document.activeElement) ? document.activeElement : null;
  const focusTarget = focused ? { id: focused.id, action: focused.dataset.action, accountId: focused.dataset.id, restore: document.hasFocus() } : null;
  const preserved = focused instanceof HTMLInputElement && ['text', 'search', 'number', 'time'].includes(focused.type) ? { id: focused.id, value: focused.value, start: focused.selectionStart, end: focused.selectionEnd } : null;
  const nameDrafts = Array.from(root.querySelectorAll<HTMLInputElement>('input:not([type]), input[type="text"], input[type="search"]')).map(input => ({ id: input.id, value: input.value }));
  const scrollTop = root.querySelector('.panel-scroll')?.scrollTop ?? 0;
  const accounts = uniqueAccounts(snapshot.accounts, snapshot.activeAccountId);
  const desktop = snapshot.accounts.find(account => account.id === snapshot.activeAccountId);
  const active = accounts.find(account => account.id === snapshot.activeAccountId || (account.identity && account.identity === desktop?.identity));
  const providers = selectedProviders();
  const source = providers.length ? notchSource() : 'none';
  const notchGroup = selectedAntigravityGroup(snapshot.antigravity, snapshot.settings.notchSource);
  const multi = providers.length > 1;
  const custom = snapshot.settings.notchSource.startsWith('custom');
  const selected = providers[0];
  const title = snapshot.switching ? 'Switching account…'
    : !selected ? 'YouSage'
    : multi ? providers.map(provider => provider === 'antigravity' ? 'AGY' : providerNames[provider]).join(' + ')
    : selected === 'claude' ? 'Claude'
    : selected === 'antigravity' ? (notchGroup?.label ?? (snapshot.refreshing ? 'Checking Antigravity' : 'Antigravity'))
    : (active?.label ?? (snapshot.refreshing ? 'Checking Codex' : 'No active account'));
  const currentStatus = selected === 'codex' ? active : selected === 'antigravity' ? snapshot.antigravity : snapshot.claude;
  const subtitle = preview ? 'Preview data'
    : source === 'none' ? 'Subscriptions hidden · open Settings'
    : multi ? (providers.some(provider => readingIsStale(providerReading(provider))) ? 'Cached readings · open for details' : preferences().notchWindow === 'limiting' ? 'Lowest allowance remaining' : 'Allowance remaining')
    : currentStatus?.error ? freshness(currentStatus) : `${providerNames[selected]} remaining`;
  const readingsHtml = providers.map(provider => {
    const limits = provider === 'codex' ? active : provider === 'antigravity' ? notchGroup : snapshot.claude;
    if (multi || custom) {
      const chosen = previewWindow(limits?.fiveHour ?? null, limits?.weekly ?? null, preferences().notchWindow);
      const prefix = provider === 'codex' ? 'C' : provider === 'antigravity' ? 'A' : 'Cl';
      return smallReading(`${multi ? `${prefix}·` : ''}${chosen.label}`, chosen.window, provider);
    }
    return `${smallReading('5h', limits?.fiveHour ?? null, provider)}${smallReading('Week', limits?.weekly ?? null, provider)}`;
  }).join('');
  const notchTooltip = 'Click to expand · drag to an edge to dock · drag away to float · Alt+Shift+U';
  const notchProvider = selected ?? 'codex';
  root.className = `${expanded ? 'expanded' : ''} ${upward ? 'upward' : ''} ${opening ? 'opening' : ''} ${preparingOpen ? 'preparing-open' : ''}`;
  rendering = true;
  root.innerHTML = `<div class="shell"><button id="notch-toggle" ${accentStyle(notchProvider)} class="compact ${providers.length === 3 ? 'three-providers' : ''}" data-action="toggle" aria-expanded="${expanded}" aria-controls="detail-panel" title="${esc(notchTooltip)}"><span class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></span><span class="compact-identity"><span class="compact-title">${esc(title)}</span><span class="compact-subtitle">${esc(subtitle)}</span></span><span class="compact-readings">${readingsHtml}</span><span class="expand-icon">${icon('chevron')}</span></button>${expanded ? `<section id="detail-panel" class="details" aria-label="Usage remaining"><div class="panel-scroll">${error || snapshot.login?.error ? `<div class="error-banner" role="alert">${esc(error || snapshot.login!.error!)}${iconButton('clear-error', 'x', 'Dismiss error')}</div>` : ''}${notice ? `<div class="success-banner" role="status">${esc(notice)}</div>` : ''}${alertsBanner()}${source === 'none' ? '<div class="empty-state"><h2>All subscriptions hidden</h2><p>Open Settings below to bring a subscription back.</p></div>' : ''}${switchPanel()}${visible('codex') ? `<header class="panel-heading"><div><span class="eyebrow">${preview ? 'PREVIEW DATA' : 'CODEX'}</span><h1>Connected accounts<span class="account-count">${accounts.length}</span></h1></div>${iconButton('refresh', 'refresh', snapshot.refreshing ? 'Refreshing usage' : 'Refresh usage', snapshot.refreshing || snapshot.switching ? 'disabled' : '')}</header>${accounts.map(accountCard).join('')}${accounts.length === 0 ? `<div class="empty-state"><div class="empty-symbol">${icon('plus')}</div><h2>${snapshot.refreshing ? 'Checking your Codex account' : 'Your accounts, in one place'}</h2><p>${esc(snapshot.desktopError ?? 'Sign in to the Codex desktop app, or connect a ChatGPT account below.')}</p></div>` : ''}${!active && snapshot.desktopError && accounts.length ? `<p class="desktop-note">${esc(snapshot.desktopError)}</p>` : ''}${addPanel()}` : ''}${antigravitySection()}${claudeSection()}${settingsOpen ? settingsPanel() : ''}<div class="privacy-note">Stored on this computer. Credentials stay in Windows.</div></div><footer class="panel-footer">${visible('codex') ? `<button class="add-button" type="button" data-action="add" ${snapshot.switching || preparingSwitch || switchPlan || snapshot.login && !snapshot.login.error ? 'disabled' : ''}>${icon('plus')}<span>Add account</span></button>` : `<span class="fine-print">Subscriptions</span>`}<div class="footer-tools">${!visible('codex') ? iconButton('refresh', 'refresh', 'Refresh usage') : ''}${iconButton('settings', 'settings', 'Settings', `aria-pressed="${settingsOpen}"`)}${iconButton('hide', 'hide', 'Hide to system tray')}</div></footer></section>` : ''}</div>`;
  const scroll = root.querySelector('.panel-scroll');
  rendering = false;
  if (scroll) scroll.scrollTop = scrollTop;
  for (const draft of nameDrafts) {
    const input = document.getElementById(draft.id);
    if (input instanceof HTMLInputElement) input.value = draft.value;
  }
  if (preserved) {
    const input = document.getElementById(preserved.id);
    if (input instanceof HTMLInputElement && ['text', 'search', 'number', 'time'].includes(input.type)) {
      input.value = preserved.value;
      if (['text', 'search'].includes(input.type) && preserved.start != null) input.setSelectionRange(preserved.start, preserved.end);
    }
  }
  if (focusTarget?.restore) {
    const target = focusTarget.id ? document.getElementById(focusTarget.id) : Array.from(root.querySelectorAll<HTMLElement>('[data-action]')).find(element => element.dataset.action === focusTarget.action && element.dataset.id === focusTarget.accountId);
    target?.focus({ preventScroll: true });
  }
  if (expanded && autoSync) void syncHeight();
}

async function syncHeight() {
  const details = root.querySelector<HTMLElement>('.details');
  if (!expanded || !details) return;
  const content = root.querySelector<HTMLElement>('.panel-scroll')!;
  const footer = root.querySelector<HTMLElement>('.panel-footer')!;
  const height = Math.min(680, 80 + content.scrollHeight + footer.offsetHeight);
  if (Math.abs(desiredHeight - height) < 2) return;
  desiredHeight = height;
  try {
    const layout = await call<NotchLayout>('set_expanded', { expanded: true, height });
    if (!expanded) return;
    applyLayout(layout);
  } catch (err) { error = String(err); }
}

async function toggle(open = !expanded) {
  if (transition || open === expanded) return;
  transition = true;
  if (open) {
    preparingOpen = true;
    expanded = true; desiredHeight = 0; render(false);
    await syncHeight();
    preparingOpen = false;
    opening = true;
    root.classList.remove('preparing-open');
    root.classList.add('opening');
    await new Promise(resolve => setTimeout(resolve, motionMs(OPEN_MS)));
    opening = false;
  } else {
    opening = false;
    root.classList.add('closing');
    await new Promise(resolve => setTimeout(resolve, motionMs(CLOSE_MS)));
    expanded = false; settingsOpen = false; adding = false; savingAgy = false; managing = null; managingAgy = null; disconnectConfirmation = null; disconnectAgyConfirmation = null; switchPlan = null; desiredHeight = 0;
    applyLayout(await call<NotchLayout>('set_expanded', { expanded: false, height: 80 }));
  }
  transition = false;
  render();
}

async function attempt(action: () => Promise<unknown>) {
  error = '';
  try { await action(); } catch (err) { error = err instanceof Error ? err.message : String(err); }
  render();
}

async function prepareSwitch(id: string, provider: 'codex' | 'antigravity' = 'codex') {
  if (snapshot.switching || preparingSwitch) return;
  preparingSwitch = id; switchPlan = null; notice = ''; error = ''; render();
  try {
    const plan = await call<SwitchPlan>(provider === 'antigravity' ? 'prepare_antigravity_switch' : 'prepare_switch', { id });
    if (expanded) { switchPlan = plan; adding = false; managing = null; }
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
    await call(plan.provider === 'antigravity' ? 'switch_antigravity_account' : 'switch_account', { id: plan.id, restartDesktop: plan.processNames.length > 0 });
    notice = `Now using ${plan.label} in ${plan.provider === 'antigravity' ? 'Antigravity' : 'Codex'} desktop and new CLI sessions.`;
  } finally { snapshot.switching = null; render(); }
}

root.addEventListener('click', event => {
  const target = (event.target as Element).closest<HTMLElement>('[data-action]');
  if (!target || (target instanceof HTMLButtonElement && target.disabled)) return;
  const id = target.dataset.id;
  switch (target.dataset.action) {
    case 'toggle': if (!suppressToggleClick) void attempt(() => toggle()); break;
    case 'refresh': void attempt(() => call('refresh_usage')); break;
    case 'refresh-health': {
      const provider = target.dataset.provider as Provider;
      const health = snapshot.health?.[provider];
      if (health?.nextRetryAt && health.nextRetryAt > Date.now() / 1000 && (provider === 'claude' || health.status === 'rateLimited')) return;
      void attempt(() => call('refresh_usage')); break;
    }
    case 'copy-recovery': void attempt(async () => { await navigator.clipboard.writeText(target.dataset.command ?? ''); notice = 'Sign-in command copied. Run it in your terminal, then refresh usage.'; }); break;
    case 'snooze-alerts': void attempt(() => savePreferences({ ...preferences(), alertRules: { ...preferences().alertRules, snoozedUntil: Math.floor(Date.now() / 1000) + 3600 } })); break;
    case 'resume-alerts': void attempt(() => savePreferences({ ...preferences(), alertRules: { ...preferences().alertRules, snoozedUntil: null } })); break;
    case 'hide': void attempt(async () => { await call('hide_notch'); expanded = false; if (preview) root.style.height = '80px'; }); break;
    case 'settings': settingsOpen = !settingsOpen; render(); root.querySelector('.settings-panel')?.scrollIntoView({ block: 'start' }); break;
    case 'reset-app-theme': void attempt(() => call('update_settings', { ...snapshot.settings, appTheme: { ...defaultAppTheme } })); break;
    case 'add': adding = true; error = ''; render(); document.getElementById('account-label')?.focus(); break;
    case 'cancel-add': adding = false; render(); break;
    case 'cancel-login': void attempt(() => call('cancel_sign_in')); break;
    case 'manage': managing = managing === id ? null : id!; disconnectConfirmation = null; render(); break;
    case 'manage-agy': managingAgy = managingAgy === id ? null : id!; disconnectAgyConfirmation = null; render(); break;
    case 'toggle-save-agy': savingAgy = !savingAgy; render(); document.getElementById('agy-save-label')?.focus(); break;
    case 'cancel-save-agy': savingAgy = false; render(); break;
    case 'switch-agy': if (id) void attempt(() => prepareSwitch(id, 'antigravity')); break;
    case 'disconnect-agy':
      if (disconnectAgyConfirmation !== id) { disconnectAgyConfirmation = id!; render(); }
      else void attempt(async () => { await call('disconnect_antigravity_account', { id }); managingAgy = null; disconnectAgyConfirmation = null; });
      break;
    case 'dismiss-alert': if (id) void attempt(() => call('dismiss_alert', { id })); break;
    case 'test-notification': void attempt(async () => { await call('test_notification'); notice = 'Test sent to Windows. Check Notification Center if no banner appears.'; }); break;
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
  const label = String(new FormData(form).get('label') ?? '').trim();
  if (!label) return;
  if (form.dataset.form === 'connect') void attempt(async () => { await call('connect_account', { label, reconnectId: null }); adding = false; });
  if (form.dataset.form === 'rename') void attempt(async () => { await call('rename_account', { id: form.dataset.id, label }); managing = null; });
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
  if (['Enter', ' '].includes(event.key) && (event.target as Element).closest('#notch-toggle')) suppressToggleClick = false;
  if (event.key === 'Escape' && expanded) void attempt(() => toggle(false));
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
      claude: { email: 'personal@example.com', plan: 'max', fiveHour: { remaining: 68, resetsAt: now + 9600 }, weekly: { remaining: 82, resetsAt: now + 345600 }, updatedAt: now, error: null },
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
    const previewEdge = params.get('edge');
    if (previewEdge && ['top', 'bottom', 'left', 'right'].includes(previewEdge)) dockEdge = previewEdge as DockEdge;
    applyLayout(await call<NotchLayout>('set_expanded', { expanded: false, height: 80 }));
    render();
    if (params.has('expanded')) await toggle(true);
    return;
  }
  if (!native) {
    root.innerHTML = '<div class="browser-message"><h1>YouSage</h1><p>Open the Windows desktop app to view your Codex and Antigravity usage.</p><a href="?preview=1&expanded=1">Open the interface preview</a></div>';
    document.documentElement.classList.add('browser-preview');
    return;
  }
  await listen<Snapshot>('usage-updated', event => {
    snapshot = event.payload;
    if (preferenceDraft) snapshot.settings.usagePreferences = preferenceDraft;
    if (notchSourceDraft) snapshot.settings.notchSource = notchSourceDraft;
    render();
  });
  await listen<NotchLayout>('notch-layout', event => { applyLayout(event.payload); });
  await listen('hotkey-toggle', () => { if (!transition) void toggle(); });
  await listen('collapse-requested', () => { if (expanded && !transition && !dragging && !colorPickerOpen) void toggle(false); });
  await listen('notch-focused', () => { if (colorPickerOpen) { colorPickerOpen = false; render(); } });
  await listen('notch-drag-finished', () => { dragging = false; render(); });
  await listen('panel-collapsed', () => { expanded = false; transition = false; switchPlan = null; desiredHeight = 0; render(); });
  snapshot = await call<Snapshot>('get_snapshot');
  applyLayout(await call<NotchLayout>('set_expanded', { expanded: false, height: 80 }));
  render();
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
  if (!expanded || !settingsOpen) return;
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
