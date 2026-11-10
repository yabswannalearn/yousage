// Run after npm run build. Exercise the published build from a project subpath.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { chromium } from 'playwright';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 700 }, reducedMotion: 'reduce' });
  const base = 'https://preview.example.test/yousage/';
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
  await page.route(`${base}**`, async route => {
    const file = new URL(route.request().url()).pathname.slice('/yousage/'.length) || 'index.html';
    await route.fulfill({ body: await readFile(`dist/${file}`), contentType: types[extname(file)] });
  });
  for (const method of ['click', 'press']) {
    await page.goto(base);
    const link = page.getByRole('link', { name: 'Open the interface preview' });
    if (method === 'click') await link.click();
    else await link.press('Enter');
    await page.getByText('Preview data', { exact: true }).waitFor();
    assert.equal(await page.locator('#notch-toggle').getAttribute('aria-expanded'), 'true');
    assert.ok(await page.locator('#app').evaluate(el => el.getBoundingClientRect().width <= innerWidth));
    assert.equal(await page.evaluate(() => Boolean(window.__TAURI_INTERNALS__)), false);
  }
  console.log('Published demo passed: project subpath, mouse, keyboard, and narrow viewport.');
} finally {
  await browser.close();
}
