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
    emit(event, payload = null) { callbacks.get(events.get(event))?.({ event, payload }); },
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' } },
    transformCallback(fn) { const id = callbacks.size; callbacks.set(id, fn); return id; },
    async invoke(command, args) {
      window.testBridge.calls.push({ command, args });
      if (command === 'plugin:event|listen') { events.set(args.event, args.handler); return args.handler; }
      if (command === 'get_snapshot') return snapshot;
      if (command === 'set_expanded') {
        if (window.testBridge.dragging) await new Promise(resolve => { window.testBridge.finishResize = resolve; });
        document.getElementById('app').style.height = `${args.expanded ? args.height : 80}px`;
        return { upward: false, height: args.expanded ? args.height : 80 };
      }
      if (command === 'plugin:window|start_dragging' || command === 'start_notch_drag') { window.testBridge.dragging = true; }
      if (command === 'update_settings') {
        Object.assign(snapshot.settings, args);
        window.testBridge.emit('usage-updated', snapshot);
      }
    },
  };
});
try {
  await page.goto('http://127.0.0.1:1420');
  await page.locator('#notch-toggle').click();
  await page.waitForTimeout(300);
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
  await page.waitForTimeout(200);
  assert.equal(await header.getAttribute('aria-expanded'), 'false', 'the next intentional click must still collapse');
  await header.click();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('App background', { exact: true }).fill('#e9e4ff');
  await page.getByLabel('UI accent', { exact: true }).fill('#8b45ce');
  assert.equal(await page.locator('.shell').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(233, 228, 255)');
  assert.equal(await page.locator('.brand-mark span').first().evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(139, 69, 206)');
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
  assert.equal(await page.locator('section[aria-label="Claude usage"] .track').count(), 2);
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
  if (process.env.YOUSAGE_UI_SCREENSHOT) {
    await page.locator('.settings-panel').scrollIntoViewIfNeeded();
    await page.locator('.panel-scroll').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await page.screenshot({ path: process.env.YOUSAGE_UI_SCREENSHOT });
  }
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('.panel-scroll').evaluate(el => { el.scrollTop = el.scrollHeight; });
  assert.deepEqual(failures, []);
  console.log('Desktop UI passed: long drag, focus changes, release click, colors, Claude preview, hide/restore all providers.');
} finally { await browser.close(); }
