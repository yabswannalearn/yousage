import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultProviderColors, privacySnapshot, privacyText, type Snapshot } from '../src/model.ts';
import { defaultAppTheme } from '../src/theme.ts';

function example(privacyMode = true): Snapshot {
  const account = { id: 'desktop', label: 'Work', email: 'alex@example.com', identity: 'identity-a', desktop: true, plan: 'plus', fiveHour: { remaining: 45, resetsAt: 2000000000 }, weekly: null, updatedAt: 1900000000, error: 'Reconnect alex@example.com' };
  return {
    accounts: [account, { ...account, id: 'saved', desktop: false }], activeAccountId: 'desktop',
    antigravity: { email: 'google@example.com', error: 'Checking google@example.com', updatedAt: 1900000000, groups: [{ id: 'gemini', label: 'Gemini Models', description: 'Signed in as google@example.com', fiveHour: null, weekly: null }], accounts: [{ id: 'agy-saved', label: 'Research [Team]+', email: 'other@example.com', error: null, updatedAt: 1900000000, active: false, groups: [] }] },
    claude: { email: 'claude@example.com', plan: 'max', error: null, fiveHour: null, weekly: null, updatedAt: null },
    alerts: [{ id: 'codex:identity-a:5h:low', title: 'Codex (Work) low', message: 'alex@example.com has 45% remaining.', kind: 'low' }],
    update: { currentVersion: '0.1.0', latestVersion: null, releaseUrl: null, installerUrl: null, updateAvailable: false, checking: false, error: null },
    refreshing: false, switching: 'Switching Work', desktopError: 'Reconnect alex@example.com', login: { status: 'Signing in as login@example.net', error: null },
    health: { codex: { status: 'signInRequired', message: 'Sign in again to Work', lastSuccessAt: 1900000000, nextRetryAt: null, recoveryCommand: 'codex login' }, antigravity: { status: 'ready', message: 'Signed in as google@example.com', lastSuccessAt: 1900000000, nextRetryAt: null, recoveryCommand: null }, claude: { status: 'checking', message: 'Checking Claude', lastSuccessAt: null, nextRetryAt: null, recoveryCommand: null } },
    settings: { startWithWindows: false, refreshSeconds: 60, notchSource: 'both:gemini', notificationsEnabled: true, providerColors: { ...defaultProviderColors }, hiddenProviders: [], appTheme: { ...defaultAppTheme }, privacyMode },
  };
}

test('privacy redacts all displayed identities without changing account actions or readings', () => {
  const source = example();
  const view = privacySnapshot(source);
  assert.equal(view.accounts[0].label, view.accounts[1].label, 'desktop and saved connection share one alias');
  assert.equal(view.accounts[0].label, 'Codex account 1');
  assert.equal(view.accounts[0].email, null);
  assert.equal(view.antigravity.email, null);
  assert.equal(view.claude.email, null);
  assert.equal(view.antigravity.accounts?.[0].label, 'Antigravity account 1');
  assert.equal(view.accounts[1].id, 'saved');
  assert.equal(view.accounts[1].identity, source.accounts[1].identity, 'internal identity comparison remains authoritative');
  assert.equal(view.accounts[0].fiveHour?.remaining, 45);
  const displayed = [view.accounts[0].error, view.antigravity.error, view.antigravity.groups[0].description, view.alerts[0].title, view.alerts[0].message, view.health?.codex.message, view.login?.status, view.switching, view.desktopError].join('\n');
  assert.doesNotMatch(displayed, /alex@example|google@example|login@example|\bWork\b/);
  assert.equal(source.accounts[0].label, 'Work');
  assert.equal(source.accounts[0].email, 'alex@example.com');
  assert.equal(privacySnapshot({ ...source, settings: { ...source.settings, privacyMode: false } }).accounts[0].label, 'Work');
});

test('privacy handles literal punctuation, unknown emails, and whole account names', () => {
  const source = example();
  assert.equal(privacyText('Switch to Research [Team]+', source), 'Switch to Antigravity account 1');
  assert.equal(privacyText('Working on Work', source), 'Working on Codex account 1');
  assert.equal(privacyText('An unfamiliar new.user@example.org needs sign-in.', source), 'An unfamiliar Hidden account needs sign-in.');
  assert.equal(privacyText('45% remaining; resets in 2h', source), '45% remaining; resets in 2h');
});

test('privacy is opt-in and never rewrites ordinary display text when off', () => {
  const source = example(false);
  assert.equal(privacySnapshot(source), source);
  assert.equal(privacyText('Work: alex@example.com', source), 'Work: alex@example.com');
});
