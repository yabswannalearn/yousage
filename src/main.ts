import './style.css';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  escapeHtml as esc,
  freshness,
  percentage,
  resetLabel,
  uniqueAccounts,
  isActiveAccount,
  isAntigravityNotch,
  isBothNotch,
  selectedAntigravityGroup,
  suggestedCodexSwitch,
  type Account,
  type Alert,
  type AntigravityAccount,
  type AntigravityGroup,
  type Snapshot,
  type SwitchPlan,
  type UsageWindow,
} from './model';

const native = isTauri();
const params = new URLSearchParams(location.search);
const preview = !native && import.meta.env.DEV && params.has('preview');
const root = document.querySelector<HTMLElement>('#app')!;
let snapshot: Snapshot = {
  accounts: [],
  activeAccountId: null,
  antigravity: { email: null, groups: [], accounts: [], updatedAt: null, error: null },
  alerts: [],
  update: { currentVersion: '0.1.0', latestVersion: null, releaseUrl: null, installerUrl: null, updateAvailable: false, checking: false, error: null },
  refreshing: false,
  desktopError: null,
  login: null,
  switching: null,
  settings: { startWithWindows: true, refreshSeconds: 60, notchSource: 'codex', notificationsEnabled: true },
};
let expanded = false;
let upward = false;
let settingsOpen = false;
let adding = false;
let savingAgy = false;
let managing: string | null = null;
let managingAgy: string | null = null;
let disconnectConfirmation: string | null = null;
let disconnectAgyConfirmation: string | null = null;
let error = '';
let transition = false;
let desiredHeight = 0;
let ignoreClickUntil = 0;
let switchPlan: SwitchPlan | null = null;
let preparingSwitch: string | null = null;
let notice = '';

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

function notifyDesktop(alert: Alert) {
  if (!snapshot.settings.notificationsEnabled || !('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    new Notification(alert.title, { body: alert.message, silent: false });
  } else if (Notification.permission === 'default') {
    void Notification.requestPermission().then(perm => {
      if (perm === 'granted') new Notification(alert.title, { body: alert.message, silent: false });
    });
  }
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (native) return invoke<T>(command, args);
  if (!preview) throw new Error('Open the YouSage desktop app to connect your accounts.');
  if (command === 'set_expanded') return { upward: params.has('up'), height: Math.min(Number(args?.height ?? 80), innerHeight - 64) } as T;
  if (command === 'get_snapshot') return snapshot as T;
  if (command === 'prepare_switch') {
    const account = snapshot.accounts.find(a => a.id === args?.id)!;
    return { id: account.id, label: account.label, desktopRunning: true, cliRunning: params.has('cli') } as T;
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
      startWithWindows: Boolean(args?.startWithWindows),
      refreshSeconds: Number(args?.refreshSeconds),
      notchSource: typeof args?.notchSource === 'string' ? args.notchSource : snapshot.settings.notchSource,
      notificationsEnabled: typeof args?.notificationsEnabled === 'boolean' ? args.notificationsEnabled : snapshot.settings.notificationsEnabled,
    };
  } else if (command === 'connect_account') {
    throw new Error('Account sign-in is available in the Windows app. This screen uses preview data.');
  } else if (command === 'hide_notch') {
    expanded = false;
  }
  render();
  return undefined as T;
}

function smallReading(label: string, window: UsageWindow | null) {
  const value = window?.remaining;
  const width = value == null ? 0 : Math.min(100, Math.max(0, value));
  return `<span class="small-reading ${value != null && value <= 20 ? 'low' : ''}"><span class="reading-label">${label}</span><strong>${percentage(value)}</strong><span class="micro-track"><span style="width:${width}%"></span></span></span>`;
}

function limitRow(label: string, window: UsageWindow | null) {
  const value = window?.remaining;
  const width = value == null ? 0 : Math.min(100, Math.max(0, value));
  return `<div class="limit ${value != null && value <= 20 ? 'low' : ''}"><div class="limit-heading"><span>${label}</span><strong>${percentage(value)}<span class="remaining-word"> left</span></strong></div><div class="track" role="meter" aria-label="${label} remaining" ${value == null ? 'aria-valuetext="Unavailable"' : `aria-valuemin="0" aria-valuemax="100" aria-valuenow="${width}"`}><span style="width:${width}%"></span></div><div class="reset">${window ? esc(resetLabel(window.resetsAt)) : 'Limit unavailable'}</div></div>`;
}

function alertsBanner() {
  const parts: string[] = [];
  if (snapshot.update.updateAvailable && snapshot.update.latestVersion) {
    const url = esc(snapshot.update.installerUrl ?? snapshot.update.releaseUrl ?? 'https://github.com/yabswannalearn/yousage/releases/latest');
    parts.push(`<div class="suggest-banner update-banner" role="status"><div class="suggest-copy"><strong>Update available · v${esc(snapshot.update.latestVersion)}</strong><span>Download the latest Windows Setup Wizard installer.</span></div><button type="button" class="subtle-button" data-action="open-release" data-url="${url}">Download</button></div>`);
  }
  for (const alert of snapshot.alerts) {
    parts.push(`<div class="alert-banner ${alert.kind === 'reset' ? 'reset' : 'low'}" role="status"><div class="suggest-copy"><strong>${esc(alert.title)}</strong><span>${esc(alert.message)}</span></div>${iconButton('dismiss-alert', 'x', 'Dismiss alert', `data-id="${esc(alert.id)}"`)}</div>`);
  }
  const suggested = suggestedCodexSwitch(snapshot.accounts, snapshot.activeAccountId);
  if (suggested && !switchPlan && !snapshot.switching) {
    parts.push(`<div class="suggest-banner" role="status"><div class="suggest-copy"><strong>Low Codex allowance</strong><span>${esc(suggested.label)} has ${percentage(suggested.fiveHour?.remaining)} 5h · ${percentage(suggested.weekly?.remaining)} weekly left.</span></div><button type="button" class="subtle-button" data-action="prepare-switch" data-id="${esc(suggested.id)}">Switch to ${esc(suggested.label)}</button></div>`);
  }
  return parts.join('');
}

function accountCard(account: Account) {
  const active = isActiveAccount(account, snapshot.accounts, snapshot.activeAccountId);
  const inNotch = active && (!isAntigravityNotch(snapshot.settings.notchSource));
  const initial = esc((account.label || account.email || 'C').charAt(0).toUpperCase());
  const id = esc(account.id);
  const notchAction = active && !inNotch ? `<button type="button" class="text-button notch-pill" data-action="set-notch" data-source="codex">Show in notch</button>` : '';
  const controls = managing === account.id ? `<form class="manage-form" data-form="rename" data-id="${id}"><label class="field-label" for="name-${id}">Account name</label><div class="inline-input"><input id="name-${id}" name="label" value="${esc(account.label)}" maxlength="48" required autocomplete="off"/><button class="subtle-button" type="submit">Save</button></div><div class="manage-actions">${account.desktop ? '<span class="fine-print">Sign-in is managed in Codex.</span>' : `<button type="button" class="text-button" data-action="reconnect" data-id="${id}">Sign in again</button><button type="button" class="text-button danger" data-action="disconnect" data-id="${id}">${disconnectConfirmation === account.id ? 'Confirm disconnect' : 'Disconnect'}</button>`}</div></form>` : '';
  const switchButton = !active && !account.desktop ? `<button class="switch-account-button" data-action="prepare-switch" data-id="${id}" ${snapshot.switching || preparingSwitch || switchPlan || snapshot.login && !snapshot.login.error ? 'disabled' : ''}>${icon('swap')}<span>${preparingSwitch === account.id ? 'Checking Codex…' : 'Switch to this account'}</span><span aria-hidden="true">→</span></button>` : '';
  return `<article class="account-card ${active ? 'active' : ''}"><div class="account-heading"><span class="avatar">${initial}</span><div class="account-identity"><div class="account-name">${esc(account.label)}${active ? `<span class="active-badge">${inNotch ? 'Active · In notch' : 'Active'}</span>` : ''}${notchAction}</div><div class="account-email" title="${esc(account.email ?? '')}">${esc(account.email ?? 'ChatGPT account')}${account.plan ? `<span class="plan"> · ${esc(account.plan)}</span>` : ''}</div></div>${iconButton('manage', 'more', 'Manage account', `data-id="${id}" ${snapshot.switching || preparingSwitch || switchPlan ? 'disabled' : ''}`)}</div><div class="limits">${limitRow('5 hour', account.fiveHour)}${limitRow('Weekly', account.weekly)}</div><div class="account-status ${account.error ? 'attention' : ''}"><span class="status-dot"></span>${esc(freshness(account))}</div>${account.error ? `<p class="account-error">${esc(account.error)}</p>` : ''}${controls}${switchButton}</article>`;
}

function antigravityGroupCard(group: AntigravityGroup, selectedId: string | undefined) {
  const inNotch = (isAntigravityNotch(snapshot.settings.notchSource) || isBothNotch(snapshot.settings.notchSource)) && selectedId === group.id;
  const initial = esc((group.label || 'A').charAt(0).toUpperCase());
  const source = `antigravity:${esc(group.id)}`;
  const bothSource = `both:${esc(group.id)}`;
  const subtitle = group.description ?? snapshot.antigravity.email ?? 'Antigravity model group';
  return `<article class="account-card ${inNotch ? 'active' : ''}"><div class="account-heading"><span class="avatar">${initial}</span><div class="account-identity"><div class="account-name">${esc(group.label)}${inNotch ? '<span class="active-badge">In notch</span>' : `<button type="button" class="text-button notch-pill" data-action="set-notch" data-source="${source}">Show in notch</button><button type="button" class="text-button notch-pill" data-action="set-notch" data-source="${bothSource}" title="Show Codex + ${esc(group.label)} together in notch">Both in notch</button>`}</div><div class="account-email" title="${esc(subtitle)}">${esc(subtitle)}</div></div></div><div class="limits">${limitRow('5 hour', group.fiveHour)}${limitRow('Weekly', group.weekly)}</div></article>`;
}

function savedAntigravityAccountCard(acc: AntigravityAccount) {
  const id = esc(acc.id);
  const initial = esc((acc.label || acc.email || 'A').charAt(0).toUpperCase());
  const primary = acc.groups[0];
  const controls = managingAgy === acc.id ? `<form class="manage-form" data-form="rename-agy" data-id="${id}"><label class="field-label" for="agy-name-${id}">Account name</label><div class="inline-input"><input id="agy-name-${id}" name="label" value="${esc(acc.label)}" maxlength="48" required autocomplete="off"/><button class="subtle-button" type="submit">Save</button></div><div class="manage-actions"><button type="button" class="text-button danger" data-action="disconnect-agy" data-id="${id}">${disconnectAgyConfirmation === acc.id ? 'Confirm remove' : 'Remove saved account'}</button></div></form>` : '';
  return `<article class="account-card"><div class="account-heading"><span class="avatar">${initial}</span><div class="account-identity"><div class="account-name">${esc(acc.label)}<span class="active-badge">Saved AGY</span></div><div class="account-email" title="${esc(acc.email ?? '')}">${esc(acc.email ?? 'Google Antigravity account')}</div></div>${iconButton('manage-agy', 'more', 'Manage Antigravity account', `data-id="${id}"`)}</div>${primary ? `<div class="limits">${limitRow(`${primary.label} · 5h`, primary.fiveHour)}${limitRow(`${primary.label} · Wk`, primary.weekly)}</div>` : ''}<div class="account-status ${acc.error ? 'attention' : ''}"><span class="status-dot"></span>${esc(freshness(acc))}</div>${acc.error ? `<p class="account-error">${esc(acc.error)}</p>` : ''}${controls}<button class="switch-account-button" data-action="switch-agy" data-id="${id}">${icon('swap')}<span>Switch Antigravity to ${esc(acc.label)}</span><span aria-hidden="true">→</span></button></article>`;
}

function antigravitySection() {
  const { antigravity } = snapshot;
  const selected = selectedAntigravityGroup(antigravity, snapshot.settings.notchSource);
  const savedAccounts = (antigravity.accounts ?? []).filter(a => !a.active);
  const activeSaved = (antigravity.accounts ?? []).find(a => a.active && a.id !== 'active');
  const saveForm = savingAgy ? `<form class="manage-form agy-save-form" data-form="save-agy"><label class="field-label" for="agy-save-label">Save current Antigravity sign-in (${esc(antigravity.email ?? 'active')})</label><div class="inline-input"><input id="agy-save-label" name="label" value="${esc(activeSaved?.label ?? antigravity.email?.split('@')[0] ?? 'Personal')}" placeholder="Work or Personal" maxlength="48" required autocomplete="off"/><button class="subtle-button" type="submit">Save</button><button class="text-button" type="button" data-action="cancel-save-agy">Cancel</button></div></form>` : '';
  return `<section class="provider-section" aria-label="Antigravity usage"><div class="section-divider"><div><span class="eyebrow">ANTIGRAVITY</span><div class="provider-heading"><h2>Model quotas<span class="account-count">${antigravity.groups.length}</span></h2><span class="account-status provider-status ${antigravity.error ? 'attention' : ''}"><span class="status-dot"></span>${esc(freshness(antigravity))}</span></div>${antigravity.email ? `<div class="provider-email">${esc(antigravity.email)}${activeSaved ? ` · <strong>${esc(activeSaved.label)}</strong>` : ''}${!savingAgy ? ` <button type="button" class="text-button notch-pill" data-action="toggle-save-agy">${activeSaved ? 'Update saved' : 'Save sign-in'}</button>` : ''}</div>` : ''}</div></div>${saveForm}${antigravity.groups.map(group => antigravityGroupCard(group, selected?.id)).join('')}${savedAccounts.map(savedAntigravityAccountCard).join('')}${antigravity.groups.length === 0 ? `<div class="empty-state compact-empty"><h2>${snapshot.refreshing ? 'Checking Antigravity' : 'Antigravity quota'}</h2><p>${esc(antigravity.error ?? 'Sign in with Antigravity CLI (agy) to view model quotas.')}</p></div>` : antigravity.error ? `<p class="account-error">${esc(antigravity.error)}</p>` : ''}</section>`;
}

function switchPanel() {
  if (!switchPlan && !snapshot.switching) return '';
  if (snapshot.switching) return `<section class="switch-panel" role="status" aria-live="polite"><div class="switch-symbol">${icon('swap')}</div><h2>${esc(snapshot.switching)}</h2><p>The notch will update when the new account is ready.</p></section>`;
  const plan = switchPlan!;
  const current = uniqueAccounts(snapshot.accounts, snapshot.activeAccountId).find(a => isActiveAccount(a, snapshot.accounts, snapshot.activeAccountId));
  return `<section class="switch-panel" role="dialog" aria-labelledby="switch-title"><div class="section-heading"><h2 id="switch-title">Switch Codex account</h2>${iconButton('cancel-switch', 'x', 'Cancel account switch')}</div><div class="switch-route"><span>${esc(current?.label ?? 'Current sign-in')}</span>${icon('swap')}<strong>${esc(plan.label)}</strong></div><span class="switch-targets">Codex desktop + CLI</span><p>${plan.cliRunning ? 'Close your Codex terminal sessions first, then check again. Start new sessions after switching.' : plan.desktopRunning ? 'Finish any running tasks before continuing. Codex will close and reopen with this account.' : 'New Codex desktop and CLI sessions will use this account.'}</p>${plan.cliRunning ? `<button class="primary-button" data-action="prepare-switch" data-id="${esc(plan.id)}">Check again</button>` : `<button id="confirm-switch" class="primary-button" data-action="confirm-switch">${plan.desktopRunning ? 'Restart Codex and switch' : 'Switch desktop and CLI'}<span aria-hidden="true">→</span></button>`}<p class="switch-footnote">Your current account stays connected in YouSage.</p></section>`;
}

function settingsPanel() {
  const { antigravity, settings, update } = snapshot;
  const activeGroup = selectedAntigravityGroup(antigravity, settings.notchSource);
  const currentSource = isBothNotch(settings.notchSource)
    ? (activeGroup ? `both:${activeGroup.id}` : 'both')
    : isAntigravityNotch(settings.notchSource)
      ? (activeGroup ? `antigravity:${activeGroup.id}` : 'antigravity')
      : 'codex';
  const bothOptions = antigravity.groups.length
    ? antigravity.groups.map(group => `<option value="both:${esc(group.id)}" ${currentSource === `both:${group.id}` ? 'selected' : ''}>Both · Codex + ${esc(group.label)}</option>`).join('')
    : `<option value="both" ${currentSource === 'both' ? 'selected' : ''}>Both · Codex + Antigravity</option>`;
  const antigravityOptions = antigravity.groups.length
    ? antigravity.groups.map(group => `<option value="antigravity:${esc(group.id)}" ${currentSource === `antigravity:${group.id}` ? 'selected' : ''}>Antigravity · ${esc(group.label)}</option>`).join('')
    : `<option value="antigravity" ${currentSource === 'antigravity' ? 'selected' : ''}>Antigravity</option>`;
  const updateUrl = esc(update.installerUrl ?? update.releaseUrl ?? 'https://github.com/yabswannalearn/yousage/releases/latest');
  const updateStatusText = update.checking
    ? 'Checking GitHub Releases…'
    : update.error
      ? update.error
      : update.updateAvailable && update.latestVersion
        ? `Update v${update.latestVersion} available`
        : `Up to date (v${update.currentVersion})`;
  return `<section class="settings-panel" aria-label="Settings"><div class="settings-heading"><h2>Settings</h2><span class="fine-print">v${esc(update.currentVersion)} · Alt+Shift+U</span></div><label class="setting-row" for="notch-source"><span>Notch preview</span><select id="notch-source"><option value="codex" ${currentSource === 'codex' ? 'selected' : ''}>Codex (active account)</option>${bothOptions}${antigravityOptions}</select></label><label class="setting-row" for="notifications"><span>Low-allowance & reset alerts</span><input class="switch" id="notifications" type="checkbox" ${settings.notificationsEnabled ? 'checked' : ''}/></label><label class="setting-row" for="startup"><span>Start with Windows</span><input class="switch" id="startup" type="checkbox" ${settings.startWithWindows ? 'checked' : ''}/></label><label class="setting-row" for="refresh-interval"><span>Refresh usage every</span><select id="refresh-interval">${[[30, '30 seconds'], [60, '1 minute'], [120, '2 minutes'], [300, '5 minutes'], [600, '10 minutes']].map(([value, label]) => `<option value="${value}" ${settings.refreshSeconds === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><div class="setting-row update-row"><span>${esc(updateStatusText)}</span>${update.updateAvailable ? `<button type="button" class="subtle-button" data-action="open-release" data-url="${updateUrl}">Install v${esc(update.latestVersion ?? '')}</button>` : `<button type="button" class="subtle-button" data-action="check-updates" ${update.checking ? 'disabled' : ''}>Check updates</button>`}</div><p class="fine-print">Press Alt+Shift+U anywhere to show or toggle the notch.</p></section>`;
}

function addPanel() {
  const signingIn = snapshot.login && !snapshot.login.error;
  if (signingIn) return `<section class="add-panel"><div class="connection-symbol">${icon('plus')}</div><h2>${esc(snapshot.login!.status)}</h2><p>Your current Codex sign-in stays connected.</p><button class="subtle-button" data-action="cancel-login">Cancel sign-in</button></section>`;
  if (!adding) return '';
  return `<section class="add-panel"><div class="section-heading"><h2>Connect an account</h2>${iconButton('cancel-add', 'x', 'Cancel')}</div><form data-form="connect"><label class="field-label" for="account-label">Account name</label><input id="account-label" name="label" placeholder="Work or Personal" maxlength="48" autocomplete="off" required/><p>Sign in with ChatGPT in your browser. You only need to do this once per account.</p><button class="primary-button" type="submit">Continue in browser <span aria-hidden="true">↗</span></button></form></section>`;
}

function render() {
  const focused = document.activeElement instanceof HTMLElement && root.contains(document.activeElement) ? document.activeElement : null;
  const focusTarget = focused ? { id: focused.id, action: focused.dataset.action, accountId: focused.dataset.id, restore: document.hasFocus() } : null;
  const preserved = focused instanceof HTMLInputElement && focused.type !== 'checkbox' ? { id: focused.id, value: focused.value, start: focused.selectionStart, end: focused.selectionEnd } : null;
  const scrollTop = root.querySelector('.panel-scroll')?.scrollTop ?? 0;
  const accounts = uniqueAccounts(snapshot.accounts, snapshot.activeAccountId);
  const desktop = snapshot.accounts.find(account => account.id === snapshot.activeAccountId);
  const active = accounts.find(account => account.id === snapshot.activeAccountId || (account.identity && account.identity === desktop?.identity));
  const useBoth = isBothNotch(snapshot.settings.notchSource);
  const useAntigravity = isAntigravityNotch(snapshot.settings.notchSource);
  const notchGroup = selectedAntigravityGroup(snapshot.antigravity, snapshot.settings.notchSource);
  const title = snapshot.switching
    ? 'Switching account…'
    : useBoth
      ? `${active?.label ?? 'Codex'} + AGY`
      : useAntigravity
        ? (notchGroup?.label ?? (snapshot.refreshing ? 'Checking Antigravity' : 'Antigravity'))
        : (active?.label ?? (snapshot.refreshing ? 'Checking Codex' : 'No active account'));
  const subtitle = preview
    ? 'Preview data'
    : useBoth
      ? (notchGroup?.label ?? 'Codex & Antigravity')
      : useAntigravity
        ? (snapshot.antigravity.error ? 'Last known usage' : 'Antigravity remaining')
        : (active?.error ? 'Last known usage' : 'Codex remaining');
  const readingsHtml = useBoth
    ? `${smallReading('C·5h', active?.fiveHour ?? null)}${smallReading('A·5h', notchGroup?.fiveHour ?? notchGroup?.weekly ?? null)}`
    : useAntigravity
      ? `${smallReading('5h', notchGroup?.fiveHour ?? null)}${smallReading('Week', notchGroup?.weekly ?? null)}`
      : `${smallReading('5h', active?.fiveHour ?? null)}${smallReading('Week', active?.weekly ?? null)}`;
  const notchTooltip = useAntigravity
    ? (snapshot.antigravity.error ?? 'Click to expand · drag to move · Alt+Shift+U')
    : (active?.error ?? snapshot.desktopError ?? 'Click to expand · drag to move · Alt+Shift+U');
  root.className = `${expanded ? 'expanded' : ''} ${upward ? 'upward' : ''} ${transition ? 'transitioning' : ''}`;
  root.innerHTML = `<div class="shell"><button id="notch-toggle" class="compact" data-action="toggle" aria-expanded="${expanded}" aria-controls="detail-panel" title="${esc(notchTooltip)}"><span class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></span><span class="compact-identity"><span class="compact-title">${esc(title)}</span><span class="compact-subtitle">${esc(subtitle)}</span></span><span class="compact-readings">${readingsHtml}</span><span class="expand-icon">${icon('chevron')}</span></button>${expanded ? `<section id="detail-panel" class="details" aria-label="Usage remaining"><div class="panel-scroll"><header class="panel-heading"><div><span class="eyebrow">${preview ? 'PREVIEW DATA' : 'CODEX'}</span><h1>Connected accounts<span class="account-count">${accounts.length}</span></h1></div>${iconButton('refresh', 'refresh', snapshot.refreshing ? 'Refreshing usage' : 'Refresh usage', snapshot.refreshing || snapshot.switching ? 'disabled' : '')}</header>${error || snapshot.login?.error ? `<div class="error-banner" role="alert">${esc(error || snapshot.login!.error!)}${iconButton('clear-error', 'x', 'Dismiss error')}</div>` : ''}${notice ? `<div class="success-banner" role="status">${esc(notice)}</div>` : ''}${alertsBanner()}${switchPanel()}${accounts.map(accountCard).join('')}${accounts.length === 0 ? `<div class="empty-state"><div class="empty-symbol">${icon('plus')}</div><h2>${snapshot.refreshing ? 'Checking your Codex account' : 'Your accounts, in one place'}</h2><p>${esc(snapshot.desktopError ?? 'Sign in to the Codex desktop app, or connect a ChatGPT account below.')}</p></div>` : ''}${!active && snapshot.desktopError && accounts.length ? `<p class="desktop-note">${esc(snapshot.desktopError)}</p>` : ''}${addPanel()}${antigravitySection()}${settingsOpen ? settingsPanel() : ''}<div class="privacy-note">Stored on this computer. Credentials stay in Windows.</div></div><footer class="panel-footer"><button class="add-button" type="button" data-action="add" ${snapshot.switching || preparingSwitch || switchPlan || snapshot.login && !snapshot.login.error ? 'disabled' : ''}>${icon('plus')}<span>Add account</span></button><div class="footer-tools">${iconButton('settings', 'settings', 'Settings', `aria-pressed="${settingsOpen}"`)}${iconButton('hide', 'hide', 'Hide to system tray')}</div></footer></section>` : ''}</div>`;
  const scroll = root.querySelector('.panel-scroll');
  if (scroll) scroll.scrollTop = scrollTop;
  if (preserved) {
    const input = document.getElementById(preserved.id);
    if (input instanceof HTMLInputElement && input.type !== 'checkbox') {
      input.value = preserved.value;
      if (preserved.start != null) input.setSelectionRange(preserved.start, preserved.end);
    }
  }
  if (focusTarget?.restore) {
    const target = focusTarget.id ? document.getElementById(focusTarget.id) : Array.from(root.querySelectorAll<HTMLElement>('[data-action]')).find(element => element.dataset.action === focusTarget.action && element.dataset.id === focusTarget.accountId);
    target?.focus({ preventScroll: true });
  }
  if (expanded) void syncHeight();
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
    const layout = await call<{ upward: boolean; height: number }>('set_expanded', { expanded: true, height });
    if (!expanded) return;
    upward = layout.upward;
    root.classList.toggle('upward', upward);
    if (preview) root.style.height = `${layout.height}px`;
  } catch (err) { error = String(err); }
}

async function toggle(open = !expanded) {
  if (transition || open === expanded) return;
  transition = true;
  if (open) {
    expanded = true; desiredHeight = 0; render();
    await new Promise(resolve => setTimeout(resolve, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180));
  } else {
    root.classList.add('closing');
    await new Promise(resolve => setTimeout(resolve, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 150));
    expanded = false; settingsOpen = false; adding = false; savingAgy = false; managing = null; managingAgy = null; disconnectConfirmation = null; disconnectAgyConfirmation = null; switchPlan = null; desiredHeight = 0;
    await call('set_expanded', { expanded: false, height: 80 });
    if (preview) root.style.height = '80px';
  }
  transition = false;
  render();
}

async function attempt(action: () => Promise<unknown>) {
  error = '';
  try { await action(); } catch (err) { error = err instanceof Error ? err.message : String(err); }
  render();
}

async function prepareSwitch(id: string) {
  if (snapshot.switching || preparingSwitch) return;
  preparingSwitch = id; switchPlan = null; notice = ''; error = ''; render();
  try {
    const plan = await call<SwitchPlan>('prepare_switch', { id });
    if (expanded) { switchPlan = plan; adding = false; managing = null; }
  } finally { preparingSwitch = null; render(); }
  const scroll = root.querySelector('.panel-scroll');
  if (scroll) scroll.scrollTop = 0;
  document.getElementById('confirm-switch')?.focus({ preventScroll: true });
}

async function confirmSwitch() {
  const plan = switchPlan;
  if (!plan || plan.cliRunning || snapshot.switching) return;
  switchPlan = null; snapshot.switching = 'Preparing the account switch…'; notice = ''; render();
  try {
    await call('switch_account', { id: plan.id, restartDesktop: plan.desktopRunning });
    notice = `Now using ${plan.label} in Codex desktop and new CLI sessions.`;
  } finally { snapshot.switching = null; render(); }
}

root.addEventListener('click', event => {
  const target = (event.target as Element).closest<HTMLElement>('[data-action]');
  if (!target || (target instanceof HTMLButtonElement && target.disabled)) return;
  const id = target.dataset.id;
  switch (target.dataset.action) {
    case 'toggle': if (Date.now() >= ignoreClickUntil) void attempt(() => toggle()); break;
    case 'refresh': void attempt(() => call('refresh_usage')); break;
    case 'hide': void attempt(async () => { await call('hide_notch'); expanded = false; if (preview) root.style.height = '80px'; }); break;
    case 'settings': settingsOpen = !settingsOpen; render(); break;
    case 'add': adding = true; error = ''; render(); document.getElementById('account-label')?.focus(); break;
    case 'cancel-add': adding = false; render(); break;
    case 'cancel-login': void attempt(() => call('cancel_sign_in')); break;
    case 'manage': managing = managing === id ? null : id!; disconnectConfirmation = null; render(); break;
    case 'manage-agy': managingAgy = managingAgy === id ? null : id!; disconnectAgyConfirmation = null; render(); break;
    case 'toggle-save-agy': savingAgy = !savingAgy; render(); document.getElementById('agy-save-label')?.focus(); break;
    case 'cancel-save-agy': savingAgy = false; render(); break;
    case 'switch-agy':
      if (id) void attempt(async () => {
        await call('switch_antigravity_account', { id });
        notice = 'Switched active Antigravity sign-in.';
      });
      break;
    case 'disconnect-agy':
      if (disconnectAgyConfirmation !== id) { disconnectAgyConfirmation = id!; render(); }
      else void attempt(async () => { await call('disconnect_antigravity_account', { id }); managingAgy = null; disconnectAgyConfirmation = null; });
      break;
    case 'dismiss-alert': if (id) void attempt(() => call('dismiss_alert', { id })); break;
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
      if (source) void attempt(() => call('update_settings', {
        startWithWindows: snapshot.settings.startWithWindows,
        refreshSeconds: snapshot.settings.refreshSeconds,
        notchSource: source,
        notificationsEnabled: snapshot.settings.notificationsEnabled,
      }));
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

root.addEventListener('change', event => {
  const input = event.target as HTMLInputElement;
  if (!['startup', 'refresh-interval', 'notch-source', 'notifications'].includes(input.id)) return;
  const start = root.querySelector<HTMLInputElement>('#startup')!.checked;
  const notificationsEnabled = root.querySelector<HTMLInputElement>('#notifications')?.checked ?? snapshot.settings.notificationsEnabled;
  const seconds = Number(root.querySelector<HTMLSelectElement>('#refresh-interval')!.value);
  const notchSource = root.querySelector<HTMLSelectElement>('#notch-source')?.value ?? snapshot.settings.notchSource;
  void attempt(() => call('update_settings', { startWithWindows: start, refreshSeconds: seconds, notchSource, notificationsEnabled }));
});

root.addEventListener('pointerdown', event => {
  if (event.button !== 0 || !(event.target as Element).closest('#notch-toggle') || !native) return;
  const origin = { x: event.screenX, y: event.screenY };
  const cleanup = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', cleanup); };
  const move = (next: PointerEvent) => {
    if (Math.hypot(next.screenX - origin.x, next.screenY - origin.y) < 5) return;
    cleanup(); ignoreClickUntil = Date.now() + 600;
    void getCurrentWindow().startDragging().catch(err => { error = String(err); render(); });
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', cleanup, { once: true });
});

window.addEventListener('keydown', event => {
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
      antigravity: {
        email: 'developer@example.com',
        updatedAt: now,
        error: null,
        accounts: [],
        groups: [
          { id: 'gemini-models', label: 'Gemini Models', description: 'Models within this group: Gemini Flash, Gemini Pro', fiveHour: { remaining: 100, resetsAt: now + 14400 }, weekly: { remaining: 100, resetsAt: now + 518400 } },
          { id: 'claude-and-gpt-models', label: 'Claude and GPT models', description: 'Models within this group: Claude Opus, Claude Sonnet, GPT-OSS', fiveHour: { remaining: 97, resetsAt: now + 5760 }, weekly: { remaining: 83, resetsAt: now + 496800 } },
          { id: 'gemini-4-argon', label: 'Gemini 4 Argon', description: 'Separate weekly quota for paid Pro plans', fiveHour: null, weekly: { remaining: 90, resetsAt: now + 597600 } },
        ],
      },
    };
    render();
    if (params.has('expanded')) await toggle(true);
    return;
  }
  if (!native) {
    root.innerHTML = '<div class="browser-message"><h1>YouSage</h1><p>Open the Windows desktop app to view your Codex and Antigravity usage.</p><a href="?preview=1&expanded=1">Open the interface preview</a></div>';
    document.documentElement.classList.add('browser-preview');
    return;
  }
  await listen<Snapshot>('usage-updated', event => { snapshot = event.payload; render(); });
  await listen<Alert>('usage-alert', event => { notifyDesktop(event.payload); });
  await listen('hotkey-toggle', () => { if (!transition) void toggle(); });
  await listen('collapse-requested', () => { if (expanded && !transition) void toggle(false); });
  await listen('panel-collapsed', () => { expanded = false; transition = false; switchPlan = null; desiredHeight = 0; render(); });
  snapshot = await call<Snapshot>('get_snapshot');
  render();
}

void start().catch(err => { error = String(err); expanded = true; render(); });
