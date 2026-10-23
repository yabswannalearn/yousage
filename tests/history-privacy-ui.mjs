// Run against `npm run dev`: node tests/history-privacy-ui.mjs
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 480, height: 820 }, acceptDownloads: true });
page.setDefaultTimeout(7000);
const failures = [];
page.on('pageerror', error => failures.push(error.message));
await page.addInitScript(() => {
  const now = Math.floor(Date.now() / 1000);
  const allowance = { remaining: 48, resetsAt: now + 7200 };
  const account = { id: 'saved', label: 'Acme research', email: 'private@example.com', plan: 'plus', identity: 'identity-1', desktop: false, fiveHour: allowance, weekly: allowance, updatedAt: now, error: null };
  const snapshot = {
    accounts: [account, { ...account, id: 'second', label: 'Personal writing', email: 'writer@example.com', identity: 'identity-2' }], activeAccountId: 'saved',
    antigravity: { email: 'agy@example.com', accounts: [], groups: [], updatedAt: now, error: null },
    claude: { email: 'claude@example.com', plan: 'max', fiveHour: allowance, weekly: allowance, updatedAt: now, error: null },
    alerts: [], update: { currentVersion: '0.1.0', updateAvailable: false }, refreshing: false, desktopError: null, login: null, switching: null,
    settings: { startWithWindows: true, refreshSeconds: 60, notchSource: 'codex', notificationsEnabled: true, providerColors: { codex: '#b7c8b1', antigravity: '#8ab4d8', claude: '#d99a7c' }, hiddenProviders: [], privacyMode: false, historyRetentionDays: 30 },
  };
  const series = { id: 'series-1', provider: 'codex', accountId: 'saved', label: account.label, groupLabel: null, window: 'fiveHour', samples: [
    { at: now - 3600, remaining: 80, resetsAt: now + 7200 },
    { at: now - 3300, remaining: 78, resetsAt: now + 7200 },
    { at: now - 3000, remaining: 76, resetsAt: now + 7200 },
    // A gap followed by a reset must not be joined into an invented consumption line.
    { at: now - 600, remaining: 98, resetsAt: now + 36000 },
    { at: now - 300, remaining: 95, resetsAt: now + 36000 },
  ], pacing: { percentagePointsPerHour: 12, estimatedExhaustsAt: now + 3600, resetAt: now + 7200, mayRunOutBeforeReset: true, observedMinutes: 60 } };
  const callbacks = new Map(); const events = new Map();
  window.isTauri = true;
  window.testBridge = {
    snapshot, calls: [], series, cleared: false, pendingHistory: [], delayHistory: false, failNotification: false,
    emit(event, payload = null) { callbacks.get(events.get(event))?.({ event, payload: structuredClone(payload) }); },
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' } },
    transformCallback(fn) { const id = callbacks.size; callbacks.set(id, fn); return id; },
    async invoke(command, args) {
      const bridge = window.testBridge;
      bridge.calls.push({ command, args });
      if (command === 'plugin:event|listen') { events.set(args.event, args.handler); return args.handler; }
      if (command === 'get_snapshot') return structuredClone(snapshot);
      if (command === 'set_expanded') { document.getElementById('app').style.height = `${args.expanded ? args.height : 80}px`; return { upward: false, height: args.expanded ? args.height : 80 }; }
      if (command === 'get_usage_history') {
        const result = { series: bridge.cleared ? [] : [{ ...structuredClone(series), label: `${series.label} ${args.rangeHours === 24 ? 'day' : 'week'}` }], retentionDays: snapshot.settings.historyRetentionDays, recordingSince: now - 7200 };
        if (bridge.delayHistory) await new Promise(resolve => bridge.pendingHistory.push({ range: args.rangeHours, release: () => resolve() }));
        return result;
      }
      if (command === 'set_privacy_mode') { snapshot.settings.privacyMode = args.enabled; bridge.emit('usage-updated', snapshot); }
      if (command === 'update_history_settings') { snapshot.settings.historyRetentionDays = args.retentionDays; bridge.emit('usage-updated', snapshot); }
      if (command === 'clear_usage_history') bridge.cleared = true;
      if (command === 'export_usage_history') return `provider,account,remaining_percent\ncodex,${snapshot.settings.privacyMode ? 'Codex account 1' : account.label},48\n`;
      if (command === 'get_notification_status') return { availability: bridge.failNotification ? 'disabledForApp' : 'available', message: bridge.failNotification ? 'Windows has disabled notifications for YouSage.' : 'Windows allows notifications for YouSage.', lastAttemptAt: now, lastError: bridge.failNotification ? 'Notification delivery failed for private@example.com.' : null };
      if (command === 'test_notification') { if (bridge.failNotification) throw new Error('Windows denied the notification for private@example.com.'); return { availability: 'available', message: 'Windows accepted the request.', lastAttemptAt: now, lastError: null }; }
      if (command === 'prepare_switch') return { id: args.id, provider: 'codex', label: 'Personal writing', processNames: [], desktopRunning: false, cliRunning: false };
      if (command === 'switch_account') return;
    },
  };
});
try {
  await page.goto('http://127.0.0.1:1420');
  await page.locator('#notch-toggle').click();
  await page.waitForTimeout(470);
  await page.getByRole('button', { name: 'History & pace', exact: true }).click();
  await page.waitForSelector('.history-chart');
  assert.match(await page.locator('.pacing-summary').innerText(), /Approximate.*12 percentage points\/hour over 1 hours/);
  assert.equal(await page.locator('.history-line').count(), 2, 'gaps and allowance resets must remain separate segments');
  assert.equal(await page.locator('.history-point').count(), 5);
  assert.match(await page.locator('.history-point title').first().textContent(), /80% remaining/);
  assert.match(await page.locator('.history-chart desc').textContent(), /actual sample time/);
  await page.evaluate(() => { window.testBridge.delayHistory = true; });
  await page.getByRole('button', { name: '7 days', exact: true }).click();
  await page.waitForFunction(() => window.testBridge.pendingHistory.some(item => item.range === 168));
  await page.getByRole('button', { name: '24 hours', exact: true }).click();
  await page.waitForFunction(() => window.testBridge.pendingHistory.some(item => item.range === 24));
  await page.evaluate(() => window.testBridge.pendingHistory.find(item => item.range === 24).release());
  await page.waitForSelector('#history-series');
  assert.match(await page.locator('#history-series').innerText(), /day/);
  await page.evaluate(() => { window.testBridge.pendingHistory.find(item => item.range === 168).release(); window.testBridge.delayHistory = false; });
  await page.waitForTimeout(100);
  assert.match(await page.locator('#history-series').innerText(), /day/, 'an older range response must not replace the current range');
  await page.locator('[data-action="manage"][data-id="saved"]').click();
  await page.locator('#name-saved').fill('Sensitive unsaved draft');
  await page.getByRole('button', { name: 'Toggle privacy mode', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-action="privacy"]').getAttribute('aria-pressed') === 'true');
  assert.equal(await page.locator('#name-saved').isDisabled(), true);
  assert.equal(await page.locator('#name-saved').inputValue(), 'Codex account 1', 'privacy must remove an unsaved account name from input values');
  const visiblePrivate = await page.locator('#app').innerText();
  assert.doesNotMatch(visiblePrivate, /Acme research|Personal writing|private@example\.com|claude@example\.com|agy@example\.com|Sensitive unsaved draft/);
  assert.match(visiblePrivate, /Codex account 1/);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV', exact: true }).click()]);
  const stream = await download.createReadStream(); const chunks = []; for await (const chunk of stream) chunks.push(chunk);
  assert.match(Buffer.concat(chunks).toString(), /Codex account 1/);
  assert.doesNotMatch(Buffer.concat(chunks).toString(), /Acme research/);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('#history-retention').selectOption('7');
  await page.waitForFunction(() => window.testBridge.snapshot.settings.historyRetentionDays === 7);
  await page.getByRole('button', { name: 'Send test notification', exact: true }).click();
  assert.match(await page.locator('.success-banner').innerText(), /Windows accepted.*banner depends on Windows settings/);
  await page.evaluate(() => { window.testBridge.failNotification = true; });
  await page.getByRole('button', { name: 'Send test notification', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.notification-health').textContent.includes('disabled'));
  assert.match(await page.locator('.notification-health').innerText(), /disabled notifications/);
  assert.doesNotMatch(await page.locator('#app').innerText(), /private@example\.com/);
  assert.match(await page.locator('.error-banner').innerText(), /Windows denied/);
  await page.getByRole('button', { name: 'Open Windows notification settings', exact: true }).click();
  assert.equal(await page.evaluate(() => window.testBridge.calls.filter(call => call.command === 'open_notification_settings').length), 1);
  await page.getByRole('button', { name: 'Clear history', exact: true }).click();
  assert.equal(await page.evaluate(() => window.testBridge.cleared), false, 'clearing requires a second explicit click');
  await page.getByRole('button', { name: 'Confirm clear history', exact: true }).click();
  await page.waitForFunction(() => window.testBridge.cleared);
  await page.waitForSelector('.history-empty');
  assert.match(await page.locator('.history-empty').innerText(), /history starts with fresh usage checks/);
  await page.getByRole('checkbox', { name: 'Privacy mode', exact: true }).uncheck();
  await page.waitForFunction(() => document.querySelector('[data-action="privacy"]').getAttribute('aria-pressed') === 'false');
  assert.equal(await page.locator('#name-saved').inputValue(), 'Acme research', 'turning privacy off must restore original stored names');
  assert.equal(await page.evaluate(() => window.testBridge.snapshot.accounts[0].label), 'Acme research');
  // A pre-existing confirmation and its later success notice must also respond to privacy toggles.
  await page.locator('[data-action="prepare-switch"][data-id="second"]').click();
  assert.match(await page.getByRole('dialog').innerText(), /Personal writing/);
  await page.getByRole('button', { name: 'Toggle privacy mode', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-action="privacy"]').getAttribute('aria-pressed') === 'true');
  assert.doesNotMatch(await page.getByRole('dialog').innerText(), /Personal writing/);
  await page.getByRole('button', { name: 'Switch account', exact: true }).click();
  assert.doesNotMatch(await page.locator('.success-banner').innerText(), /Personal writing/);
  await page.getByRole('button', { name: 'History & pace', exact: true }).click();
  await page.waitForTimeout(400);
  const closedCalls = await page.evaluate(() => window.testBridge.calls.filter(call => call.command === 'get_usage_history').length);
  await page.evaluate(() => window.testBridge.emit('usage-updated', window.testBridge.snapshot));
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.testBridge.calls.filter(call => call.command === 'get_usage_history').length), closedCalls, 'background updates must not query history while the panel is closed');
  assert.deepEqual(failures, []);
  console.log('History/privacy UI passed: range races, truthful chart segments, forecasts, alias/draft/switch redaction, private CSV, retention/clear confirmation, notification status/failures, and no closed-panel polling.');
} finally { await browser.close(); }
