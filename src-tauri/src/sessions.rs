use crate::state::{self, AppState};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs, io::Read, path::Path};
use tauri::{AppHandle, Emitter, Manager};
use base64::{engine::general_purpose::STANDARD, Engine};

const MARKER: &str = "--yousage-session-event";

fn our_handler(handler: &Value) -> bool {
    let command = handler["command"].as_str().unwrap_or_default();
    command.contains(MARKER) || handler["args"].as_array().is_some_and(|args| args.iter().any(|arg| arg == MARKER))
        || command.split_once(" -EncodedCommand ").and_then(|(_, encoded)| STANDARD.decode(encoded).ok()).and_then(|bytes| String::from_utf16(&bytes.chunks_exact(2).map(|bytes| u16::from_le_bytes([bytes[0], bytes[1]])).collect::<Vec<_>>()).ok()).is_some_and(|script| script.contains(MARKER))
}

fn hook_command(exe: &str, directory: &str, provider: &str) -> String {
    if cfg!(windows) && provider == "codex" {
        // Works regardless of the shell selected by Codex on Windows. PowerShell
        // needs its call operator for a quoted executable path with spaces.
        // A pipeline waits for a GUI-subsystem executable and forwards stdin;
        // a bare call operator may return before that executable has finished.
        let script = format!("$OutputEncoding=[Text.UTF8Encoding]::new($false);[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);$payload=[Console]::In.ReadToEnd();$payload | & '{}' '{MARKER}' '{provider}' '{}' | Out-Null;exit $LASTEXITCODE", exe.replace('\'', "''"), directory.replace('\'', "''"));
        let encoded = STANDARD.encode(script.encode_utf16().flat_map(u16::to_le_bytes).collect::<Vec<_>>());
        format!("powershell.exe -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand {encoded}")
    } else {
        let prefix = if cfg!(windows) && provider == "antigravity" { "call " } else { "" };
        format!("{prefix}\"{exe}\" {MARKER} {provider} \"{directory}\"")
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub provider: String,
    pub label: String,
    #[serde(default)]
    pub title: Option<String>,
    pub status: String,
    pub started_at: u64,
    pub updated_at: u64,
    #[serde(default)]
    owner: Option<(u32, u64)>,
}

fn event_status(event: &Value) -> Option<&'static str> {
    match event["hook_event_name"].as_str()? {
        "SessionStart" | "Interrupt" | "StopFailure" => Some("rest"),
        "Stop" => Some("finished"),
        "SessionEnd" => Some("ended"),
        "PermissionRequest" => Some("needsPermission"),
        "Notification" => match event["notification_type"].as_str()? {
            "permission_prompt" | "elicitation_dialog" | "elicitation_url_dialog" | "agent_needs_input" => Some("needsPermission"),
            "idle_prompt" => Some("rest"),
            _ => None,
        },
        "PreToolUse" if matches!(event["tool_name"].as_str(), Some("AskUserQuestion" | "request_user_input" | "request_user_input_async")) => Some("needsPermission"),
        "UserPromptSubmit" | "PreToolUse" | "PostToolUse" | "PostToolUseFailure" => Some("working"),
        _ => None,
    }
}

fn record_event(directory: &Path, provider: &str, event: &Value) -> Result<(), String> {
    if !matches!(provider, "codex" | "claude" | "antigravity") { return Err("Unknown session provider.".into()); }
    let Some(status) = event_status(event) else { return Ok(()); };
    let session_id = event["session_id"].as_str().filter(|id| !id.is_empty()).ok_or("Missing session identity.")?;
    let id = format!("{:x}", Sha256::digest(format!("{provider}:{session_id}")));
    let path = directory.join(format!("{id}.json"));
    if status == "ended" { let _ = fs::remove_file(path); return Ok(()); }
    let previous = fs::read(&path).ok().and_then(|bytes| serde_json::from_slice::<Session>(&bytes).ok());
    let label = event["cwd"].as_str().and_then(|cwd| cwd.trim_end_matches(['/', '\\']).rsplit(['/', '\\']).next()).filter(|name| !name.is_empty())
        .or_else(|| previous.as_ref().map(|session| session.label.as_str()))
        .unwrap_or(match provider { "codex" => "Codex", "antigravity" => "Antigravity", _ => "Claude Code" }).chars().filter(|c| !c.is_control()).take(48).collect();
    let at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
    let status = if event["yousage_idle"].as_bool() == Some(true) {
        if previous.as_ref().is_some_and(|session| matches!(session.status.as_str(), "working" | "needsPermission" | "finished")) { "finished" } else { "rest" }
    } else if event["hook_event_name"] == "PreToolUse" && previous.as_ref().is_some_and(|session| session.status == "needsPermission") {
        "needsPermission"
    } else { status };
    let title = ["conversation_title", "session_title", "thread_title"].iter().find_map(|key| event[key].as_str()).filter(|title| !title.trim().is_empty()).map(|title| title.chars().filter(|c| !c.is_control()).take(96).collect())
        .or_else(|| previous.as_ref().and_then(|session| session.title.clone()))
        .or_else(|| if provider == "codex" && matches!(event["hook_event_name"].as_str(), Some("SessionStart" | "UserPromptSubmit" | "Stop")) { read_codex_title(event["thread_id"].as_str().unwrap_or(session_id)) } else { None });
    let session = Session { id, provider: provider.into(), label, title, status: status.into(), started_at: previous.as_ref().map(|session| session.started_at).unwrap_or(at), updated_at: at, owner: owner_process(provider).or_else(|| previous.and_then(|session| session.owner)) };
    fs::create_dir_all(directory).map_err(|_| "Could not create the session status folder.")?;
    state::atomic_write(&path, &serde_json::to_vec(&session).unwrap())
}

fn read_codex_title(id: &str) -> Option<String> {
    if uuid::Uuid::parse_str(id).is_err() && !(id.starts_with("thr_") && id.len() <= 128 && id.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte))) { return None; }
    let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().ok()?;
    runtime.block_on(async {
        tokio::time::timeout(std::time::Duration::from_millis(1000), async {
            let mut rpc = crate::rpc::Rpc::start(&crate::rpc::desktop_home(), false).await.ok()?;
            // Summary metadata only: do not subscribe, resume, or load turns.
            let response = rpc.request("thread/read", json!({"threadId":id,"includeTurns":false})).await.ok()?;
            response["thread"]["name"].as_str().filter(|name| !name.trim().is_empty()).map(|name| name.chars().filter(|c| !c.is_control()).take(96).collect())
        }).await.ok().flatten()
    })
}

// This path runs before Tauri, never opens a window and never prints prompts,
// tool arguments, transcript contents, tokens, or permission decisions.
pub fn handle_hook() -> bool {
    let args: Vec<_> = std::env::args().collect();
    if args.get(1).map(String::as_str) != Some(MARKER) { return false; }
    if let (Some(provider), Some(directory)) = (args.get(2), args.get(3)) {
        let mut input = String::new();
        if std::io::stdin().take(1_048_576).read_to_string(&mut input).is_ok() {
            if let Ok(event) = serde_json::from_str(&input) {
                if provider == "antigravity" {
                    if let Some(normalized) = antigravity_event(&event, args.get(4).map(String::as_str).unwrap_or("")) { let _ = record_event(Path::new(directory), provider, &normalized); }
                } else { let _ = record_event(Path::new(directory), provider, &event); }
            }
        }
        if provider == "antigravity" && args.get(4).map(String::as_str) == Some("StatusLine") {
            run_original_statusline(Path::new(directory), &input);
            return true;
        }
    }
    // An empty JSON result is neutral, including for Codex Stop hooks.
    println!("{{}}");
    true
}

fn antigravity_event(event: &Value, name: &str) -> Option<Value> {
    let id = event["conversationId"].as_str().or_else(|| event["session_id"].as_str()).filter(|id| !id.is_empty())?;
    let cwd = event["workspacePaths"][0].as_str().or_else(|| event["cwd"].as_str());
    let hook = match name {
        "StatusLine" if event["tool_confirmation_pending"].as_bool() == Some(true) || event["agent_state"] == "reviewing" => "PermissionRequest",
        "StatusLine" => match event["agent_state"].as_str()? {
            "working" | "tool_use" => "UserPromptSubmit",
            "idle" => "SessionStart",
            _ => "Interrupt",
        },
        "SessionStart" => "SessionStart",
        "PreInvocation" | "PostToolUse" => "UserPromptSubmit",
        "PreToolUse" if matches!(event["toolCall"]["name"].as_str(), Some("ask_permission" | "ask_question")) || (event["toolCall"]["name"] == "notify_user" && event["toolCall"]["args"]["BlockedOnUser"] == true) => "PermissionRequest",
        "PreToolUse" => "PreToolUse",
        "Stop" if event["fullyIdle"] == false => "UserPromptSubmit",
        "Stop" if event["terminationReason"] == "error" => "Interrupt",
        "Stop" => "Stop",
        _ => return None,
    };
    Some(json!({"session_id":id,"cwd":cwd,"conversation_title":event["conversation_title"],"hook_event_name":hook,"yousage_idle": name == "StatusLine" && event["agent_state"] == "idle"}))
}

fn run_original_statusline(directory: &Path, input: &str) {
    use std::{io::Write, process::{Command, Stdio}};
    let original = fs::read(directory.parent().unwrap_or(directory).join("antigravity-statusline.json")).ok().and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());
    let Some(original) = original else { return; };
    if original["enabled"] == false { return; }
    let Some(command) = original["command"].as_str().filter(|command| !command.contains(MARKER)) else { return; };
    let mut process = if cfg!(windows) {
        let mut process = Command::new("cmd.exe"); process.args(["/D", "/S", "/C", command]); process
    } else { let mut process = Command::new("sh"); process.args(["-c", command]); process };
    process.stdin(Stdio::piped()).stdout(Stdio::inherit()).stderr(Stdio::null());
    #[cfg(windows)]
    { use std::os::windows::process::CommandExt; process.creation_flags(0x08000000); }
    if let Ok(mut child) = process.spawn() {
        if let Some(mut stdin) = child.stdin.take() { let _ = stdin.write_all(input.as_bytes()); }
        let _ = child.wait();
    }
}

fn merge_antigravity_hooks(mut value: Value, command: &str, enabled: bool) -> Result<Value, String> {
    let object = value.as_object_mut().ok_or("Antigravity hooks have an unsupported format. Settings were preserved.")?;
    if let Some(existing) = object.get("yousage-session-status") {
        if !existing.to_string().contains(MARKER) { return Err("An unrelated Antigravity hook uses YouSage's hook name. Rename it before enabling status.".into()); }
    }
    object.remove("yousage-session-status");
    if enabled {
        let handler = |name: &str| json!({"type":"command","command":format!("{command} {name}"),"timeout":2});
        object.insert("yousage-session-status".into(), json!({
            "SessionStart":[handler("SessionStart")],"PreInvocation":[handler("PreInvocation")],"Stop":[handler("Stop")],
            "PreToolUse":[{"matcher":"*","hooks":[handler("PreToolUse")]}],
            "PostToolUse":[{"matcher":"*","hooks":[handler("PostToolUse")]}],
        }));
    }
    Ok(value)
}

fn merge_hooks(mut value: Value, command: &str, enabled: bool, provider: &str) -> Result<Value, String> {
    if !value.is_object() { return Err("Hook settings are not a JSON object. Existing settings were preserved.".into()); }
    if value.get("hooks").is_none() { value["hooks"] = json!({}); }
    let hooks = value["hooks"].as_object_mut().ok_or("Existing hooks have an unsupported format. Settings were preserved.")?;
    // Remove only our command entries; keep other commands even in a shared group.
    for entries in hooks.values_mut() {
        let entries = entries.as_array_mut().ok_or("Existing hook entries have an unsupported format. Settings were preserved.")?;
        for entry in entries.iter_mut() {
            if let Some(handlers) = entry["hooks"].as_array_mut() { handlers.retain(|handler| !our_handler(handler)); }
        }
        entries.retain(|entry| entry["hooks"].as_array().is_none_or(|handlers| !handlers.is_empty()));
    }
    hooks.retain(|_, entries| entries.as_array().is_none_or(|entries| !entries.is_empty()));
    if enabled {
        let events = if provider == "claude" {
            vec!["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest", "Notification", "Stop", "StopFailure"]
        } else { vec!["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PermissionRequest", "Stop", "Interrupt"] };
        for event in events {
            let entries = hooks.entry(event).or_insert_with(|| json!([])).as_array_mut().ok_or("Existing hook entries are invalid.")?;
            entries.push(json!({"hooks":[{"type":"command", "command":command, "timeout":2}]}));
        }
    }
    Ok(value)
}

#[tauri::command]
pub async fn set_session_tracking(app: AppHandle, enabled: bool) -> Result<(), String> {
    let state = app.state::<AppState>();
    let _guard = state.io.lock().await;
    let exe = std::env::current_exe().map_err(|_| "YouSage's executable is unavailable.")?.to_string_lossy().replace('\\', "/");
    let directory = state.directory.join("sessions");
    let directory_arg = directory.to_string_lossy().replace('\\', "/");
    if [exe.as_str(), directory_arg.as_str()].iter().any(|value| value.contains(['"', '$', '`', '%', '\n', '\r'])) { return Err("YouSage's path contains characters unsupported by hook commands.".into()); }
    let paths = [(crate::rpc::desktop_home().join("hooks.json"), "codex"), (crate::claude::config_directory().join("settings.json"), "claude"), (crate::rpc::antigravity_home().join("config/hooks.json"), "antigravity")];
    let mut changes = Vec::new();
    for (path, provider) in paths {
        let previous = match fs::read(&path) { Ok(bytes) => Some(bytes), Err(error) if error.kind() == std::io::ErrorKind::NotFound => None, Err(_) => return Err("Could not read existing hook settings. Settings were preserved.".into()) };
        let value = previous.as_ref().map(|bytes| serde_json::from_slice(bytes)).transpose().map_err(|_| "Existing hook settings contain invalid JSON. Settings were preserved.")?.unwrap_or_else(|| json!({}));
        let command = hook_command(&exe, &directory_arg, provider);
        let mut next = if provider == "antigravity" { merge_antigravity_hooks(value, &command, enabled)? } else { merge_hooks(value, &command, enabled, provider)? };
        if provider == "claude" && enabled {
            for entries in next["hooks"].as_object_mut().unwrap().values_mut() {
                for entry in entries.as_array_mut().unwrap() {
                    if let Some(handlers) = entry["hooks"].as_array_mut() {
                        for handler in handlers.iter_mut().filter(|handler| handler["command"] == command) {
                            handler["command"] = json!(exe);
                            handler["args"] = json!([MARKER, provider, directory_arg]);
                        }
                    }
                }
            }
        }
        changes.push((path, previous, serde_json::to_vec_pretty(&next).unwrap()));
    }
    // The CLI's status line provides exact permission/idle state. Stack a silent
    // observer with the default line, or preserve and forward a custom script.
    let path = crate::rpc::antigravity_home().join("antigravity-cli/settings.json");
    let previous = fs::read(&path).ok();
    let mut settings: Value = previous.as_ref().map(|bytes| serde_json::from_slice(bytes)).transpose().map_err(|_| "Antigravity settings contain invalid JSON. Settings were preserved.")?.unwrap_or_else(|| json!({}));
    if !settings.is_object() { return Err("Antigravity settings have an unsupported format.".into()); }
    let backup_path = state.directory.join("antigravity-statusline.json");
    let already_installed = settings["statusLine"]["command"].as_str().is_some_and(|command| command.contains(MARKER));
    if enabled {
        if !already_installed {
            changes.push((backup_path.clone(), fs::read(&backup_path).ok(), serde_json::to_vec(&settings["statusLine"]).unwrap()));
        } else if !backup_path.exists() { return Err("The original Antigravity status line backup is missing. Restore it before enabling status again.".into()); }
        let mut observer = settings["statusLine"].as_object().cloned().unwrap_or_default();
        let prefix = if cfg!(windows) { "call " } else { "" };
        observer.insert("command".into(), json!(format!("{prefix}\"{exe}\" {MARKER} antigravity \"{directory_arg}\" StatusLine")));
        observer.insert("enabled".into(), json!(true));
        if settings["statusLine"]["command"].is_null() { observer.insert("stack_with_default".into(), json!(true)); }
        settings["statusLine"] = Value::Object(observer);
    } else if already_installed {
        let original = fs::read(&backup_path).ok().and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok()).ok_or("The original Antigravity status line backup is missing. Settings were preserved.")?;
        if original.is_null() { settings.as_object_mut().unwrap().remove("statusLine"); } else { settings["statusLine"] = original; }
    }
    changes.push((path, previous, serde_json::to_vec_pretty(&settings).unwrap()));
    commit_changes(&changes)?;
    state.config.lock().unwrap().sessions_enabled = enabled;
    state.snapshot.lock().unwrap().settings.sessions_enabled = enabled;
    if !enabled { let _ = clear_events(&directory); let _ = app.emit("sessions-updated", Vec::<Session>::new()); }
    state.persist()?; state.emit(&app);
    Ok(())
}

fn commit_changes(changes: &[(std::path::PathBuf, Option<Vec<u8>>, Vec<u8>)]) -> Result<(), String> {
    for (index, (path, _, next)) in changes.iter().enumerate() {
        let result = path.parent().map(fs::create_dir_all).transpose().map_err(|_| "Could not create the hook settings folder.".to_owned())
            .and_then(|_| state::atomic_write(path, next));
        if let Err(error) = result {
            let mut restored = true;
            for (path, previous, _) in changes.iter().take(index).rev() {
                let result = if let Some(bytes) = previous { state::atomic_write(path, bytes) } else { fs::remove_file(path).map_err(|_| "Could not remove an incomplete hook setting.".into()) };
                restored &= result.is_ok();
            }
            return Err(if restored { error } else { "Could not save all hooks or restore some earlier settings. Check the hook configuration files before retrying.".into() });
        }
    }
    Ok(())
}

fn clear_events(directory: &Path) -> std::io::Result<()> {
    if directory.is_dir() { for entry in fs::read_dir(directory)?.flatten() { if entry.path().extension().is_some_and(|ext| ext == "json") { fs::remove_file(entry.path())?; } } }
    Ok(())
}

fn read_sessions(directory: &Path) -> Vec<Session> {
    let mut sessions = Vec::new();
    if let Ok(entries) = fs::read_dir(directory) {
        for entry in entries.flatten().take(512) {
            if entry.path().extension().is_none_or(|ext| ext != "json") { continue; }
            let session = fs::read(entry.path()).ok().filter(|bytes| bytes.len() < 4096).and_then(|bytes| serde_json::from_slice::<Session>(&bytes).ok());
            if let Some(session) = session {
                let age = (state::now().max(0) as u64 * 1000).saturating_sub(session.updated_at);
                if age < 86_400_000 && session.owner.is_none_or(process_alive) { sessions.push(session); }
                else { let _ = fs::remove_file(entry.path()); }
            }
        }
    }
    sessions.sort_by(|a, b| a.started_at.cmp(&b.started_at).then_with(|| a.id.cmp(&b.id)));
    sessions
}

pub fn watch(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut previous = Vec::new();
        loop {
            let enabled = app.state::<AppState>().config.lock().unwrap().sessions_enabled;
            let sessions = if enabled { read_sessions(&app.state::<AppState>().directory.join("sessions")) } else { vec![] };
            if sessions.len() != previous.len() || sessions.iter().zip(&previous).any(|(current, old): (&Session, &Session)| current.id != old.id || current.label != old.label || current.title != old.title || current.status != old.status || current.provider != old.provider) {
                let _ = app.emit("sessions-updated", &sessions);
                previous = sessions;
            }
            tokio::time::sleep(std::time::Duration::from_millis(750)).await;
        }
    });
}

#[tauri::command]
pub fn get_sessions(state: tauri::State<'_, AppState>) -> Vec<Session> {
    if state.config.lock().unwrap().sessions_enabled { read_sessions(&state.directory.join("sessions")) } else { vec![] }
}

#[cfg(windows)]
fn process_time(pid: u32) -> Option<u64> {
    use windows_sys::Win32::{Foundation::{CloseHandle, FILETIME}, System::Threading::{OpenProcess, GetProcessTimes, PROCESS_QUERY_LIMITED_INFORMATION}};
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() { return None; }
        let mut creation = FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 };
        let (mut exit, mut kernel, mut user) = (creation, creation, creation);
        let result = GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user);
        CloseHandle(handle);
        (result != 0 && exit.dwHighDateTime == 0 && exit.dwLowDateTime == 0).then_some((creation.dwHighDateTime as u64) << 32 | creation.dwLowDateTime as u64)
    }
}

#[cfg(windows)]
fn owner_process(provider: &str) -> Option<(u32, u64)> {
    use windows_sys::Win32::{Foundation::{CloseHandle, INVALID_HANDLE_VALUE}, System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS}};
    unsafe {
        let handle = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if handle == INVALID_HANDLE_VALUE { return None; }
        let mut entries = std::collections::HashMap::new();
        let mut entry: PROCESSENTRY32W = std::mem::zeroed(); entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut found = Process32FirstW(handle, &mut entry);
        while found != 0 {
            let len = entry.szExeFile.iter().position(|c| *c == 0).unwrap_or(entry.szExeFile.len());
            entries.insert(entry.th32ProcessID, (entry.th32ParentProcessID, String::from_utf16_lossy(&entry.szExeFile[..len]).to_ascii_lowercase()));
            found = Process32NextW(handle, &mut entry);
        }
        CloseHandle(handle);
        let mut pid = std::process::id();
        for _ in 0..32 {
            let (parent, _) = entries.get(&pid)?; pid = *parent;
            let (_, name) = entries.get(&pid)?;
            if (provider == "codex" && name == "codex.exe") || (provider == "claude" && matches!(name.as_str(), "claude.exe" | "node.exe")) || (provider == "antigravity" && matches!(name.as_str(), "agy.exe" | "antigravity.exe")) { return process_time(pid).map(|time| (pid, time)); }
        }
        None
    }
}
#[cfg(not(windows))]
fn owner_process(_: &str) -> Option<(u32, u64)> { None }
#[cfg(windows)]
fn process_alive((pid, time): (u32, u64)) -> bool { process_time(pid) == Some(time) }
#[cfg(not(windows))]
fn process_alive(_: (u32, u64)) -> bool { true }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn lifecycle_does_not_treat_any_notification_as_a_permission() {
        for (event, status) in [("SessionStart", "rest"), ("UserPromptSubmit", "working"), ("PermissionRequest", "needsPermission"), ("PostToolUse", "working"), ("Stop", "finished"), ("SessionEnd", "ended")] {
            assert_eq!(event_status(&json!({"hook_event_name":event})), Some(status));
        }
        assert_eq!(event_status(&json!({"hook_event_name":"Notification", "notification_type":"auth_success"})), None);
        assert_eq!(event_status(&json!({"hook_event_name":"PreToolUse", "tool_name":"AskUserQuestion"})), Some("needsPermission"));
    }
    #[test]
    fn installation_preserves_other_settings_and_is_idempotent() {
        let original = json!({"permissions":{"allow":["Read"]},"hooks":{"Stop":[{"hooks":[{"type":"command","command":"existing-hook"}]}]}});
        let once = merge_hooks(original, "yousage --yousage-session-event claude directory", true, "claude").unwrap();
        let twice = merge_hooks(once.clone(), "yousage --yousage-session-event claude directory", true, "claude").unwrap();
        assert_eq!(once, twice);
        let removed = merge_hooks(twice, "", false, "claude").unwrap();
        assert_eq!(removed["hooks"]["Stop"][0]["hooks"][0]["command"], "existing-hook");
        assert_eq!(removed["permissions"]["allow"][0], "Read");
        let command = hook_command("D:/Program Files/YouSage.exe", "D:/Status folder", "codex");
        let native = merge_hooks(json!({}), &command, true, "codex").unwrap();
        assert_eq!(merge_hooks(native, "", false, "codex").unwrap(), json!({"hooks":{}}));
        let exec_form = json!({"hooks":{"Stop":[{"hooks":[{"command":"D:/Program Files/YouSage.exe","args":[MARKER,"claude","directory"]}]}]}});
        assert_eq!(merge_hooks(exec_form, "", false, "claude").unwrap(), json!({"hooks":{}}));
    }
    #[test]
    fn hook_install_rolls_back_prior_files_when_a_later_folder_cannot_be_created() {
        let directory = tempfile::tempdir().unwrap();
        let first = directory.path().join("hooks.json");
        let blocker = directory.path().join("blocked");
        fs::write(&first, b"original").unwrap(); fs::write(&blocker, b"file").unwrap();
        let changes = vec![(first.clone(), Some(b"original".to_vec()), b"replacement".to_vec()), (blocker.join("settings.json"), None, b"new".to_vec())];
        assert!(commit_changes(&changes).is_err());
        assert_eq!(fs::read(&first).unwrap(), b"original");
        assert_eq!(fs::read(&blocker).unwrap(), b"file");
    }
    #[test]
    fn antigravity_uses_live_confirmation_and_fully_idle_signals() {
        let pending = antigravity_event(&json!({"session_id":"one","agent_state":"working","tool_confirmation_pending":true}), "StatusLine").unwrap();
        assert_eq!(event_status(&pending), Some("needsPermission"));
        let running = antigravity_event(&json!({"conversationId":"one","fullyIdle":false}), "Stop").unwrap();
        assert_eq!(event_status(&running), Some("working"));
        let done = antigravity_event(&json!({"conversationId":"one","fullyIdle":true,"terminationReason":"model_stop"}), "Stop").unwrap();
        assert_eq!(event_status(&done), Some("finished"));
        let notification = antigravity_event(&json!({"conversationId":"one","toolCall":{"name":"notify_user","args":{"BlockedOnUser":false}}}), "PreToolUse").unwrap();
        assert_eq!(event_status(&notification), Some("working"));
        let original = json!({"existing-hook":{"Stop":[{"command":"other"}]}});
        let installed = merge_antigravity_hooks(original.clone(), "app --yousage-session-event antigravity dir", true).unwrap();
        assert!(installed["yousage-session-status"]["PreToolUse"][0]["hooks"][0]["command"].as_str().unwrap().ends_with("PreToolUse"));
        assert_eq!(merge_antigravity_hooks(installed, "", false).unwrap(), original);
    }
    #[test]
    fn session_files_store_only_status_and_project_basename_and_end_removes_them() {
        let directory = tempfile::tempdir().unwrap();
        record_event(directory.path(), "claude", &json!({"session_id":"private-id", "cwd":"C:\\Private\\project", "hook_event_name":"UserPromptSubmit", "prompt":"secret prompt", "tool_input":{"command":"secret command"}})).unwrap();
        let entries: Vec<_> = fs::read_dir(directory.path()).unwrap().flatten().collect();
        let bytes = fs::read_to_string(entries[0].path()).unwrap();
        assert!(!bytes.contains("private-id") && !bytes.contains("Private") && !bytes.contains("secret"));
        let session: Session = serde_json::from_str(&bytes).unwrap();
        assert_eq!(session.label, "project"); assert_eq!(session.status, "working");
        record_event(directory.path(), "claude", &json!({"session_id":"private-id", "hook_event_name":"Stop"})).unwrap();
        let updated: Session = serde_json::from_slice(&fs::read(entries[0].path()).unwrap()).unwrap();
        assert_eq!(session.started_at, updated.started_at); assert_eq!(updated.status, "finished");
        record_event(directory.path(), "claude", &json!({"session_id":"private-id", "hook_event_name":"SessionEnd"})).unwrap();
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 0);
    }
    #[test]
    fn supplied_conversation_titles_persist_across_tool_events() {
        let directory = tempfile::tempdir().unwrap();
        record_event(directory.path(), "antigravity", &json!({"session_id":"named-session", "cwd":"D:/project", "hook_event_name":"UserPromptSubmit", "conversation_title":"Build the smaller notch"})).unwrap();
        record_event(directory.path(), "antigravity", &json!({"session_id":"named-session", "hook_event_name":"PostToolUse"})).unwrap();
        let sessions = read_sessions(directory.path());
        assert_eq!(sessions[0].title.as_deref(), Some("Build the smaller notch"));
        assert_eq!(sessions[0].label, "project");
    }
}
