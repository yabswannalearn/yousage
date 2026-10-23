// Run against `npm run dev`: node tests/desktop-ui.mjs
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 344, height: 720 } });
page.setDefaultTimeout(5000);
const failures = [];
page.on('pageerror', error => failures.push(error.message));
await page.addInitScript(() => {
  const now = Math.floor(Date.now() / 1000);
  const allowance = { remaining: 75, resetsAt: now + 7200 };
  const snapshot = {
    accounts: [{ id: 'desktop', label: 'Personal', email: 'demo@example.com', plan: 'plus', identity: 'demo', desktop: true, fiveHour: allowance, weekly: allowance, updatedAt: now, error: null }],
    activeAccountId: 'desktop',
    antigravity: { email: 'demo@example.com', accounts: [], groups: [{ id: 'gemini', label: 'Gemini Models', description: null, fiveHour: allowance, weekly: allowance }], updatedAt: now, error: null },
    claude: { email: 'demo@example.com', plan: 'max', fiveHour: allowance, weekly: allowance, updatedAt: now, error: null },
    alerts: [], update: { currentVersion: '0.1.0', updateAvailable: false }, refreshing: false, desktopError: null, login: null, switching: null,
    settings: { startWithWindows: true, refreshSeconds: 60, notchSource: 'both:gemini', notificationsEnabled: true, providerColors: { codex: '#b7c8b1', antigravity: '#8ab4d8', claude: '#d99a7c' }, hiddenProviders: [] },
  };
  const callbacks = new Map();
  const events = new Map();
  window.isTauri = true;
  window.testBridge = {
    dragging: false,
    calls: [],
    snapshot,
    emit(event, payload = null) { callbacks.get(events.get(event))?.({ event, payload: structuredClone(payload) }); },
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' } },
    transformCallback(fn) { const id = callbacks.size; callbacks.set(id, fn); return id; },
    async invoke(command, args) {
      window.testBridge.calls.push({ command, args });
      if (command === 'plugin:event|listen') { events.set(args.event, args.handler); return args.handler; }
      if (command === 'get_snapshot') return structuredClone(snapshot);
      if (command === 'prepare_switch' || command === 'prepare_antigravity_switch') {
        const antigravity = command === 'prepare_antigravity_switch';
        if (window.testBridge.noSessions) return { id: args.id, label: 'Work', provider: 'codex', desktopRunning: false, cliRunning: false, processNames: [] };
        return { id: args.id, label: antigravity ? 'AGY Work' : 'Work', provider: antigravity ? 'antigravity' : 'codex', desktopRunning: !antigravity, cliRunning: true, processNames: antigravity ? ['agy.exe', 'pwsh.exe'] : ['ChatGPT.exe', 'Codex.exe', 'pwsh.exe'] };
      }
      if (command === 'set_expanded') {
        if (args.expanded && window.testBridge.delayResize) await new Promise(resolve => { window.testBridge.releaseResize = resolve; });
        if (window.testBridge.dragging) await new Promise(resolve => { window.testBridge.finishResize = resolve; });
        document.getElementById('app').style.height = `${args.expanded ? args.height : 80}px`;
        return { upward: false, height: args.expanded ? args.height : 80 };
      }
      if (command === 'plugin:window|start_dragging' || command === 'start_notch_drag') { window.testBridge.dragging = true; }
      if (command === 'update_settings') {
        const { usagePreferences, ...settings } = args;
        Object.assign(snapshot.settings, settings);
        window.testBridge.emit('usage-updated', snapshot);
      }
      if (command === 'update_usage_preferences') {
        if (window.testBridge.delayPreferenceSave) await new Promise(resolve => { window.testBridge.releasePreferenceSave = resolve; });
        snapshot.settings.usagePreferences = args.preferences;
        window.testBridge.emit('usage-updated', snapshot);
      }
    },
  };
});
try {
  await page.goto('http://127.0.0.1:1420');
  await page.evaluate(() => { window.testBridge.delayResize = true; });
  await page.locator('#notch-toggle').click();
  await page.waitForFunction(() => window.testBridge.releaseResize);
  assert.equal(await page.locator('.details').evaluate(el => getComputedStyle(el).visibility), 'hidden', 'details must stay concealed while native resize is pending');
  await page.evaluate(() => { window.testBridge.delayResize = false; window.testBridge.releaseResize(); });
  await page.waitForFunction(() => document.getElementById('app').classList.contains('opening'));
  await page.evaluate(() => {
    window.testBridge.motionShell = document.querySelector('.shell');
    window.testBridge.emit('usage-updated', window.testBridge.snapshot);
  });
  assert.equal(await page.evaluate(() => window.testBridge.motionShell === document.querySelector('.shell')), true, 'usage updates must not restart the active animation');
  await page.waitForTimeout(470);
  const header = page.locator('#notch-toggle');
  const rect = await header.boundingBox();
  await page.mouse.move(rect.x + 70, rect.y + 20);
  await page.mouse.down();
  await page.mouse.move(rect.x + 100, rect.y + 20, { steps: 4 });
  await page.waitForTimeout(750);
  // Windows can report a focus change while its native move loop owns the mouse.
  await page.evaluate(() => window.testBridge.emit('collapse-requested'));
  await page.waitForTimeout(200);
  assert.equal(await page.locator('#app').evaluate(el => el.classList.contains('closing')), false, 'expanded panel must stay visible while dragging');
  await page.mouse.up();
  await page.evaluate(() => {
    window.testBridge.dragging = false;
    window.testBridge.finishResize?.();
    window.testBridge.emit('notch-drag-finished');
    document.getElementById('notch-toggle').click();
  });
  await page.waitForTimeout(200);
  assert.equal(await header.getAttribute('aria-expanded'), 'true', 'a long drag release must not collapse the panel');
  await header.click();
  await page.waitForTimeout(320);
  assert.equal(await header.getAttribute('aria-expanded'), 'false', 'the next intentional click must still collapse');
  await header.click();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('App background', { exact: true }).fill('#e9e4ff');
  await page.getByLabel('UI accent', { exact: true }).fill('#8b45ce');
  assert.equal(await page.locator('.shell').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(233, 228, 255)');
  assert.equal(await page.locator('#notifications').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(139, 69, 206)');
  const mark = page.locator('.brand-mark img');
  assert.equal(await mark.getAttribute('draggable'), 'false');
  const markSvg = await page.evaluate(async src => (await fetch(src)).text(), await mark.getAttribute('src'));
  assert.match(markSvg, /fill=['"]#9DD9F3['"]/, 'the supplied donut mark keeps its light blue color independently of app accent');
  assert.equal(await page.locator('.compact .small-reading').first().evaluate(el => getComputedStyle(el).getPropertyValue('--sage').trim()), '#b7c8b1', 'app theme must preserve subscription colors');
  if (process.env.YOUSAGE_UI_SCREENSHOT) await page.screenshot({ path: process.env.YOUSAGE_UI_SCREENSHOT.replace(/\.png$/, '-light.png') });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  assert.equal(await page.getByLabel('App background', { exact: true }).inputValue(), '#e9e4ff');
  const previewInput = page.getByLabel('App background', { exact: true });
  await previewInput.evaluate(el => { el.value = '#24354b'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.equal(await page.locator('.shell').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(36, 53, 75)', 'color changes must preview before saving');
  await page.getByRole('button', { name: 'Reset colors', exact: true }).click();
  assert.equal(await page.locator('.shell').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(32, 34, 33)');
  const picker = page.getByLabel('Codex color', { exact: true });
  await picker.dispatchEvent('pointerdown');
  await page.evaluate(() => window.testBridge.emit('collapse-requested'));
  assert.equal(await page.locator('#app').evaluate(el => el.classList.contains('closing')), false, 'the native color picker must not collapse the panel');
  await page.evaluate(() => window.testBridge.emit('notch-focused'));
  await picker.fill('#ff66aa');
  const colors = await page.locator('.compact .small-reading').evaluateAll(els => els.map(el => getComputedStyle(el).getPropertyValue('--sage').trim()));
  assert.deepEqual(colors, ['#ff66aa', '#8ab4d8'], 'dual preview must retain separate provider colors');
  await page.locator('#notch-source').selectOption('claude');
  assert.match(await page.locator('.compact-title').innerText(), /Claude/);
  assert.equal(await page.locator('.compact .small-reading').count(), 2);
  assert.equal(await page.locator('section[aria-label="Claude usage"] .usage-ring').count(), 2);
  await page.getByRole('checkbox', { name: 'Claude', exact: true }).uncheck();
  assert.equal(await page.locator('section[aria-label="Claude usage"]').count(), 0);
  assert.match(await page.locator('.compact-title').innerText(), /Personal/);
  await page.getByRole('checkbox', { name: 'Codex', exact: true }).uncheck();
  assert.equal(await page.locator('.panel-heading').count(), 0);
  assert.equal(await page.locator('[data-action="add"]').count(), 0);
  assert.match(await page.locator('.compact-title').innerText(), /Gemini/);
  await page.getByRole('checkbox', { name: 'Antigravity', exact: true }).uncheck();
  assert.equal(await page.locator('.compact .small-reading').count(), 0);
  assert.equal(await page.locator('#show-claude').count(), 1, 'settings must stay usable when all subscriptions are hidden');
  await page.locator('#refresh-interval').selectOption('120');
  const saved = await page.evaluate(() => window.testBridge.calls.filter(call => call.command === 'update_settings').at(-1).args);
  assert.equal(saved.notchSource, 'claude', 'unrelated settings must preserve the preferred preview while it is hidden');
  await page.getByRole('checkbox', { name: 'Codex', exact: true }).check();
  assert.equal(await page.locator('#color-codex').inputValue(), '#ff66aa', 'hiding must preserve colors');
  await page.getByRole('checkbox', { name: 'Claude', exact: true }).check();
  assert.match(await page.locator('.compact-title').innerText(), /Claude/, 'restoring the chosen source must restore its preview');
  const settingsSize = await page.locator('.settings-panel').evaluate(el => ({ width: el.clientWidth, content: el.scrollWidth }));
  assert.ok(settingsSize.content <= settingsSize.width, 'Settings must fit within the pill width');
  await page.getByRole('button', { name: 'Send test notification', exact: true }).click();
  assert.equal(await page.evaluate(() => window.testBridge.calls.filter(call => call.command === 'test_notification').length), 1);
  await page.getByRole('checkbox', { name: 'Windows notifications', exact: true }).uncheck();
  assert.equal(await page.getByRole('button', { name: 'Send test notification', exact: true }).isDisabled(), true);
  await page.getByRole('checkbox', { name: 'Windows notifications', exact: true }).check();
  if (process.env.YOUSAGE_UI_SCREENSHOT) {
    await page.locator('.settings-panel').scrollIntoViewIfNeeded();
    await page.locator('.panel-scroll').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await page.screenshot({ path: process.env.YOUSAGE_UI_SCREENSHOT });
  }
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('.panel-scroll').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.evaluate(() => {
    const snapshot = window.testBridge.snapshot;
    snapshot.accounts.push({ ...snapshot.accounts[0], id: 'work', label: 'Work', identity: 'work', desktop: false });
    snapshot.antigravity.accounts = [{ id: 'agy-work', label: 'AGY Work', email: 'agy-work@example.com', groups: snapshot.antigravity.groups, updatedAt: Date.now() / 1000, error: null, active: false }];
    window.testBridge.emit('usage-updated', snapshot);
  });
  await page.locator('[data-action="prepare-switch"][data-id="work"]').click();
  assert.match(await page.getByRole('dialog').innerText(), /unsaved work may be lost/);
  assert.match(await page.getByRole('dialog').innerText(), /ChatGPT.exe, Codex.exe, pwsh.exe/);
  assert.equal(await page.getByRole('button', { name: 'Close sessions and switch' }).isEnabled(), true, 'CLI sessions must allow confirmed force-close');
  await page.getByRole('button', { name: 'Cancel account switch' }).click();
  assert.equal(await page.evaluate(() => window.testBridge.calls.filter(call => call.command === 'switch_account').length), 0, 'cancel must not switch');
  await page.locator('[data-action="prepare-switch"][data-id="work"]').click();
  await page.getByRole('button', { name: 'Close sessions and switch' }).click();
  assert.deepEqual(await page.evaluate(() => window.testBridge.calls.find(call => call.command === 'switch_account').args), { id: 'work', restartDesktop: true });
  await page.evaluate(() => { window.testBridge.noSessions = true; });
  await page.locator('[data-action="prepare-switch"][data-id="work"]').click();
  await page.getByRole('button', { name: 'Switch account', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.testBridge.calls.filter(call => call.command === 'switch_account').at(-1).args), { id: 'work', restartDesktop: false }, 'an empty plan must not authorize closing sessions that appear later');
  await page.evaluate(() => { window.testBridge.noSessions = false; });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Antigravity', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Codex', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('[data-action="switch-agy"][data-id="agy-work"]').click();
  assert.match(await page.getByRole('dialog').innerText(), /Switch Antigravity account/);
  assert.match(await page.getByRole('dialog').innerText(), /agy.exe, pwsh.exe/);
  assert.equal(await page.evaluate(() => window.testBridge.calls.filter(call => call.command === 'switch_antigravity_account').length), 0, 'Antigravity must wait for confirmation');
  await page.getByRole('button', { name: 'Close sessions and switch' }).click();
  assert.deepEqual(await page.evaluate(() => window.testBridge.calls.find(call => call.command === 'switch_antigravity_account').args), { id: 'agy-work', restartDesktop: true });
  await page.evaluate(() => {
    const snapshot = window.testBridge.snapshot;
    const now = Date.now() / 1000;
    snapshot.settings.hiddenProviders = [];
    snapshot.accounts[0].fiveHour.remaining = 18;
    snapshot.accounts[1].fiveHour = { remaining: 85, resetsAt: now + 7200 };
    snapshot.accounts[1].weekly = { remaining: 80, resetsAt: now + 72000 };
    snapshot.antigravity.groups[0].fiveHour = { remaining: 12, resetsAt: now + 7200 };
    snapshot.antigravity.accounts[0].groups = [{ ...snapshot.antigravity.groups[0], fiveHour: { remaining: 88, resetsAt: now + 7200 }, weekly: { remaining: 80, resetsAt: now + 72000 } }];
    snapshot.antigravity.groups.push({ id: 'weekly-only', label: 'Weekly model', description: null, fiveHour: null, weekly: { remaining: 42, resetsAt: now + 72000 } });
    snapshot.health = {
      codex: { status: 'signInRequired', message: 'Sign in again to reconnect Codex.', lastSuccessAt: now - 720, nextRetryAt: null, recoveryCommand: 'codex login' },
      antigravity: { status: 'ready', message: 'Antigravity is connected.', lastSuccessAt: now, nextRetryAt: now + 60, recoveryCommand: null },
      claude: { status: 'rateLimited', message: 'Claude requested a pause before retrying.', lastSuccessAt: now - 120, nextRetryAt: now + 120, recoveryCommand: null },
    };
    window.testBridge.emit('usage-updated', snapshot);
  });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('#notch-source').selectOption('both:weekly-only');
  assert.deepEqual(await page.locator('.compact .reading-label').allTextContents(), ['C·5h', 'A·Week'], 'weekly-only AGY fallback must identify its actual window');
  await page.locator('#preview-claude').check();
  assert.equal(await page.locator('.compact .small-reading').count(), 3, 'all three providers can share the notch');
  await page.locator('#notch-window').selectOption('weekly');
  assert.deepEqual(await page.locator('.compact .reading-label').allTextContents(), ['C·Week', 'A·Week', 'Cl·Week']);
  await page.locator('#show-claude').uncheck();
  assert.equal(await page.locator('.compact .small-reading').count(), 2);
  assert.equal(await page.locator('#preview-claude').isChecked(), true, 'hiding preserves custom provider choices');
  await page.locator('#show-claude').check();
  assert.equal(await page.locator('.compact .small-reading').count(), 3);
  await page.locator('#notch-group').selectOption('gemini');
  await page.locator('#notch-window').selectOption('limiting');
  await page.locator('#warning-codex').fill('35');
  await page.locator('#warning-codex').dispatchEvent('change');
  await page.locator('#critical-codex').fill('15');
  await page.locator('#critical-codex').dispatchEvent('change');
  await page.locator('#alert-lowEnabled').uncheck();
  await page.locator('#alert-resetEnabled').uncheck();
  await page.locator('#alert-quietHoursEnabled').check();
  await page.locator('#quiet-start').fill('21:30');
  await page.locator('#quiet-end').fill('07:45');
  await page.getByRole('button', { name: 'Snooze 1 hour', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Resume alerts', exact: true }).count(), 1);
  await page.getByRole('button', { name: 'Resume alerts', exact: true }).click();
  const alertPrefs = await page.evaluate(() => window.testBridge.snapshot.settings.usagePreferences.alertRules);
  assert.deepEqual(alertPrefs.codex, { warningPercent: 35, criticalPercent: 15 });
  assert.equal(alertPrefs.lowEnabled, false);
  assert.equal(alertPrefs.resetEnabled, false);
  assert.equal(alertPrefs.quietStart, '21:30');
  assert.equal(alertPrefs.quietEnd, '07:45');
  assert.equal(alertPrefs.snoozedUntil, null);
  const savesBefore = await page.evaluate(() => window.testBridge.calls.filter(call => call.command === 'update_usage_preferences').length);
  await page.locator('#critical-codex').fill('40');
  await page.locator('#critical-codex').dispatchEvent('change');
  assert.equal(await page.evaluate(() => window.testBridge.calls.filter(call => call.command === 'update_usage_preferences').length), savesBefore, 'invalid thresholds must not persist');
  assert.match(await page.locator('.error-banner').innerText(), /critical lower than warning/);
  await page.getByRole('button', { name: 'Dismiss error', exact: true }).click();
  await page.locator('#warning-codex').focus();
  await page.locator('#warning-codex').fill('36');
  await page.evaluate(() => window.testBridge.emit('usage-updated', window.testBridge.snapshot));
  assert.equal(await page.locator('#warning-codex').inputValue(), '36', 'background updates must preserve an in-progress threshold edit');
  assert.equal(await page.locator('#warning-codex').evaluate(el => el === document.activeElement), true);
  await page.locator('#warning-codex').dispatchEvent('change');
  assert.match(await page.locator('.health-card').first().innerText(), /Last checked 12m/);
  assert.equal(await page.locator('[data-action="refresh-health"][data-provider="claude"]').isDisabled(), true, 'Claude retry cooldown must be respected');
  assert.equal(await page.locator('[data-action="refresh-health"][data-provider="antigravity"]').isEnabled(), true, 'scheduled polling must not prevent manual CLI refresh');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Copy sign-in command', exact: true }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'codex login');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  assert.equal(await page.locator('#notch-window').inputValue(), 'limiting');
  assert.equal(await page.locator('#warning-codex').inputValue(), '36', 'saved alert thresholds must survive reopening Settings');
  assert.equal(await page.locator('#quiet-start').inputValue(), '21:30');
  assert.equal(await page.locator('#quiet-end').inputValue(), '07:45');
  await page.locator('#recommendation-purpose').selectOption('work');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('[data-action="manage"][data-id="work"]').click();
  await page.locator('[data-account-purpose="codex:work"]').selectOption('work');
  assert.equal(await page.locator('[data-recommendation="codex"]').count(), 1);
  await page.locator('[data-account-suggestions="codex:work"]').uncheck();
  assert.equal(await page.locator('[data-recommendation="codex"]').count(), 0, 'excluded accounts must not be suggested');
  await page.locator('[data-account-suggestions="codex:work"]').check();
  await page.locator('[data-recommendation="codex"] button').click();
  assert.match(await page.getByRole('dialog').innerText(), /Switch Codex account/);
  await page.getByRole('button', { name: 'Cancel account switch' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('#recommendation-purpose').selectOption('personal');
  assert.equal(await page.locator('[data-recommendation="codex"]').count(), 0, 'purpose filtering must use saved account preferences');
  await page.locator('#recommendation-purpose').selectOption('any');
  assert.equal(await page.locator('[data-recommendation="antigravity"]').count(), 1);
  await page.locator('[data-recommendation="antigravity"] button').click();
  assert.match(await page.getByRole('dialog').innerText(), /Switch Antigravity account/);
  await page.getByRole('button', { name: 'Cancel account switch' }).click();
  await page.locator('[data-action="manage-agy"][data-id="agy-work"]').click();
  await page.locator('[data-account-purpose="antigravity:agy-work"]').selectOption('personal');
  await page.locator('[data-account-suggestions="antigravity:agy-work"]').uncheck();
  assert.equal(await page.locator('[data-recommendation="antigravity"]').count(), 0);
  const latestPreferences = await page.evaluate(() => window.testBridge.snapshot.settings.usagePreferences);
  assert.deepEqual(latestPreferences.accountPreferences['antigravity:agy-work'], { purpose: 'personal', excludeFromSuggestions: true });
  await page.locator('#agy-name-agy-work').fill('Unsaved AGY name');
  await page.locator('[data-account-purpose="antigravity:agy-work"]').selectOption('work');
  assert.equal(await page.locator('#agy-name-agy-work').inputValue(), 'Unsaved AGY name', 'saving account preferences must preserve an unsaved name');
  await page.evaluate(() => window.testBridge.emit('usage-updated', window.testBridge.snapshot));
  assert.equal(await page.locator('#agy-name-agy-work').inputValue(), 'Unsaved AGY name', 'background checks must preserve an unsaved name');
  await page.evaluate(() => { window.testBridge.delayPreferenceSave = true; });
  const beforeQueuedSaves = await page.evaluate(() => window.testBridge.calls.filter(call => call.command === 'update_usage_preferences').length);
  await page.locator('#alert-lowEnabled').check();
  await page.waitForFunction(() => window.testBridge.releasePreferenceSave);
  await page.locator('#alert-resetEnabled').check();
  await page.locator('#preview-claude').uncheck();
  await page.locator('#preview-codex').uncheck();
  assert.equal(await page.locator('#alert-lowEnabled').isChecked(), true);
  assert.equal(await page.locator('#alert-resetEnabled').isChecked(), true);
  assert.equal(await page.locator('.compact .small-reading').count(), 1);
  assert.equal(await page.evaluate(() => window.testBridge.calls.filter(call => call.command === 'update_usage_preferences').length), beforeQueuedSaves + 1, 'preference writes must serialize while native storage is delayed');
  await page.evaluate(() => { window.testBridge.delayPreferenceSave = false; window.testBridge.releasePreferenceSave(); });
  await page.waitForFunction(() => {
    const prefs = window.testBridge.snapshot.settings.usagePreferences;
    return prefs.alertRules.lowEnabled && prefs.alertRules.resetEnabled && prefs.notchProviders.length === 1 && prefs.notchProviders[0] === 'antigravity';
  });
  assert.equal(await page.locator('#preview-claude').isChecked(), false);
  assert.equal(await page.locator('#preview-codex').isChecked(), false);
  assert.equal(await page.locator('#alert-lowEnabled').isChecked(), true, 'rapid changes must retain both alert choices');
  assert.equal(await page.locator('#alert-resetEnabled').isChecked(), true);
  for (const sourceControl of ['preset', 'provider button']) {
    await page.evaluate(() => { window.testBridge.delayPreferenceSave = true; window.testBridge.releasePreferenceSave = null; });
    await page.locator('#notch-window').selectOption(sourceControl === 'preset' ? 'weekly' : 'limiting');
    await page.waitForFunction(() => window.testBridge.releasePreferenceSave);
    await page.locator('#alert-resetEnabled').uncheck();
    if (sourceControl === 'preset') await page.locator('#notch-source').selectOption('claude');
    else await page.locator('[data-action="set-notch"][data-source="codex"]').click();
    const source = sourceControl === 'preset' ? 'claude' : 'codex';
    assert.equal(await page.locator('#notch-source').inputValue(), source, `${sourceControl} must supersede a pending custom preview immediately`);
    await page.evaluate(() => { window.testBridge.delayPreferenceSave = false; window.testBridge.releasePreferenceSave(); });
    await page.waitForFunction(source => {
      const { notchSource, usagePreferences } = window.testBridge.snapshot.settings;
      return notchSource === source && !usagePreferences.alertRules.resetEnabled;
    }, source);
    await page.evaluate(() => window.testBridge.emit('usage-updated', window.testBridge.snapshot));
    assert.equal(await page.locator('#notch-source').inputValue(), source, `${sourceControl} must persist after older custom preview writes finish`);
    assert.equal(await page.locator('#alert-resetEnabled').isChecked(), false, 'changing preview source must retain queued alert changes');
    await page.locator('#alert-resetEnabled').check();
  }
  assert.deepEqual(failures, []);
  console.log('Desktop UI passed: drag, themes, custom provider/window previews, preference persistence and validation, cooldown health and recovery, Codex/Antigravity filtered suggestions and confirmed switching.');
} finally { await browser.close(); }
