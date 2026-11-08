import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 850 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await mkdir('artifacts/notch', { recursive: true });
const isOpen = () => page.locator('#notch-toggle').getAttribute('aria-expanded');
const hover = async () => {
  await page.mouse.move(950, 800);
  const box = await page.locator('.shell').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 1);
  await page.waitForTimeout(700);
};
try {
  await page.goto('http://127.0.0.1:1420/?preview=1&sessions=1&edge=top');
  assert.equal(await isOpen(), 'false');
  const compact = await page.locator('.shell').boundingBox();
  assert.equal(compact.width, 320);
  assert.equal(compact.height, 26);
  await page.mouse.move(compact.x + compact.width / 2, compact.y + compact.height / 2);
  await page.waitForTimeout(650);
  assert.equal(await isOpen(), 'false', 'passing over the notch body must not open it');
  await page.mouse.move(compact.x + compact.width / 2, compact.y + 1);
  await page.mouse.move(950, 800);
  await page.waitForTimeout(350);
  assert.equal(await isOpen(), 'false', 'crossing the top edge without resting must not open it');
  assert.equal(await page.locator('.session-title').innerText(), 'yousage');
  assert.equal(await page.locator('.session-count').innerText(), '+2');
  assert.notEqual(await page.locator('.compact-title [data-logo=claude]').evaluate(el => getComputedStyle(el).backgroundImage), 'none', 'inline SVG URLs must survive CSS quoting');
  await page.locator('#app').screenshot({ path: 'artifacts/notch/working.png' });
  await hover();
  assert.equal(await isOpen(), 'true', 'hover opens without a click');
  await page.waitForTimeout(850);
  assert.equal(await isOpen(), 'true', 'a stationary pointer leaves the preview open');
  await page.mouse.move(950, 800);
  await page.waitForTimeout(350);
  assert.equal(await isOpen(), 'false', 'moving outside closes an unpinned preview');
  await hover();
  await page.locator('#notch-toggle').click();
  assert.equal(await page.locator('#app').evaluate(el => el.classList.contains('pinned')), true);
  await page.mouse.move(950, 800);
  await page.waitForTimeout(500);
  assert.equal(await isOpen(), 'true', 'a pinned notch stays open after leaving');
  await page.mouse.click(950, 800);
  await page.waitForTimeout(350);
  assert.equal(await isOpen(), 'false', 'an outside click closes the pinned notch');

  // A synthetic click cannot expand the compact notch.
  await page.locator('#notch-toggle').evaluate(el => el.click());
  assert.equal(await isOpen(), 'false');
  for (const status of ['rest', 'needsPermission', 'finished']) {
    await page.goto(`http://127.0.0.1:1420/?preview=1&sessions=1&edge=top&status=${status}`);
    assert.equal(await page.locator('#notch-toggle').getAttribute('data-status'), status);
    await page.locator('#app').screenshot({ path: `artifacts/notch/${status}.png` });
    assert.equal(await page.locator('.compact .session-indicator').count(), 0, 'the grey header dot is removed');
  }
  await hover();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('#show-antigravity').uncheck();
  assert.equal(await page.locator('.session-count').innerText(), '+1');
  await page.locator('#show-antigravity').check();
  assert.equal(await page.locator('.session-count').innerText(), '+2');
  await page.locator('#notch-source').selectOption('claude:fable');
  assert.equal(await page.locator('.compact .small-reading').count(), 1, 'Fable has a separate weekly allowance');
  assert.equal(await page.locator('.compact .reading-label').innerText(), 'Week');
  assert.equal(await page.locator('.compact .small-reading strong').innerText(), '73%');
  for (const provider of ['Codex', 'Antigravity', 'Claude']) {
    const control = page.getByRole('checkbox', { name: `Auto switch ${provider}`, exact: true });
    assert.equal(await control.isChecked(), false, 'auto switching must start disabled');
    await control.check();
  }
  assert.equal(await page.locator('#auto-switch-sessions').inputValue(), 'close');
  await page.locator('#auto-switch-sessions').selectOption('close');
  assert.match(await page.locator('.auto-switch-warning').innerText(), /unsaved work can be lost/);
  await page.locator('.auto-switch-settings').screenshot({ path: 'artifacts/notch/auto-switch-settings.png' });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  for (const provider of ['Codex', 'Antigravity', 'Claude']) assert.equal(await page.getByRole('checkbox', { name: `Auto switch ${provider}`, exact: true }).isChecked(), true);
  assert.equal(await page.locator('#auto-switch-sessions').inputValue(), 'close');
  await page.locator('#auto-switch-sessions').selectOption('wait');
  await page.getByRole('button', { name: 'Enable session status', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Disable session status', exact: true }).count(), 1);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Save sign-in', exact: true }).last().click();
  await page.locator('#claude-save-label').fill('Personal Claude');
  await page.locator('form[data-form="save-claude"] button[type="submit"]').click();
  assert.match(await page.locator('.claude-accounts').innerText(), /Personal Claude/);
  await page.locator('[data-action="switch-claude"]').click();
  assert.match(await page.getByRole('dialog').innerText(), /Switch Claude Code account/);
  assert.match(await page.getByRole('dialog').innerText(), /claude.exe/);
  await page.getByRole('button', { name: 'Close sessions and switch', exact: true }).click();
  assert.match(await page.locator('.success-banner').innerText(), /New Claude Code sessions/);
  await page.getByRole('button', { name: 'Toggle privacy mode', exact: true }).click();
  assert.doesNotMatch(await page.locator('.shell').innerText(), /personal@example.com|work@example.com|yousage|website|model-tests|Personal Claude/);
  assert.match(await page.locator('.session-title').innerText(), /session \d/);
  await page.locator('#app').screenshot({ path: 'artifacts/notch/expanded.png' });
  assert.deepEqual(errors, []);
  console.log('Notch UI passed: hover, stationary pointer, pin/outside click, four states, +N sessions, Fable weekly preview, Claude save/switch and privacy.');
} finally { await browser.close(); }
