// node tests/session-events.mjs <path-to-yousage.exe>
// Uses synthetic metadata and temporary files; never loads Tauri or real sign-ins.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, sep, basename } from 'node:path';

const source = resolve(process.argv[2] ?? 'src-tauri/target/release/yousage.exe');
const root = await mkdtemp(join(tmpdir(), 'yousage-session-test-'));
const directory = join(root, 'session events');
const executable = join(root, 'YouSage test.exe');
await copyFile(source, executable);
const invoke = (provider, payload, event) => new Promise((resolveCall, reject) => {
  const child = spawn(executable, ['--yousage-session-event', provider, directory, ...(event ? [event] : [])], { windowsHide: true });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('error', reject);
  child.on('exit', code => { try { assert.equal(code, 0, stderr); resolveCall(stdout); } catch (error) { reject(error); } });
  child.stdin.end(JSON.stringify(payload));
});
const recorded = async () => {
  const names = await readdir(directory);
  return Promise.all(names.filter(name => name.endsWith('.json')).map(async name => JSON.parse(await readFile(join(directory, name), 'utf8'))));
};
try {
  for (const provider of ['codex', 'claude']) {
    for (const [event, status] of [['SessionStart', 'rest'], ['UserPromptSubmit', 'working'], ['PermissionRequest', 'needsPermission'], ['PostToolUse', 'working'], ['Stop', 'finished']]) {
      const output = await invoke(provider, { session_id: provider, cwd: String.raw`C:\Private\project`, hook_event_name: event, prompt: 'never save this prompt', tool_input: { command: 'never save this command' } });
      assert.deepEqual(JSON.parse(output), {}, 'observer must return a neutral hook result');
      const [session] = await recorded();
      assert.equal(session.status, status);
      assert.equal(session.label, 'project');
      assert.doesNotMatch(JSON.stringify(session), /Private|never save|tool_input/);
    }
    await invoke(provider, { session_id: provider, hook_event_name: 'SessionEnd' });
    assert.equal((await recorded()).length, 0);
  }
  if (process.platform === 'win32') {
    const quote = value => `'${value.replaceAll("'", "''")}'`;
    const script = `$OutputEncoding=[Text.UTF8Encoding]::new($false);[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);$payload=[Console]::In.ReadToEnd();$payload | & ${quote(executable)} '--yousage-session-event' 'codex' ${quote(directory)} | Out-Null;exit $LASTEXITCODE`;
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    await new Promise((resolveCall, reject) => {
      const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], { windowsHide: true });
      child.on('error', reject);
      child.on('exit', code => code === 0 ? resolveCall() : reject(new Error(`PowerShell hook exited ${code}`)));
      child.stdin.end(JSON.stringify({ session_id: 'windows-shell-test', cwd: String.raw`C:\Private\项目-notes`, hook_event_name: 'UserPromptSubmit' }));
    });
    const [session] = await recorded();
    assert.equal(session.status, 'working');
    assert.equal(session.label, '项目-notes');
    await invoke('codex', { session_id: 'windows-shell-test', hook_event_name: 'SessionEnd' });
  }
  for (const [event, extra, status] of [
    ['SessionStart', {}, 'rest'],
    ['PreInvocation', {}, 'working'],
    ['StatusLine', { agent_state: 'reviewing', tool_confirmation_pending: true }, 'needsPermission'],
    ['StatusLine', { agent_state: 'working' }, 'working'],
    ['Stop', { fullyIdle: false }, 'working'],
    ['Stop', { fullyIdle: true, terminationReason: 'model_stop' }, 'finished'],
    ['StatusLine', { agent_state: 'idle' }, 'finished'],
  ]) {
    await invoke('antigravity', { conversationId: 'agy-test', workspacePaths: [String.raw`C:\Private\agy-project`], ...extra }, event);
    const [session] = await recorded();
    assert.equal(session.status, status);
    assert.equal(session.provider, 'antigravity');
    assert.equal(session.label, 'agy-project');
  }
  await writeFile(join(root, 'antigravity-statusline.json'), JSON.stringify({ command: 'echo original-status' }));
  const forwarded = await invoke('antigravity', { session_id: 'agy-test', cwd: String.raw`C:\Private\agy-project`, agent_state: 'idle' }, 'StatusLine');
  assert.equal(forwarded.trim(), 'original-status', 'an existing Antigravity status line must retain its output');
  console.log('Native session events passed: all providers, lifecycle, permission state, fully-idle completion, metadata privacy, and custom status-line forwarding.');
} finally {
  const target = resolve(root);
  assert.ok(target.startsWith(resolve(tmpdir()) + sep) && basename(target).startsWith('yousage-session-test-'));
  await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
}
