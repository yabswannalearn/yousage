use crate::{auth::{self, Auth, Store}, processes, rpc::{self, Rpc}, state::{self, AppState, Profile}};
use serde::Serialize;
use serde_json::json;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchPlan { pub id: String, pub label: String, pub provider: &'static str, pub desktop_running: bool, pub cli_running: bool, pub process_names: Vec<String> }

fn profile(state: &AppState, id: &str) -> Result<Profile, String> {
    state.config.lock().unwrap().profiles.iter().find(|p| p.id == id).cloned().ok_or_else(|| "Connect this account to YouSage before switching to it.".into())
}

#[tauri::command]
pub async fn prepare_switch(app: AppHandle, id: String) -> Result<SwitchPlan, String> {
    let state = app.state::<AppState>();
    if state.login_running.load(Ordering::SeqCst) || state.switch_running.load(Ordering::SeqCst) { return Err("Finish the current sign-in or switch first.".into()) }
    let target = profile(&state, &id)?;
    let runtime = processes::inspect(processes::Provider::Codex).await?;
    Ok(SwitchPlan { id, label: target.label, provider: "codex", desktop_running: !runtime.desktop.is_empty(), cli_running: runtime.cli_running, process_names: runtime.session_names() })
}

#[tauri::command]
pub async fn prepare_antigravity_switch(app: AppHandle, id: String) -> Result<SwitchPlan, String> {
    let state = app.state::<AppState>();
    if state.login_running.load(Ordering::SeqCst) || state.switch_running.load(Ordering::SeqCst) { return Err("Finish the current sign-in or switch first.".into()) }
    let target = state.config.lock().unwrap().antigravity_profiles.iter().find(|p| p.id == id).cloned()
        .ok_or("Save this Antigravity sign-in before switching to it.")?;
    let runtime = processes::inspect(processes::Provider::Antigravity).await?;
    Ok(SwitchPlan { id, label: target.label, provider: "antigravity", desktop_running: !runtime.desktop.is_empty(), cli_running: runtime.cli_running, process_names: runtime.session_names() })
}

fn status(app: &AppHandle, message: &str) {
    let state = app.state::<AppState>(); state.snapshot.lock().unwrap().switching = Some(message.into()); state.emit(app);
}

#[tauri::command]
pub async fn switch_account(app: AppHandle, id: String, restart_desktop: bool) -> Result<(), String> {
    let state = app.state::<AppState>();
    if state.login_running.load(Ordering::SeqCst) { return Err("Finish or cancel the current sign-in first.".into()) }
    if state.switch_running.swap(true, Ordering::SeqCst) { return Err("An account switch is already running.".into()) }
    status(&app, "Preparing the account switch…");
    let result = perform_switch(&app, &id, restart_desktop).await;
    state.switch_running.store(false, Ordering::SeqCst);
    state.snapshot.lock().unwrap().switching = None;
    state.emit(&app);
    result
}

async fn perform_switch(app: &AppHandle, id: &str, restart_desktop: bool) -> Result<(), String> {
    let state = app.state::<AppState>();
    let _guard = state.io.lock().await;
    if state.login_running.load(Ordering::SeqCst) { return Err("Finish or cancel the current sign-in first.".into()) }
    if std::env::var_os("CODEX_ACCESS_TOKEN").is_some() { return Err("This Codex session uses an environment-provided access token. Remove it before switching saved accounts.".into()) }
    let target = profile(&state, id)?;
    let target_home = state.profile_home(id)?;
    let root = rpc::desktop_home();
    let mut root_rpc = Rpc::start(&root, false).await?;
    let config = root_rpc.request("config/read", json!({"includeLayers":false})).await?;
    let mode = config["config"]["cli_auth_credentials_store"].as_str().unwrap_or("file").to_owned();
    let current_home = root.clone();
    let store = tauri::async_runtime::spawn_blocking(move || Store::resolve(&mode, &current_home)).await.map_err(|_| "Could not check Codex credential storage.")??;
    drop(root_rpc);

    // Validate before closing anything. Reading/copying is performed off the UI
    // thread, and the temporary plaintext never enters the frontend or logs.
    let home = target_home.clone(); let current_home = root.clone();
    let same = tauri::async_runtime::spawn_blocking(move || {
        let incoming = Auth::read(&home, Store::Keyring)?.ok_or("This account's saved sign-in is missing. Sign in again from its account menu.")?;
        let current = Auth::read(&current_home, store)?;
        Ok::<_, String>(current.is_some_and(|old| old.same_account(&incoming)))
    }).await.map_err(|_| "Could not check the saved sign-in.")??;
    if same { return Err("Codex is already using this account.".into()) }
    let mut target_rpc = Rpc::start(&target_home, true).await?;
    target_rpc.request("account/read", json!({"refreshToken":true})).await
        .map_err(|_| "This account could not be refreshed. Check your connection or sign in again before switching.")?;
    let incoming_account = state::read_account(&mut target_rpc, id, &target.label, false).await?
        .ok_or("Reconnect this account with ChatGPT before switching.")?;
    drop(target_rpc);
    let home = target_home.clone();
    let incoming = tauri::async_runtime::spawn_blocking(move || Auth::read(&home, Store::Keyring))
        .await.map_err(|_| "Could not unlock this account.")??.ok_or("The saved sign-in is missing. Reconnect this account.")?;
    if incoming.email.as_ref().is_some_and(|email| incoming_account.email.as_ref().is_some_and(|actual| !email.eq_ignore_ascii_case(actual))) {
        return Err("The saved sign-in changed. Refresh the accounts and try again.".into())
    }

    let runtime = processes::inspect(processes::Provider::Codex).await?;
    if runtime.running() && !restart_desktop { return Err("Review and confirm ‘Close sessions and switch’ before closing running apps and terminals.".into()) }
    if runtime.running() {
        status(app, "Closing Codex, ChatGPT, and related terminal sessions…");
        if let Err(error) = runtime.close_sessions().await { let _ = runtime.reopen_desktop(); return Err(error) }
    }

    let result = async {
        status(app, "Saving the current account…");
        // Re-read after shutdown to capture the newest refreshed credentials.
        let current_home = root.clone();
        let previous = tauri::async_runtime::spawn_blocking(move || Auth::read(&current_home, store)).await.map_err(|_| "Could not save the current sign-in.")??;
        if let Some(previous) = &previous {
            let identity = format!("{}:{}", previous.email.as_deref().unwrap_or("").to_lowercase(), previous.account_id);
            let cached = state.snapshot.lock().unwrap().accounts.clone();
            let saved = cached.iter().find(|a| !a.desktop && a.id != id && a.identity.as_deref() == Some(identity.as_str()));
            let outgoing_id = saved.map(|a| a.id.clone()).unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            let label = saved.map(|a| a.label.clone()).or_else(|| cached.iter().find(|a| a.desktop && a.identity.as_deref() == Some(identity.as_str())).map(|a| a.label.clone()))
                .unwrap_or_else(|| previous.email.as_deref().and_then(|s| s.split('@').next()).unwrap_or("Previous account").to_owned());
            let home = state.profile_home(&outgoing_id)?;
            // The active credential is authoritative. An inactive copy is never
            // refreshed while its matching account is active in the desktop.
            let current_home = root.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let auth = Auth::read(&current_home, store)?.ok_or("The current sign-in disappeared. Retry the switch.")?;
                auth.write(&home, Store::Keyring)
            }).await.map_err(|_| "Could not preserve the previous account.")??;
            {
                let mut config = state.config.lock().unwrap();
                if !config.profiles.iter().any(|p| p.id == outgoing_id) { config.profiles.push(Profile { id: outgoing_id.clone(), label: label.clone() }); }
            }
            if let Some(mut account) = cached.into_iter().find(|a| a.desktop && a.identity.as_deref() == Some(identity.as_str())) {
                account.id = outgoing_id.clone(); account.label = label; account.desktop = false;
                let mut snapshot = state.snapshot.lock().unwrap(); snapshot.accounts.retain(|a| a.id != outgoing_id); snapshot.accounts.push(account);
            }
            state.persist()?;
        }

        status(app, "Switching desktop and CLI…");
        if processes::inspect(processes::Provider::Codex).await?.running() {
            return Err("A Codex or ChatGPT session started during the switch. No sign-in was changed. Review the sessions and retry.".into())
        }
        let current_home = root.clone();
        let write = tauri::async_runtime::spawn_blocking(move || incoming.write(&current_home, store)).await.map_err(|_| "Could not switch the saved sign-in.")?;
        // A failed atomic replacement leaves the previous credential intact.
        write?;
        let verify = async {
            let mut rpc = Rpc::start(&root, false).await?;
            let response = rpc.request("account/read", json!({"refreshToken":false})).await?;
            if response["account"]["type"] != "chatgpt" || response["account"]["email"].as_str().map(str::to_lowercase) != incoming_account.email.as_deref().map(str::to_lowercase) {
                return Err("Codex did not select the expected account.".to_owned())
            }
            let auth = rpc.request("getAuthStatus", json!({"includeToken":true,"refreshToken":false})).await?;
            let identity = auth["authToken"].as_str().and_then(auth::token_account_id)
                .map(|id| format!("{}:{id}", incoming_account.email.as_deref().unwrap_or("").to_lowercase()));
            if identity.is_none() || identity != incoming_account.identity { return Err("Codex could not verify the chosen account. The previous sign-in will be restored.".into()) }
            Ok(())
        }.await;
        if let Err(error) = verify {
            let current_home = root.clone();
            let restored = tauri::async_runtime::spawn_blocking(move || match previous { Some(auth) => auth.write(&current_home, store), None => auth::remove(&current_home, store) }).await;
            return match restored {
                Ok(Ok(())) => Err(format!("{error} Your previous Codex sign-in was restored.")),
                _ => Err("The switch failed and the previous sign-in could not be restored. Open Codex and sign in again.".into()),
            }
        }
        state.config.lock().unwrap().desktop_label = Some(target.label.clone());
        {
            let mut snapshot = state.snapshot.lock().unwrap();
            let mut desktop = incoming_account.clone(); desktop.id = "desktop".into(); desktop.desktop = true;
            snapshot.accounts.retain(|a| a.id != "desktop" && a.id != id);
            snapshot.accounts.push(incoming_account); snapshot.accounts.push(desktop);
            snapshot.active_account_id = Some("desktop".into()); snapshot.desktop_error = None;
        }
        state.persist()?;
        Ok(())
    }.await;
    status(app, "Reopening Codex…");
    let reopened = runtime.reopen_desktop();
    result?;
    reopened
}
