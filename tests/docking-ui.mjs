// Run with the Vite dev server. Uses only the explicit demonstration data.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 850 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await mkdir('artifacts/docking', { recursive: true });
try {
  for (const edge of ['floating', 'top', 'bottom', 'left', 'right']) {
    await page.goto(`http://127.0.0.1:1420/?preview=1&edge=${edge}`);
    const root = page.locator('#app');
    const header = page.locator('#notch-toggle');
    await header.waitFor();
    const compact = await root.boundingBox();
    assert.equal(Math.round(compact.width), ['left', 'right'].includes(edge) ? 58 : edge === 'floating' ? 440 : 480);
    assert.equal(Math.round(compact.height), ['left', 'right'].includes(edge) ? 184 : edge === 'floating' ? 80 : 40);
    assert.equal(await header.locator('svg[role=meter]').count(), 2);
    assert.equal(await header.locator('.reading-reset').count(), 2);
    assert.equal(await header.evaluate(el => el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth), true, `${edge} compact content must fit`);
    await page.screenshot({ path: `artifacts/docking/${edge}-compact.png` });
    await root.screenshot({ path: `artifacts/docking/${edge}-notch.png` });
    await header.click();
    await page.waitForTimeout(470);
    assert.equal(await header.getAttribute('aria-expanded'), 'true');
    assert.equal(Math.round((await root.boundingBox()).width), ['top', 'bottom'].includes(edge) ? 480 : 440);
    assert.equal(await page.locator('.panel-scroll').evaluate(el => el.scrollWidth <= el.clientWidth), true, `${edge} detail text must fit horizontally`);
    await page.screenshot({ path: `artifacts/docking/${edge}-expanded.png` });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(320);
    assert.equal(await header.getAttribute('aria-expanded'), 'false');
    assert.equal(Math.round((await root.boundingBox()).width), Math.round(compact.width));
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('http://127.0.0.1:1420/?preview=1&edge=top');
  await page.locator('#notch-toggle').click();
  await page.waitForFunction(() => document.querySelector('#app.expanded:not(.opening)'));
  assert.equal(await page.locator('.shell').evaluate(el => el.getAnimations().length), 0, 'reduced motion must skip shell animation');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#notch-toggle').getAttribute('aria-expanded') === 'false');
  assert.deepEqual(errors, []);
  console.log('Docking UI passed: all four edges and floating mode, compact fit, expansion, Escape and restored size.');
} finally { await browser.close(); }
