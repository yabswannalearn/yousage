import test from 'node:test';
import assert from 'node:assert/strict';
import { themePalette, contrastRatio, defaultAppTheme, readableAccent } from '../src/theme.ts';

test('custom app surfaces and text stay readable across light, dark, and saturated backgrounds', () => {
  for (const background of ['#202221', '#ffffff', '#000000', '#e9e4ff', '#716b80', '#00ff00', '#0000ff', '#ff00ff']) {
    const palette = themePalette({ background, accent: '#8b45ce' });
    assert.equal(palette['--surface'], background);
    for (const surface of ['--surface', '--card', '--recess']) {
      assert.ok(contrastRatio(palette['--text'], palette[surface]) >= 4.5, `text on ${surface} with ${background}`);
    }
    assert.ok(contrastRatio(palette['--accent-ink'], palette['--card']) >= 4.5);
    assert.ok(contrastRatio(palette['--accent-contrast'], palette['--ui-accent']) >= 4.5);
  }
});

test('invalid or missing theme colors safely use the app defaults', () => {
  const palette = themePalette({ background: 'red;display:none', accent: '#fff' });
  assert.equal(palette['--surface'], defaultAppTheme.background);
  assert.equal(palette['--ui-accent'], defaultAppTheme.accent);
  assert.deepEqual(themePalette(undefined), themePalette(defaultAppTheme));
  assert.equal(readableAccent('#ffffff', '#000000'), '#ffffff');
});
