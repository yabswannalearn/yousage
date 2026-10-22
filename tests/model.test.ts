import test from 'node:test';
import assert from 'node:assert/strict';
import { percentage, resetLabel, uniqueAccounts, isActiveAccount, isAntigravityNotch, isBothNotch, selectedAntigravityGroup, suggestedCodexSwitch, freshness, escapeHtml, type Account, type AntigravityStatus } from '../src/model.ts';
import { effectiveNotchSource, providerColor, compactResetLabel, usagePreferences, defaultUsagePreferences, notchProviders, previewWindow, codexRecommendation, antigravityRecommendation, type Provider, type AntigravityAccount, type AntigravityGroup } from '../src/model.ts';

test('compact reset text preserves unknown and due states and rounds future minutes up', () => {
  const now = 1000000;
  assert.equal(compactResetLabel(null, now), 'Reset unknown');
  assert.equal(compactResetLabel(999, now), 'Reset due');
  assert.equal(compactResetLabel(1001, now), 'in 1m');
  assert.equal(compactResetLabel(1000 + 3660, now), 'in 1h 1m');
  assert.equal(compactResetLabel(1000 + 176400, now), 'in 2d 1h');
});

test('hidden subscriptions fall back without losing the preferred source or group', () => {
  assert.equal(effectiveNotchSource('both:gemini', ['codex']), 'antigravity:gemini');
  assert.equal(effectiveNotchSource('both:gemini', ['antigravity']), 'codex');
  assert.equal(effectiveNotchSource('both:gemini', ['codex', 'antigravity']), 'claude');
  assert.equal(effectiveNotchSource('claude', ['claude']), 'codex');
  assert.equal(effectiveNotchSource('claude', ['codex', 'antigravity', 'claude']), 'none');
  assert.equal(effectiveNotchSource('claude', []), 'claude');
});

test('provider accents accept custom hex colors and reject invalid styles', () => {
  assert.equal(providerColor({ codex: '#FF66aa' }, 'codex'), '#FF66aa');
  assert.equal(providerColor({ codex: 'red;display:none' }, 'codex'), '#b7c8b1');
  assert.equal(providerColor(undefined, 'claude'), '#d99a7c');
});

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
  assert.equal(freshness(account({ updatedAt: 100, error: 'offline' }), 101000), 'Last known usage · just now');
  assert.equal(freshness(account({ updatedAt: 100, error: 'offline' }), 820000), 'Last known usage · 12m ago');
  assert.equal(freshness(account({ updatedAt: 100, error: 'offline' }), 7300000), 'Last known usage · 2h ago');
  assert.equal(freshness(account({ updatedAt: 100 }), 820000), 'Updated 12m ago');
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

test('antigravity and dual-provider notch selection resolves matching group or falls back to the first group', () => {
  const status: AntigravityStatus = {
    email: 'dev@example.com',
    updatedAt: 100,
    error: null,
    groups: [
      { id: 'gemini-models', label: 'Gemini Models', description: null, fiveHour: { remaining: 100, resetsAt: null }, weekly: { remaining: 100, resetsAt: null } },
      { id: 'claude-and-gpt-models', label: 'Claude and GPT models', description: null, fiveHour: { remaining: 97, resetsAt: null }, weekly: { remaining: 83, resetsAt: null } },
    ],
  };
  assert.equal(isAntigravityNotch('codex'), false);
  assert.equal(isAntigravityNotch('antigravity'), true);
  assert.equal(isAntigravityNotch('antigravity:claude-and-gpt-models'), true);
  assert.equal(isBothNotch('both'), true);
  assert.equal(isBothNotch('both:claude-and-gpt-models'), true);
  assert.equal(isBothNotch('codex'), false);
  assert.equal(selectedAntigravityGroup(status, 'antigravity')?.id, 'gemini-models');
  assert.equal(selectedAntigravityGroup(status, 'antigravity:claude-and-gpt-models')?.id, 'claude-and-gpt-models');
  assert.equal(selectedAntigravityGroup(status, 'both:claude-and-gpt-models')?.id, 'claude-and-gpt-models');
  assert.equal(selectedAntigravityGroup(status, 'custom:claude-and-gpt-models')?.id, 'claude-and-gpt-models');
  assert.equal(selectedAntigravityGroup(status, 'antigravity:unknown')?.id, 'gemini-models');
  assert.equal(selectedAntigravityGroup({ email: null, groups: [], updatedAt: null, error: null }, 'antigravity'), null);
});

test('suggestedCodexSwitch recommends healthy connected account when active account is low', () => {
  const lowActive = account({ id: 'desktop', desktop: true, identity: 'work-id', fiveHour: { remaining: 15, resetsAt: null }, weekly: { remaining: 60, resetsAt: null } });
  const healthyPersonal = account({ id: 'personal', label: 'Personal', identity: 'personal-id', fiveHour: { remaining: 90, resetsAt: null }, weekly: { remaining: 85, resetsAt: null } });
  assert.equal(suggestedCodexSwitch([lowActive, healthyPersonal], 'desktop')?.id, 'personal');

  const healthyActive = account({ id: 'desktop', desktop: true, identity: 'work-id', fiveHour: { remaining: 65, resetsAt: null }, weekly: { remaining: 60, resetsAt: null } });
  assert.equal(suggestedCodexSwitch([healthyActive, healthyPersonal], 'desktop'), null);
});

test('older usage settings gain independent defaults and invalid saved values are normalized', () => {
  const defaults = usagePreferences({});
  assert.deepEqual(defaults, defaultUsagePreferences);
  defaults.alertRules.codex.warningPercent = 50;
  defaults.notchProviders.push('claude');
  assert.equal(usagePreferences({}).alertRules.codex.warningPercent, 20);
  assert.deepEqual(usagePreferences({}).notchProviders, []);
  const normalized = usagePreferences({ usagePreferences: {
    notchProviders: ['claude', 'codex', 'claude', 'unknown'], notchWindow: 'unknown',
    alertRules: { codex: { warningPercent: 5, criticalPercent: 10 }, claude: { warningPercent: 1, criticalPercent: 0 }, quietStart: '25:00', quietEnd: '09:30', snoozedUntil: 1234 },
    recommendationPurpose: 'work', accountPreferences: { 'codex:a': { purpose: 'personal', excludeFromSuggestions: true }, a: { purpose: 'work' } },
  } });
  assert.deepEqual(normalized.notchProviders, ['claude', 'codex']);
  assert.equal(normalized.notchWindow, 'limiting');
  assert.ok(normalized.alertRules.codex.criticalPercent < normalized.alertRules.codex.warningPercent);
  assert.equal(normalized.alertRules.claude.criticalPercent, 0);
  assert.equal(normalized.alertRules.quietStart, '22:00');
  assert.equal(normalized.alertRules.quietEnd, '09:30');
  assert.equal(normalized.alertRules.snoozedUntil, 1234);
  assert.equal(normalized.recommendationPurpose, 'work');
  assert.deepEqual(Object.keys(normalized.accountPreferences), ['codex:a']);
});

test('custom notch supports every provider combination and hiding preserves selected order', () => {
  const providers: Provider[] = ['codex', 'antigravity', 'claude'];
  for (let mask = 1; mask < 8; mask++) {
    const selected = providers.filter((_, index) => mask & (1 << index));
    const preferences = usagePreferences({ usagePreferences: { notchProviders: selected } });
    assert.deepEqual(notchProviders('custom:gemini', preferences), selected);
    assert.deepEqual(notchProviders('custom:gemini', preferences, [selected[0]]), selected.length > 1 ? selected.slice(1) : providers.filter(provider => provider !== selected[0]).slice(0, 1));
    assert.deepEqual(notchProviders('custom:gemini', preferences), selected);
    assert.deepEqual(notchProviders('custom:gemini', preferences, providers), []);
  }
  const preferences = usagePreferences({ usagePreferences: { notchProviders: ['claude', 'codex'] } });
  assert.deepEqual(notchProviders('custom', preferences), ['claude', 'codex']);
  assert.deepEqual(notchProviders('both:gemini', preferences, ['codex']), ['antigravity']);
  assert.deepEqual(notchProviders('claude', preferences, ['claude']), ['codex']);
  assert.equal(effectiveNotchSource('custom:gemini', ['codex']), 'custom:gemini');
  assert.equal(effectiveNotchSource('custom:gemini', providers), 'none');
});

test('preview fallback labels the actual window, including weekly-only Antigravity groups', () => {
  const fiveHour = { remaining: 45, resetsAt: 100 };
  const weekly = { remaining: 12, resetsAt: 200 };
  assert.deepEqual(previewWindow(fiveHour, weekly, 'fiveHour'), { label: '5h', window: fiveHour });
  assert.deepEqual(previewWindow(fiveHour, weekly, 'weekly'), { label: 'Week', window: weekly });
  assert.deepEqual(previewWindow(fiveHour, weekly, 'limiting'), { label: 'Week', window: weekly });
  for (const mode of ['fiveHour', 'weekly', 'limiting'] as const) {
    assert.deepEqual(previewWindow(null, weekly, mode), { label: 'Week', window: weekly });
    assert.deepEqual(previewWindow(fiveHour, null, mode), { label: '5h', window: fiveHour });
  }
  assert.deepEqual(previewWindow(null, null, 'weekly'), { label: 'Week', window: null });
  assert.deepEqual(previewWindow(null, null, 'limiting'), { label: '5h', window: null });
});

const recommendationNow = 10_000_000;
const recommendationSeconds = recommendationNow / 1000;
function freshAccount(id: string, five = 80, weekly = 75, overrides: Partial<Account> = {}): Account {
  return account({ id, label: id, identity: id, updatedAt: recommendationSeconds, fiveHour: { remaining: five, resetsAt: recommendationSeconds + 7200 }, weekly: { remaining: weekly, resetsAt: recommendationSeconds + 86400 }, ...overrides });
}

test('Codex recommendations explain fresh capacity and compare both allowance windows', () => {
  const active = freshAccount('desktop', 15, 65, { desktop: true });
  const accounts = [active, freshAccount('large-five-small-week', 99, 40), freshAccount('balanced', 80, 75)];
  const recommendation = codexRecommendation(accounts, 'desktop', usagePreferences({}), recommendationNow);
  assert.equal(recommendation?.id, 'balanced');
  assert.equal(recommendation?.remaining, 75);
  assert.match(recommendation!.reason, /75%.*15%/);
  assert.match(recommendation!.reason, /resets in 2h/);
  assert.equal(codexRecommendation([freshAccount('desktop', 65, 65, { desktop: true }), accounts[2]], 'desktop', usagePreferences({}), recommendationNow), null);
});

test('recommendations reject stale, failed, unknown, expired-reset, and future-dated readings', () => {
  const active = freshAccount('desktop', 15, 65, { desktop: true });
  const preferences = usagePreferences({});
  for (const overrides of [
    { updatedAt: recommendationSeconds - 901 },
    { updatedAt: recommendationSeconds + 61 },
    { updatedAt: null },
    { error: 'offline' },
    { weekly: null },
    { weekly: { remaining: 90, resetsAt: recommendationSeconds - 1 } },
    { fiveHour: { remaining: NaN, resetsAt: null } },
  ]) {
    assert.equal(codexRecommendation([active, freshAccount('candidate', 90, 90, overrides)], 'desktop', preferences, recommendationNow), null);
  }
  assert.equal(codexRecommendation([active, freshAccount('candidate', 90, 90, { updatedAt: recommendationSeconds - 900 })], 'desktop', preferences, recommendationNow)?.id, 'candidate');
  assert.equal(codexRecommendation([{ ...active, updatedAt: recommendationSeconds - 901 }, freshAccount('candidate')], 'desktop', preferences, recommendationNow), null);
});

test('recommendations honor account purpose, exclusions, and imminent resets', () => {
  const active = freshAccount('desktop', 15, 65, { desktop: true });
  const preferences = usagePreferences({ usagePreferences: {
    recommendationPurpose: 'work',
    accountPreferences: {
      'codex:personal': { purpose: 'personal', excludeFromSuggestions: false },
      'codex:excluded': { purpose: 'work', excludeFromSuggestions: true },
      'codex:work': { purpose: 'work', excludeFromSuggestions: false },
    },
  } });
  const candidates = [freshAccount('personal', 99, 99), freshAccount('excluded', 95, 95), freshAccount('work', 70, 60)];
  assert.equal(codexRecommendation([active, ...candidates], 'desktop', preferences, recommendationNow)?.id, 'work');
  const soon = { remaining: 0, resetsAt: recommendationSeconds + 300 };
  assert.equal(codexRecommendation([{ ...active, fiveHour: soon }, ...candidates], 'desktop', preferences, recommendationNow), null);
  const stillWeeklyLow = { ...active, fiveHour: soon, weekly: { remaining: 0, resetsAt: recommendationSeconds + 86400 } };
  const recommendation = codexRecommendation([stillWeeklyLow, ...candidates], 'desktop', preferences, recommendationNow);
  assert.equal(recommendation?.id, 'work');
  assert.match(recommendation!.reason, /current Week window/);
});

function modelGroup(id: string, remaining: number, weeklyOnly = false): AntigravityGroup {
  return { id, label: id, description: null, fiveHour: weeklyOnly ? null : { remaining, resetsAt: recommendationSeconds + 7200 }, weekly: { remaining, resetsAt: recommendationSeconds + 86400 } };
}

function agyAccount(id: string, groups: AntigravityGroup[], overrides: Partial<AntigravityAccount> = {}): AntigravityAccount {
  return { id, label: id, email: `${id}@example.com`, groups, updatedAt: recommendationSeconds, error: null, active: false, ...overrides };
}

test('Antigravity recommendations compare the selected group and support weekly-only quotas', () => {
  const status: AntigravityStatus = {
    email: 'active@example.com', updatedAt: recommendationSeconds, error: null,
    groups: [modelGroup('gemini', 90), modelGroup('argon', 12, true)],
    accounts: [agyAccount('wrong-group', [modelGroup('gemini', 100)]), agyAccount('right-group', [modelGroup('gemini', 10), modelGroup('argon', 80, true)])],
  };
  const recommendation = antigravityRecommendation(status, 'argon', usagePreferences({}), recommendationNow);
  assert.equal(recommendation?.id, 'right-group');
  assert.equal(recommendation?.remaining, 80);
  assert.match(recommendation!.reason, /argon:.*Week/);
  assert.equal(antigravityRecommendation(status, 'gemini', usagePreferences({}), recommendationNow), null);
  assert.equal(antigravityRecommendation(status, 'missing', usagePreferences({}), recommendationNow), null);
});

test('Antigravity recommendations reject matching groups with stale, excluded, or incomplete readings', () => {
  const group = modelGroup('gemini', 10);
  const status: AntigravityStatus = { email: 'active@example.com', updatedAt: recommendationSeconds, error: null, groups: [group] };
  const preferences = usagePreferences({});
  const invalid = [
    agyAccount('candidate', [modelGroup('gemini', 90)], { updatedAt: recommendationSeconds - 901 }),
    agyAccount('candidate', [modelGroup('gemini', 90)], { email: 'ACTIVE@example.com' }),
    agyAccount('candidate', [modelGroup('gemini', 90)], { error: 'offline' }),
    agyAccount('candidate', [modelGroup('gemini', 90, true)]),
  ];
  for (const candidate of invalid) assert.equal(antigravityRecommendation({ ...status, accounts: [candidate] }, 'gemini', preferences, recommendationNow), null);
  const excluded = usagePreferences({ usagePreferences: { accountPreferences: { 'antigravity:candidate': { purpose: 'any', excludeFromSuggestions: true } } } });
  assert.equal(antigravityRecommendation({ ...status, accounts: [agyAccount('candidate', [modelGroup('gemini', 90)])] }, 'gemini', excluded, recommendationNow), null);
});
