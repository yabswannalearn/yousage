import test from 'node:test';
import assert from 'node:assert/strict';
import { percentage, resetLabel, uniqueAccounts, isActiveAccount, freshness, escapeHtml, type Account } from '../src/model.ts';

function account(overrides: Partial<Account> = {}): Account {
  return { id: 'work', label: 'Work', identity: 'work-identity', email: 'work@example.com', plan: 'business', desktop: false, fiveHour: null, weekly: null, updatedAt: null, error: null, ...overrides };
}

test('unavailable allowance stays unknown; exhausted allowance is zero', () => {
  assert.equal(percentage(null), '—');
  assert.equal(percentage(undefined), '—');
  assert.equal(percentage(NaN), '—');
  assert.equal(percentage(0), '0%');
  assert.equal(percentage(110), '100%');
  assert.equal(percentage(-5), '0%');
});

test('active account and saved connection share one card without losing management', () => {
  const active = account({ id: 'desktop', desktop: true, label: 'Desktop', fiveHour: { remaining: 42, resetsAt: null } });
  const saved = account({ id: 'saved-work', label: 'Work' });
  const personal = account({ id: 'personal', identity: 'personal-identity' });
  const visible = uniqueAccounts([personal, saved, active], 'desktop');
  assert.equal(visible.length, 2);
  assert.equal(visible[0].id, 'saved-work');
  assert.equal(visible[0].label, 'Work');
  assert.equal(visible[0].fiveHour?.remaining, 42);
  assert.equal(visible[0].desktop, false);
});

test('unknown identities are not merged, and desktop changes preserve saved accounts', () => {
  const accounts = [account(), account({ id: 'unknown', identity: null }), account({ id: 'other', identity: null })];
  assert.equal(uniqueAccounts(accounts, 'work').length, 3);
  const switched = [...accounts, account({ id: 'desktop', identity: 'personal', desktop: true })];
  assert.equal(uniqueAccounts(switched, 'desktop').length, 4);
});

test('a passed reset time does not invent a refilled allowance', () => {
  assert.equal(resetLabel(1, 2000), 'Reset due · refreshing');
  assert.equal(resetLabel(null), 'Reset time unavailable');
});

test('cached usage is identified during a failed refresh', () => {
  assert.equal(freshness(account({ updatedAt: 100, error: 'offline' }), 101000), 'Last known usage');
  assert.equal(freshness(account({ error: 'offline' })), 'Usage unavailable');
});

test('account names cannot inject markup', () => {
  assert.equal(escapeHtml('<img src=x onerror="bad">'), '&lt;img src=x onerror=&quot;bad&quot;&gt;');
});

test('the switch target stays identifiable when desktop and saved cards merge', () => {
  const desktop = account({ id: 'desktop', desktop: true });
  const saved = account({ id: 'saved-work' });
  const personal = account({ id: 'personal', identity: 'personal' });
  const accounts = [desktop, saved, personal];
  const visible = uniqueAccounts(accounts, 'desktop');
  assert.ok(isActiveAccount(visible[0], accounts, 'desktop'));
  assert.equal(visible[0].id, 'saved-work');
  assert.ok(!isActiveAccount(personal, accounts, 'desktop'));
  assert.ok(!isActiveAccount(account({ identity: null }), [desktop], 'desktop'));
});
