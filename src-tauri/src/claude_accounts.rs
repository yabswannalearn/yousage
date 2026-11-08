use crate::{claude, model::{ClaudeAccount, ClaudeStatus}, processes, state::{self, AppState, Profile}, switching::SwitchPlan};
use serde_json::{json, Value};
use std::{fs, path::{Path, PathBuf}, sync::atomic::Ordering};
use tauri::{AppHandle, Manager};
use zeroize::Zeroizing;

// Saved credentials are encrypted for the current Windows user. The active
// .credentials.json stays in Claude Code's own format and location.
#[cfg(windows)]
fn crypt(bytes: &[u8], encrypt: bool) -> Result<Zeroizing<Vec<u8>>, String> {
    use windows_sys::Win32::{Foundation::LocalFree, Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN}};
    let input = CRYPT_INTEGER_BLOB { cbData: bytes.len() as u32, pbData: bytes.as_ptr() as *mut u8 };
    let mut output = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
    let ok = unsafe {
        if encrypt { CryptProtectData(&input, std::ptr::null(), std::ptr::null(), std::ptr::null_mut(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut output) }
        else { CryptUnprotectData(&input, std::ptr::null_mut(), std::ptr::null(), std::ptr::null_mut(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut output) }
    };
    if ok == 0 { return Err("Windows could not access this saved Claude sign-in. Save it again from Claude Code.".into()); }
    let result = Zeroizing::new(unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec());
    // DPAPI allocates a second plaintext buffer when decrypting.
    unsafe { std::ptr::write_bytes(output.pbData, 0, output.cbData as usize); LocalFree(output.pbData.cast()); }
    Ok(result)
}

#[cfg(not(windows))]
fn crypt(_: &[u8], _: bool) -> Result<Zeroizing<Vec<u8>>, String> { Err("Saved Claude accounts require Windows.".into()) }

fn profile_path(state: &AppState, id: &str) -> Result<PathBuf, String> {
    if uuid::Uuid::parse_str(id).is_err() { return Err("Invalid saved Claude account.".into()); }
    Ok(state.directory.join("claude-accounts").join(format!("{id}.bin")))
}

fn read_profile(state: &AppState, id: &str) -> Result<Value, String> {
    let bytes = fs::read(profile_path(state, id)?).map_err(|_| "This saved Claude sign-in is missing. Save it again.".to_owned())?;
    serde_json::from_slice(&crypt(&bytes, false)?).map_err(|_| "This Claude sign-in could not be read. Save it again.".into())
}

pub fn account_settings_path(directory: &Path) -> PathBuf {
    if directory.join(".claude.json").exists() { directory.join(".claude.json") } else { directory.with_extension("json") }
}

fn settings(directory: &Path) -> Result<Value, String> {
    let path = account_settings_path(directory);
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| "Claude account settings could not be read. No sign-in was changed.".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(json!({})),
        Err(_) => Err("Claude account settings could not be read. No sign-in was changed.".into()),
    }
}

fn current_payload() -> Result<Value, String> {
    let directory = claude::config_directory();
    let bytes = Zeroizing::new(fs::read(directory.join(".credentials.json")).map_err(|_| "Sign in with `claude auth login` first.".to_owned())?);
    let credentials: Value = serde_json::from_slice(&bytes).map_err(|_| "Claude credentials could not be read.".to_owned())?;
    let oauth_account = settings(&directory)?["oauthAccount"].clone();
    if oauth_account["emailAddress"].as_str().is_none() || credentials["claudeAiOauth"]["accessToken"].as_str().is_none() {
        return Err("Sign in to a Claude subscription with `claude auth login` before saving this account.".into());
    }
    Ok(json!({"credentials": credentials, "oauthAccount": oauth_account}))
}

fn save_payload(state: &AppState, payload: &Value, label: String) -> Result<String, String> {
    let email = payload["oauthAccount"]["emailAddress"].as_str().ok_or("Claude account identity is unavailable.")?;
    let profiles = state.config.lock().unwrap().claude_profiles.clone();
    let existing = profiles.iter().find(|p| read_profile(state, &p.id).ok().is_some_and(|saved| saved["oauthAccount"]["emailAddress"].as_str().is_some_and(|old| old.eq_ignore_ascii_case(email))));
    let id = existing.map(|p| p.id.clone()).unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let bytes = Zeroizing::new(serde_json::to_vec(payload).map_err(|_| "Could not save Claude sign-in.".to_owned())?);
    state::atomic_write(&profile_path(state, &id)?, &crypt(&bytes, true)?)?;
    let mut config = state.config.lock().unwrap();
    config.claude_profiles.retain(|p| p.id != id);
    config.claude_profiles.push(Profile { id: id.clone(), label });
    Ok(id)
}

pub fn sync_accounts(state: &AppState) {
    let profiles = state.config.lock().unwrap().claude_profiles.clone();
    let email = state.snapshot.lock().unwrap().claude.email.clone();
    let accounts = profiles.iter().filter_map(|p| {
        let saved = read_profile(state, &p.id).ok()?;
        let saved_email = saved["oauthAccount"]["emailAddress"].as_str()?.to_owned();
        Some(ClaudeAccount { id: p.id.clone(), label: p.label.clone(), active: email.as_ref().is_some_and(|email| email.eq_ignore_ascii_case(&saved_email)), email: saved_email })
    }).collect();
    state.snapshot.lock().unwrap().claude.accounts = accounts;
}

#[tauri::command]
pub async fn save_claude_account(app: AppHandle, label: String) -> Result<(), String> {
    let label: String = label.trim().chars().take(48).collect();
    if label.is_empty() { return Err("Enter a name for this Claude account.".into()); }
    let state = app.state::<AppState>();
    let _guard = state.io.lock().await;
    save_payload(&state, &current_payload()?, label)?;
    sync_accounts(&state); state.persist()?; state.emit(&app);
    Ok(())
}

#[tauri::command]
pub async fn prepare_claude_switch(app: AppHandle, id: String) -> Result<SwitchPlan, String> {
    let state = app.state::<AppState>();
    if state.switch_running.load(Ordering::SeqCst) || state.login_running.load(Ordering::SeqCst) { return Err("Finish the current sign-in or switch first.".into()); }
    let profile = state.config.lock().unwrap().claude_profiles.iter().find(|p| p.id == id).cloned().ok_or("Save this Claude account before switching to it.")?;
    let runtime = processes::inspect(processes::Provider::Claude).await?;
    Ok(SwitchPlan { id, label: profile.label, provider: "claude", desktop_running: false, cli_running: runtime.cli_running, process_names: runtime.session_names() })
}

#[tauri::command]
pub async fn switch_claude_account(app: AppHandle, id: String, restart_desktop: bool) -> Result<(), String> {
    switch_with_request(app, id, restart_desktop, None).await
}

pub async fn switch_with_request(app: AppHandle, id: String, restart_desktop: bool, automatic: Option<crate::auto_switch::Request>) -> Result<(), String> {
    let state = app.state::<AppState>();
    if state.login_running.load(Ordering::SeqCst) { return Err("Finish the current sign-in first.".into()); }
    if state.switch_running.swap(true, Ordering::SeqCst) { return Err("An account switch is already running.".into()); }
    state.snapshot.lock().unwrap().switching = Some("Preparing the Claude Code account switch…".into()); state.emit(&app);
    let result = async {
        let _guard = state.io.lock().await;
        if !state.config.lock().unwrap().claude_profiles.iter().any(|p| p.id == id) { return Err("This saved Claude account is unavailable.".into()); }
        let payload = read_profile(&state, &id)?;
        let oauth = &payload["credentials"]["claudeAiOauth"];
        if oauth["expiresAt"].as_i64().is_some_and(|expires| expires <= state::now() * 1000) { return Err("This saved Claude sign-in expired. Sign in with `claude auth login`, then save it again.".into()); }
        let token = oauth["accessToken"].as_str().filter(|token| !token.is_empty() && token.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))).ok_or("The saved Claude sign-in is invalid.")?;
        if state.snapshot.lock().unwrap().health.claude.status == crate::usage::HealthStatus::RateLimited && state.claude_next_refresh.load(Ordering::SeqCst) > state::now() as u64 {
            return Err("Claude requested a retry cooldown. Wait for the retry time in Connection health before switching.".into());
        }
        let usage = match claude::fetch_usage(token).await {
            Ok(usage) => usage,
            Err((error, delay)) => {
                if delay >= 900 {
                    let next = (state::now() as u64).saturating_add(delay);
                    state.claude_next_refresh.store(next, Ordering::SeqCst);
                    let mut snapshot = state.snapshot.lock().unwrap();
                    let last_success = snapshot.claude.updated_at;
                    snapshot.health.claude.update("claude", Some(&error), last_success, Some(next.min(i64::MAX as u64) as i64));
                }
                return Err(error);
            }
        };
        let (five_hour, weekly) = claude::parse_usage(&usage)?;
        if five_hour.is_none() && weekly.is_none() && claude::model_limits(&usage).is_empty() { return Err("Claude returned no usage for this account. No sign-in was changed.".into()); }
        let directory = claude::config_directory();
        let current = if claude::config_directory().join(".credentials.json").exists() { Some(current_payload()?) } else { None };
        let email = payload["oauthAccount"]["emailAddress"].as_str().ok_or("The saved Claude identity is missing.")?.to_owned();
        if current.as_ref().is_some_and(|old| old["oauthAccount"]["emailAddress"].as_str().is_some_and(|old| old.eq_ignore_ascii_case(&email))) { return Err("Claude Code is already using this account.".into()); }
        let mut available = crate::auto_switch::windows(five_hour.as_ref(), weekly.as_ref());
        for model in claude::model_limits(&usage) { if let Some(weekly) = model.weekly { available.insert(format!("model:{}", model.id), weekly); } }
        let restart_desktop = if let Some(request) = automatic.as_ref() {
            if current.as_ref().and_then(|payload| payload["oauthAccount"]["emailAddress"].as_str()) != Some(request.identity.as_str()) { return Err("Claude's active sign-in changed. Automatic switching was cancelled.".into()); }
            crate::auto_switch::authorize(&state, request, &available)?
        } else { restart_desktop };
        let runtime = processes::inspect(processes::Provider::Claude).await?;
        if runtime.running() && !restart_desktop { return Err("Review and confirm ‘Close sessions and switch’ before closing Claude Code sessions.".into()); }
        if runtime.running() { runtime.close_sessions().await?; }
        let previous = if directory.join(".credentials.json").exists() { Some(current_payload()?) } else { None };
        if automatic.as_ref().is_some_and(|request| previous.as_ref().and_then(|payload| payload["oauthAccount"]["emailAddress"].as_str()) != Some(request.identity.as_str())) {
            return Err("Claude's active sign-in changed before replacement. Automatic switching was cancelled.".into());
        }
        if let Some(previous) = &previous {
            let previous_email = previous["oauthAccount"]["emailAddress"].as_str().unwrap_or("Claude");
            let label = state.snapshot.lock().unwrap().claude.accounts.iter().find(|account| account.email.eq_ignore_ascii_case(previous_email)).map(|account| account.label.clone()).unwrap_or_else(|| previous_email.split('@').next().unwrap_or("Claude").to_owned());
            save_payload(&state, previous, label)?;
        }
        let credential_path = directory.join(".credentials.json");
        let account_path = account_settings_path(&directory);
        let old_credentials = fs::read(&credential_path).ok().map(Zeroizing::new);
        let old_settings = fs::read(&account_path).ok();
        let mut config = settings(&directory)?;
        if !config.is_object() { return Err("Claude settings have an unsupported format. No sign-in was changed.".into()); }
        config["oauthAccount"] = payload["oauthAccount"].clone();
        let bytes = Zeroizing::new(serde_json::to_vec(&payload["credentials"]).map_err(|_| "Could not prepare the Claude sign-in.")?);
        if processes::inspect(processes::Provider::Claude).await?.running() { return Err("A Claude Code session started during the switch. No sign-in was changed. Retry after closing it.".into()); }
        if let Some(request) = automatic.as_ref() { crate::auto_switch::authorize(&state, request, &available)?; }
        let replaced = state::atomic_write(&credential_path, &bytes).and_then(|_| state::atomic_write(&account_path, &serde_json::to_vec(&config).unwrap()));
        if let Err(error) = replaced {
            let restored = restore(&credential_path, old_credentials.as_deref().map(|bytes| bytes.as_slice())).and_then(|_| restore(&account_path, old_settings.as_deref()));
            return Err(if restored.is_err() { "Claude sign-in replacement and recovery failed. Run `claude auth login` to reconnect.".into() } else { error });
        }
        {
            let mut snapshot = state.snapshot.lock().unwrap();
            snapshot.claude = ClaudeStatus { email: Some(email), plan: oauth["subscriptionType"].as_str().map(str::to_owned), five_hour, weekly, model_limits: claude::model_limits(&usage), updated_at: Some(state::now()), ..ClaudeStatus::default() };
            snapshot.health.claude.update("claude", None, Some(state::now()), Some(state::now() + 300));
        }
        state.claude_next_refresh.store(state::now() as u64 + 300, Ordering::SeqCst);
        sync_accounts(&state); state.persist()?;
        Ok(())
    }.await;
    state.switch_running.store(false, Ordering::SeqCst);
    state.snapshot.lock().unwrap().switching = None; let _ = state.persist(); state.emit(&app);
    result
}

fn restore(path: &Path, previous: Option<&[u8]>) -> Result<(), String> {
    if let Some(bytes) = previous { state::atomic_write(path, bytes) }
    else if path.exists() { fs::remove_file(path).map_err(|_| "Could not restore the previous sign-in.".into()) }
    else { Ok(()) }
}

#[tauri::command]
pub async fn disconnect_claude_account(app: AppHandle, id: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    let _guard = state.io.lock().await;
    fs::remove_file(profile_path(&state, &id)?).map_err(|_| "Could not remove this saved Claude account.".to_owned())?;
    state.config.lock().unwrap().claude_profiles.retain(|p| p.id != id);
    sync_accounts(&state); state.persist()?; state.emit(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[cfg(windows)]
    fn saved_credentials_are_encrypted_and_bound_to_windows() {
        let payload = b"dummy-claude-refresh-token";
        let encrypted = crypt(payload, true).unwrap();
        assert!(!encrypted.windows(payload.len()).any(|part| part == payload));
        assert_eq!(&*crypt(&encrypted, false).unwrap(), payload);
        assert!(crypt(b"invalid", false).is_err());
    }
}
