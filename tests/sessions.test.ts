import test from 'node:test';
import assert from 'node:assert/strict';
import { claudeNotchLimits, effectiveNotchSource, focusedSession, notchProviders, usagePreferences, visibleSessions, type Session } from '../src/model.ts';

test('first session stays stable across providers and status changes; privacy and hidden subscriptions apply', () => {
  const sessions: Session[] = [
    { id: 'two', provider: 'codex', label: 'work-code', status: 'working', startedAt: 20, updatedAt: 50 },
    { id: 'one', provider: 'antigravity', label: 'work-agy', status: 'finished', startedAt: 10, updatedAt: 60 },
    { id: 'three', provider: 'claude', label: 'work-claude', status: 'needsPermission', startedAt: 30, updatedAt: 70 },
  ];
  assert.deepEqual(visibleSessions(sessions).map(session => session.id), ['one', 'two', 'three']);
  assert.deepEqual(visibleSessions(sessions, ['antigravity']).map(session => session.id), ['two', 'three']);
  const privateSessions = visibleSessions(sessions, [], true);
  assert.deepEqual(privateSessions.map(session => session.label), ['Antigravity session 1', 'Codex session 2', 'Claude Code session 3']);
  assert.equal(privateSessions[0].status, 'finished');
  assert.equal(sessions[0].label, 'work-code');
});

test('Claude Fable selects its weekly limit independently and retains its preference when hidden', () => {
  const fable = { id: 'fable', label: 'Fable this week', description: null, fiveHour: null, weekly: { remaining: 73, resetsAt: 2000 } };
  const claude = { email: null, plan: null, fiveHour: { remaining: 62, resetsAt: 1000 }, weekly: { remaining: 39, resetsAt: 2000 }, updatedAt: null, error: null, modelLimits: [fable] };
  assert.equal(claudeNotchLimits(claude, 'claude:fable'), fable);
  assert.equal(claudeNotchLimits(claude, 'claude:missing'), claude);
  assert.deepEqual(notchProviders('claude:fable', usagePreferences()), ['claude']);
  assert.equal(effectiveNotchSource('claude:fable'), 'claude:fable');
  assert.equal(effectiveNotchSource('claude:fable', ['claude']), 'codex');
});

test('automatic switching is opt-in and keeps provider choices, session policy, and Claude exclusions', () => {
  assert.equal(usagePreferences().autoSwitch, undefined);
  const preferences = usagePreferences({ usagePreferences: { autoSwitch: { codex: true, antigravity: false, claude: true, sessions: 'close' }, accountPreferences: { 'claude:personal': { purpose: 'work', excludeFromSuggestions: true } } } });
  assert.deepEqual(preferences.autoSwitch, { codex: true, antigravity: false, claude: true, sessions: 'wait' });
  assert.equal(usagePreferences({ usagePreferences: { autoSwitch: { sessions: 'close', forceCloseConfirmed: true } } }).autoSwitch?.sessions, 'close');
  assert.deepEqual(preferences.accountPreferences['claude:personal'], { purpose: 'work', excludeFromSuggestions: true });
  assert.deepEqual(usagePreferences({ usagePreferences: { autoSwitch: { codex: 'true', sessions: 'unknown' } } }).autoSwitch, { codex: false, antigravity: false, claude: false, sessions: 'wait' });
});

test('the header focuses the working conversation and privacy removes its supplied title', () => {
  const sessions: Session[] = [
    { id: 'idle', provider: 'claude', label: 'first-project', status: 'rest', startedAt: 1, updatedAt: 1 },
    { id: 'active', provider: 'codex', label: 'project', title: 'Working conversation', status: 'working', startedAt: 2, updatedAt: 2 },
  ];
  assert.equal(focusedSession(sessions)?.id, 'active');
  assert.equal(focusedSession(sessions)?.title, 'Working conversation');
  assert.equal(focusedSession(visibleSessions(sessions, [], true))?.title, null);
  assert.equal(focusedSession([]), undefined);
});
