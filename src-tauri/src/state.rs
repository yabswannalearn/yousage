use crate::{model::{parse_limits, Account, Alert, AntigravityAccount, AntigravityStatus, ClaudeStatus, ProviderColors, AppTheme, Point, UpdateStatus}, rpc::{self, Rpc}, usage::{self, AlertHistory, Health, HealthStatus, ProviderHealth, UsagePreferences}};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{fs, path::PathBuf, sync::{atomic::{AtomicBool, AtomicU64, Ordering}, Mutex}, time::{SystemTime, UNIX_EPOCH}};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_notification::NotificationExt;
use tokio::time::{timeout, Duration, Instant};

#[derive(Clone, Default, Deserialize, Serialize)]
pub struct Profile { pub id: String, pub label: String }

#[derive(Clone, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Config {
    pub profiles: Vec<Profile>,
    pub antigravity_profiles: Vec<Profile>,
    pub desktop_label: Option<String>,
    pub start_with_windows: bool,
    pub refresh_seconds: u64,
    pub hidden: bool,
    pub anchor: Option<Point>,
    pub dock_edge: crate::model::DockEdge,
    pub notch_source: String,
    pub notifications_enabled: bool,
    pub provider_colors: ProviderColors,
    pub hidden_providers: Vec<String>,
    pub app_theme: AppTheme,
    pub usage_preferences: UsagePreferences,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            profiles: vec![],
            antigravity_profiles: vec![],
            desktop_label: None,
            start_with_windows: true,
            refresh_seconds: 60,
            hidden: false,
            anchor: None,
            dock_edge: crate::model::DockEdge::default(),
            notch_source: "codex".into(),
            notifications_enabled: true,
            provider_colors: ProviderColors::default(),
            hidden_providers: vec![],
            app_theme: AppTheme::default(),
            usage_preferences: UsagePreferences::default(),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub start_with_windows: bool,
    pub refresh_seconds: u64,
    pub notch_source: String,
    pub notifications_enabled: bool,
    pub provider_colors: ProviderColors,
    pub hidden_providers: Vec<String>,
    pub app_theme: AppTheme,
    pub usage_preferences: UsagePreferences,
}

#[derive(Clone, Serialize)]
pub struct Login { pub status: String, pub error: Option<String> }

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub accounts: Vec<Account>,
    pub active_account_id: Option<String>,
    pub antigravity: AntigravityStatus,
    pub claude: ClaudeStatus,
    pub alerts: Vec<Alert>,
    pub update: UpdateStatus,
    pub refreshing: bool,
    pub desktop_error: Option<String>,
    pub login: Option<Login>,
    pub switching: Option<String>,
    pub settings: Settings,
    pub health: Health,
}

pub struct AppState {
    pub config: Mutex<Config>,
    pub snapshot: Mutex<Snapshot>,
    pub alert_history: Mutex<AlertHistory>,
    pub directory: PathBuf,
    persist_guard: Mutex<()>,
    pub io: tokio::sync::Mutex<()>,
    pub login_running: AtomicBool,
    pub switch_running: AtomicBool,
    pub cancel_login: AtomicBool,
    pub resizing: AtomicBool,
    pub resize_generation: AtomicU64,
    pub window: Mutex<crate::desktop::WindowState>,
    pub claude_next_refresh: AtomicU64,
    pub claude_token_fingerprint: Mutex<Option<[u8; 32]>>,
}

impl AppState {
    pub fn load(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let directory = app.path().app_local_data_dir()?;
        fs::create_dir_all(directory.join("accounts"))?;
        fs::create_dir_all(directory.join("antigravity-accounts"))?;
        let mut config: Config = fs::read(directory.join("settings.json")).ok().and_then(|s| serde_json::from_slice(&s).ok()).unwrap_or_default();
        config.refresh_seconds = config.refresh_seconds.clamp(30, 600);
        if config.notch_source.is_empty() { config.notch_source = "codex".into(); }
        if !config.app_theme.valid() { config.app_theme = AppTheme::default(); }
        if !config.provider_colors.valid() { config.provider_colors = ProviderColors::default(); }
        if config.usage_preferences.validate().is_err() { config.usage_preferences = UsagePreferences::default(); }
        let mut cached: Vec<Account> = fs::read(directory.join("usage-cache.json")).ok().and_then(|s| serde_json::from_slice(&s).ok()).unwrap_or_default();
        cached.retain(|a| a.desktop || config.profiles.iter().any(|p| p.id == a.id));
        for account in &mut cached { account.error = Some("Checking latest usage…".into()); }
        let mut antigravity: AntigravityStatus = fs::read(directory.join("antigravity-cache.json")).ok().and_then(|s| serde_json::from_slice(&s).ok()).unwrap_or_default();
        antigravity.accounts.retain(|a| a.active || config.antigravity_profiles.iter().any(|p| p.id == a.id));
        if !antigravity.groups.is_empty() { antigravity.error = Some("Checking latest usage…".into()); }
        let mut claude: ClaudeStatus = fs::read(directory.join("claude-cache.json")).ok().and_then(|s| serde_json::from_slice(&s).ok()).unwrap_or_default();
        if claude.updated_at.is_some() { claude.error = Some("Checking latest usage…".into()); }
        let saved_health: Health = fs::read(directory.join("health-cache.json")).ok().and_then(|s| serde_json::from_slice(&s).ok()).unwrap_or_default();
        let mut health = Health {
            codex: ProviderHealth::checking(cached.iter().find(|a| a.desktop).and_then(|a| a.updated_at)),
            antigravity: ProviderHealth::checking(antigravity.updated_at),
            claude: ProviderHealth::checking(claude.updated_at),
        };
        // A restart must not bypass an upstream rate-limit cooldown.
        for (current, saved) in [(&mut health.codex, &saved_health.codex), (&mut health.antigravity, &saved_health.antigravity), (&mut health.claude, &saved_health.claude)] {
            if saved.status == HealthStatus::RateLimited && saved.next_retry_at.is_some_and(|retry| retry > now()) { *current = saved.clone(); }
        }
        let claude_next_refresh = health.claude.next_retry_at.unwrap_or_default().max(0) as u64;
        let alert_history = load_alert_history(&directory);
        let snapshot = Snapshot {
            accounts: cached,
            active_account_id: None,
            antigravity,
            claude,
            alerts: vec![],
            update: UpdateStatus { current_version: env!("CARGO_PKG_VERSION").into(), ..UpdateStatus::default() },
            refreshing: false,
            desktop_error: None,
            login: None,
            switching: None,
            settings: Settings {
                start_with_windows: config.start_with_windows,
                refresh_seconds: config.refresh_seconds,
                notch_source: config.notch_source.clone(),
                notifications_enabled: config.notifications_enabled,
                provider_colors: config.provider_colors.clone(),
                hidden_providers: config.hidden_providers.clone(),
                app_theme: config.app_theme.clone(),
                usage_preferences: config.usage_preferences.clone(),
            },
            health,
        };
        Ok(Self {
            config: Mutex::new(config), snapshot: Mutex::new(snapshot), alert_history: Mutex::new(alert_history), directory, persist_guard: Mutex::new(()),
            io: tokio::sync::Mutex::new(()), login_running: AtomicBool::new(false), switch_running: AtomicBool::new(false), cancel_login: AtomicBool::new(false),
            resizing: AtomicBool::new(false), resize_generation: AtomicU64::new(0), window: Mutex::new(crate::desktop::WindowState::default()),
            claude_next_refresh: AtomicU64::new(claude_next_refresh),
            claude_token_fingerprint: Mutex::new(None),
        })
    }

    pub fn persist(&self) -> Result<(), String> {
        let _guard = self.persist_guard.lock().unwrap();
        let config = serde_json::to_vec_pretty(&*self.config.lock().unwrap()).map_err(|_| "Could not save settings.")?;
        atomic_write(&self.directory.join("settings.json"), &config)?;
        let snapshot = self.snapshot.lock().unwrap();
        let accounts = serde_json::to_vec(&snapshot.accounts).map_err(|_| "Could not save usage.")?;
        atomic_write(&self.directory.join("usage-cache.json"), &accounts)?;
        let antigravity = serde_json::to_vec(&snapshot.antigravity).map_err(|_| "Could not save Antigravity usage.")?;
        atomic_write(&self.directory.join("antigravity-cache.json"), &antigravity)?;
        let claude = serde_json::to_vec(&snapshot.claude).map_err(|_| "Could not save Claude usage.")?;
        atomic_write(&self.directory.join("claude-cache.json"), &claude)?;
        let health = serde_json::to_vec(&snapshot.health).map_err(|_| "Could not save provider health.")?;
        atomic_write(&self.directory.join("health-cache.json"), &health)?;
        let history = serde_json::to_vec(&*self.alert_history.lock().unwrap()).map_err(|_| "Could not save alert state.")?;
        atomic_write(&self.directory.join("alert-state.json"), &history)
    }

    pub fn emit(&self, app: &AppHandle) {
        let snapshot = self.snapshot.lock().unwrap().clone();
        crate::desktop::update_tray(app, &snapshot);
        let _ = app.emit("usage-updated", snapshot);
    }

    pub fn profile_home(&self, id: &str) -> Result<PathBuf, String> {
        // Profile identifiers are generated UUIDs; never use an interface-supplied path.
        uuid::Uuid::parse_str(id).map_err(|_| "Invalid account.")?;
        Ok(self.directory.join("accounts").join(id))
    }

    pub fn antigravity_profile_home(&self, id: &str) -> Result<PathBuf, String> {
        uuid::Uuid::parse_str(id).map_err(|_| "Invalid Antigravity account.")?;
        Ok(self.directory.join("antigravity-accounts").join(id))
    }
}

fn load_alert_history(directory: &std::path::Path) -> AlertHistory {
    fs::read(directory.join("alert-state.json")).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default()
}

fn atomic_write(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, bytes).and_then(|_| fs::rename(&temporary, path)).map_err(|_| "Could not save YouSage data. Check that your user data folder is writable.".into())
}

pub fn now() -> i64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64 }

pub async fn read_account(rpc: &mut Rpc, id: &str, label: &str, desktop: bool) -> Result<Option<Account>, String> {
    let response = rpc.request("account/read", json!({"refreshToken":false})).await?;
    let account = &response["account"];
    if account.is_null() || account["type"] != "chatgpt" { return Ok(None) }
    let email = account["email"].as_str().map(str::to_owned);
    let plan = account["planType"].as_str().map(str::to_owned);
    let mut result = Account {
        id: id.into(), label: if label.is_empty() { email.as_deref().and_then(|s| s.split('@').next()).unwrap_or("Codex account").into() } else { label.into() },
        email, plan, desktop, ..Account::default()
    };
    // Account IDs live in the local auth token, not in every rate-limit response.
    // Parse only the identity here; the token never crosses the Rust boundary.
    let auth = rpc.request("getAuthStatus", json!({"includeToken":true,"refreshToken":false})).await.ok();
    result.identity = auth.as_ref().and_then(|a| a["authToken"].as_str()).and_then(crate::auth::token_account_id)
        .map(|id| format!("{}:{id}", result.email.as_deref().unwrap_or("").to_lowercase()));
    match rpc.request("account/rateLimits/read", json!(null)).await {
        Ok(limits) => {
            (result.five_hour, result.weekly) = parse_limits(&limits);
            if result.identity.is_none() { result.identity = limits["accountId"].as_str().map(|id| format!("{}:{id}", result.email.as_deref().unwrap_or("").to_lowercase())); }
            if result.five_hour.is_none() && result.weekly.is_none() {
                result.error = Some("Codex did not return five-hour or weekly limits for this account.".into());
            } else { result.updated_at = Some(now()); }
        }
        Err(error) => result.error = Some(error),
    }
    Ok(Some(result))
}

pub async fn refresh_all(app: AppHandle) {
    let state = app.state::<AppState>();
    if state.switch_running.load(Ordering::SeqCst) { return }
    let Ok(_guard) = state.io.try_lock() else { return };
    state.snapshot.lock().unwrap().refreshing = true;
    state.emit(&app);
    // Claude's account-metadata endpoint has a separate, conservative cadence.
    // Start it alongside the CLI providers so a slow CLI cannot delay it.
    let claude_app = app.clone();
    let claude_refresh = tauri::async_runtime::spawn(async move { crate::claude::refresh(&claude_app).await });
    refresh_cli_providers(&app).await;
    let _ = claude_refresh.await;
    let new_alerts = {
        let mut snapshot = state.snapshot.lock().unwrap();
        snapshot.refreshing = false;
        let rules = &snapshot.settings.usage_preferences.alert_rules;
        let mut history = state.alert_history.lock().unwrap();
        let evaluated = usage::evaluate_alerts(&mut history, &snapshot.accounts, &snapshot.antigravity, &snapshot.claude, rules, now());
        let delivery_enabled = snapshot.settings.notifications_enabled && !rules.suppressed(now(), usage::local_minutes());
        let evaluated: Vec<_> = evaluated.into_iter().filter(|alert| {
            let provider = if alert.id.starts_with("agy:") { "antigravity" } else if alert.id.starts_with("claude:") { "claude" } else { "codex" };
            delivery_enabled && !snapshot.settings.hidden_providers.iter().any(|hidden| hidden == provider)
        }).collect();
        for alert in &evaluated {
            snapshot.alerts.retain(|a| a.id != alert.id);
            snapshot.alerts.push(alert.clone());
        }
        // Bound retained banners; alert deduplication is persisted separately.
        if snapshot.alerts.len() > 100 { let remove = snapshot.alerts.len() - 100; snapshot.alerts.drain(..remove); }
        let next_check = now().saturating_add(snapshot.settings.refresh_seconds as i64);
        if snapshot.health.codex.status != HealthStatus::RateLimited { snapshot.health.codex.next_retry_at = Some(next_check); }
        if snapshot.health.antigravity.status != HealthStatus::RateLimited { snapshot.health.antigravity.next_retry_at = Some(next_check); }
        let eligible = state.claude_next_refresh.load(Ordering::SeqCst).min(i64::MAX as u64) as i64;
        snapshot.health.claude.next_retry_at = Some(next_scheduled_retry(now(), snapshot.settings.refresh_seconds, eligible));
        evaluated
    };
    for alert in new_alerts {
        // Deliver from the backend even while the webview/notch is hidden.
        // Windows notification settings remain authoritative; in-app alerts
        // are retained if the OS refuses a toast.
        if let Err(error) = app.notification().builder().title(&alert.title).body(&alert.message).show() {
            eprintln!("Could not show a usage notification: {error}");
        }
        let _ = app.emit("usage-alert", alert);
    }
    state.emit(&app);
    let _ = state.persist();
}

fn next_scheduled_retry(now: i64, cadence: u64, eligible: i64) -> i64 {
    let cadence = cadence.clamp(30, 600) as i64;
    let scans = ((eligible.saturating_sub(now).max(1) + cadence - 1) / cadence).max(1);
    now.saturating_add(scans.saturating_mul(cadence))
}

async fn refresh_cli_providers(app: &AppHandle) {
    // Different providers have separate credential stores. Their independent
    // checks can run together while the outer I/O guard protects switching.
    let codex_app = app.clone();
    let codex = tauri::async_runtime::spawn(async move { refresh_codex(&codex_app).await });
    refresh_antigravity(app).await;
    let _ = codex.await;
}

fn cooling_down(health: &ProviderHealth) -> bool {
    health.status == HealthStatus::RateLimited && health.next_retry_at.is_some_and(|retry| retry > now())
}

pub(crate) fn complete_health(health: &mut ProviderHealth, provider: &str, error: Option<&str>, last_success: Option<i64>, cadence: u64) {
    health.update(provider, error, last_success, Some(now().saturating_add(cadence as i64)));
    if health.status == HealthStatus::RateLimited {
        // CLI APIs do not expose a Retry-After value. Use a conservative cooldown.
        health.next_retry_at = Some(now().saturating_add(900));
    }
}

async fn refresh_codex(app: &AppHandle) {
    let state = app.state::<AppState>();
    let config = state.config.lock().unwrap().clone();
    {
        let mut snapshot = state.snapshot.lock().unwrap();
        if cooling_down(&snapshot.health.codex) { return; }
        snapshot.health.codex = ProviderHealth::checking(snapshot.health.codex.last_success_at);
    }
    state.emit(app);
    let mut profiles = vec![("desktop".to_owned(), config.desktop_label.unwrap_or_default(), rpc::desktop_home(), true)];
    for profile in config.profiles {
        if let Ok(home) = state.profile_home(&profile.id) { profiles.push((profile.id, profile.label, home, false)); }
    }
    for (id, label, home, desktop) in profiles {
        if !desktop {
            let mut snapshot = state.snapshot.lock().unwrap();
            let active = snapshot.accounts.iter().find(|a| a.id == "desktop" && snapshot.active_account_id.as_deref() == Some("desktop")).cloned();
            let same = active.as_ref().and_then(|active| active.identity.as_ref()).is_some_and(|identity| snapshot.accounts.iter().any(|a| a.id == id && a.identity.as_ref() == Some(identity)));
            if same {
                // One refresh owner for the active login avoids competing token rotation.
                let mut account = active.unwrap(); account.id = id.clone(); account.label = label; account.desktop = false;
                snapshot.accounts.retain(|a| a.id != id); snapshot.accounts.push(account);
                drop(snapshot); state.emit(app); continue;
            }
        }
        let result = match Rpc::start(&home, !desktop).await {
            Ok(mut rpc) => read_account(&mut rpc, &id, &label, desktop).await,
            Err(error) => Err(error),
        };
        {
            let mut snapshot = state.snapshot.lock().unwrap();
            match result {
                Ok(Some(mut account)) => {
                    if account.error.is_some() {
                        if let Some(old) = snapshot.accounts.iter().find(|a| a.id == id && same_codex_identity(a, &account)) {
                            account.five_hour = old.five_hour.clone(); account.weekly = old.weekly.clone();
                            account.updated_at = old.updated_at;
                        }
                    }
                    snapshot.accounts.retain(|a| a.id != id);
                    if desktop { snapshot.active_account_id = Some(id.clone()); snapshot.desktop_error = account.error.clone(); }
                    snapshot.accounts.push(account);
                }
                Ok(None) if desktop => {
                    snapshot.accounts.retain(|a| a.id != id);
                    snapshot.active_account_id = None;
                    snapshot.desktop_error = Some("Sign in with ChatGPT in the Codex desktop app to see its usage.".into());
                }
                Ok(None) => {
                    if let Some(account) = snapshot.accounts.iter_mut().find(|a| a.id == id) { account.error = Some("Sign in again to reconnect this account.".into()); }
                }
                Err(error) => {
                    if desktop { snapshot.desktop_error = Some(error.clone()); }
                    if let Some(account) = snapshot.accounts.iter_mut().find(|a| a.id == id) { account.error = Some(error); }
                    else if !desktop { snapshot.accounts.push(Account { id: id.clone(), label: label.clone(), error: Some(error), ..Account::default() }); }
                }
            }
        }
        state.emit(app);
    }
    {
        let mut snapshot = state.snapshot.lock().unwrap();
        let last_success = codex_last_success(&snapshot.accounts, snapshot.active_account_id.as_deref());
        let error = snapshot.desktop_error.clone();
        let inactive_failures = snapshot.accounts.iter().filter(|a| !a.desktop && a.error.is_some()).count();
        complete_health(&mut snapshot.health.codex, "codex", error.as_deref(), last_success, config.refresh_seconds);
        if error.is_none() && inactive_failures > 0 {
            snapshot.health.codex.message = format!("{inactive_failures} connected account(s) need attention. Use Sign in again on their cards.");
        }
    }
    state.emit(app);
}

fn codex_last_success(accounts: &[Account], active_account_id: Option<&str>) -> Option<i64> {
    // Startup has no confirmed active ID yet. An unavailable CLI must retain
    // the cached desktop check time; a confirmed sign-out removes that record.
    accounts.iter().find(|account| match active_account_id {
        Some(id) => account.id == id,
        None => account.desktop,
    }).and_then(|account| account.updated_at)
}

fn same_codex_identity(a: &Account, b: &Account) -> bool {
    match (&a.identity, &b.identity) {
        (Some(a), Some(b)) => a == b,
        (None, None) => same_email(a.email.as_deref(), b.email.as_deref()),
        _ => false,
    }
}

fn same_email(a: Option<&str>, b: Option<&str>) -> bool {
    a.zip(b).is_some_and(|(a, b)| !a.is_empty() && a.eq_ignore_ascii_case(b))
}

fn preserve_antigravity_reading(account: &mut AntigravityAccount, previous: &[AntigravityAccount]) {
    if account.error.is_none() || !account.groups.is_empty() { return; }
    if let Some(old) = previous.iter().find(|old| old.id == account.id && same_email(old.email.as_deref(), account.email.as_deref())) {
        account.groups = old.groups.clone();
        account.updated_at = old.updated_at;
    }
}

async fn refresh_antigravity(app: &AppHandle) {
    let state = app.state::<AppState>();
    let config = state.config.lock().unwrap().clone();
    let active_email_before = rpc::antigravity_email();
    let previous_accounts = {
        let mut snapshot = state.snapshot.lock().unwrap();
        let same_account = same_email(active_email_before.as_deref(), snapshot.antigravity.email.as_deref());
        if cooling_down(&snapshot.health.antigravity) && same_account { return; }
        let previous = snapshot.antigravity.accounts.clone();
        if !same_account {
            snapshot.antigravity = AntigravityStatus { email: active_email_before.clone(),
                accounts: previous.iter().filter(|a| !a.active).cloned().collect(), ..AntigravityStatus::default() };
        }
        snapshot.health.antigravity = ProviderHealth::checking(snapshot.antigravity.updated_at);
        previous
    };
    state.emit(app);
    let agy_profiles = config.antigravity_profiles;
    let result = rpc::read_antigravity().await;
    let active_email_after = rpc::antigravity_email();
    let mut agy_accounts = Vec::new();
    {
        let mut snapshot = state.snapshot.lock().unwrap();
        match result {
            Ok(mut antigravity) => {
                // Authentication can change while the CLI is running. Reuse old
                // readings only when both local and cached identities agree.
                let stable_email = same_email(active_email_before.as_deref(), active_email_after.as_deref());
                if !stable_email || !same_email(antigravity.email.as_deref(), active_email_after.as_deref()) {
                    antigravity.groups.clear(); antigravity.updated_at = None;
                    antigravity.email = active_email_after.clone();
                    antigravity.error = Some("Antigravity sign-in changed during the check. Refresh to see the current account.".into());
                } else if antigravity.error.is_some() && antigravity.groups.is_empty()
                    && same_email(snapshot.antigravity.email.as_deref(), antigravity.email.as_deref()) {
                    antigravity.groups = snapshot.antigravity.groups.clone();
                    antigravity.updated_at = snapshot.antigravity.updated_at;
                }
                snapshot.antigravity = antigravity;
            }
            Err(error) => {
                let matching = same_email(active_email_before.as_deref(), active_email_after.as_deref())
                    && same_email(snapshot.antigravity.email.as_deref(), active_email_after.as_deref());
                if !matching { snapshot.antigravity = AntigravityStatus { email: active_email_after.clone(), ..AntigravityStatus::default() }; }
                snapshot.antigravity.error = Some(error);
            }
        }
        let active = &snapshot.antigravity;
        let matched_profile = agy_profiles.iter().find(|p| state.antigravity_profile_home(&p.id).ok()
            .and_then(|home| rpc::antigravity_email_in(&home))
            .is_some_and(|email| same_email(Some(&email), active.email.as_deref())));
        let active_label = matched_profile.map(|p| p.label.clone())
            .or_else(|| active.email.as_deref().and_then(|s| s.split('@').next()).map(str::to_owned))
            .unwrap_or_else(|| "Active Antigravity".into());
        agy_accounts.push(AntigravityAccount { id: matched_profile.map(|p| p.id.clone()).unwrap_or_else(|| "active".into()),
            label: active_label, email: active.email.clone(), groups: active.groups.clone(),
            updated_at: active.updated_at, error: active.error.clone(), active: true });
    }
    state.emit(app);
    let active_agy_email = state.snapshot.lock().unwrap().antigravity.email.clone();
    for profile in agy_profiles {
        let Ok(home) = state.antigravity_profile_home(&profile.id) else { continue; };
        let saved_email = rpc::antigravity_email_in(&home);
        if same_email(saved_email.as_deref(), active_agy_email.as_deref()) { continue; }
        let result = rpc::read_antigravity_in(Some(&home)).await;
        let final_email = rpc::antigravity_email_in(&home);
        let mut account = match result {
            Ok((email, groups, error)) => {
                let matching = same_email(saved_email.as_deref(), final_email.as_deref()) && same_email(email.as_deref(), final_email.as_deref());
                AntigravityAccount { id: profile.id.clone(), label: profile.label.clone(), email: final_email,
                    updated_at: if matching && error.is_none() && !groups.is_empty() { Some(now()) } else { None },
                    groups: if matching { groups } else { vec![] },
                    error: if matching { error } else { Some("The saved Antigravity sign-in changed. Refresh to check it again.".into()) }, active: false }
            }
            Err(error) => AntigravityAccount { id: profile.id.clone(), label: profile.label.clone(),
                email: final_email, groups: vec![], updated_at: None, error: Some(error), active: false },
        };
        preserve_antigravity_reading(&mut account, &previous_accounts);
        agy_accounts.push(account);
    }
    {
        let mut snapshot = state.snapshot.lock().unwrap();
        snapshot.antigravity.accounts = agy_accounts;
        let last_success = snapshot.antigravity.updated_at;
        let error = snapshot.antigravity.error.clone();
        let inactive_failures = snapshot.antigravity.accounts.iter().filter(|a| !a.active && a.error.is_some()).count();
        complete_health(&mut snapshot.health.antigravity, "antigravity", error.as_deref(), last_success, config.refresh_seconds);
        if error.is_none() && inactive_failures > 0 {
            snapshot.health.antigravity.message = format!("{inactive_failures} saved account(s) need attention. Check their cards and save the sign-in again if needed.");
        }
    }
    state.emit(app);
}

#[tauri::command]
pub fn get_snapshot(state: State<'_, AppState>) -> Snapshot { state.snapshot.lock().unwrap().clone() }

#[tauri::command]
pub fn refresh_usage(app: AppHandle) { tauri::async_runtime::spawn(refresh_all(app)); }

#[tauri::command]
pub fn test_notification(app: AppHandle) -> Result<(), String> {
    if !app.state::<AppState>().config.lock().unwrap().notifications_enabled {
        return Err("Enable notifications before sending a test.".into())
    }
    app.notification().builder().title("YouSage notifications")
        .body("Low-allowance and reset alerts will appear here, even while YouSage is hidden.")
        .show().map_err(|_| "Windows could not show the notification. Check YouSage in Windows notification settings.".into())
}

#[tauri::command]
pub fn dismiss_alert(app: AppHandle, id: String) {
    let state = app.state::<AppState>();
    state.snapshot.lock().unwrap().alerts.retain(|a| a.id != id);
    state.emit(&app);
}

#[tauri::command]
pub async fn save_antigravity_account(app: AppHandle, label: String) -> Result<(), String> {
    let label: String = label.trim().chars().take(48).collect();
    if label.is_empty() { return Err("Enter a name for this Antigravity account.".into()) }
    let state = app.state::<AppState>();
    let _guard = state.io.lock().await;
    let active_root = rpc::antigravity_user_root();
    let email = rpc::antigravity_email().ok_or("Sign in with Antigravity CLI (agy) first before saving the account.")?;
    let existing_id = {
        let config = state.config.lock().unwrap();
        config.antigravity_profiles.iter().find_map(|p| {
            let home = state.antigravity_profile_home(&p.id).ok()?;
            rpc::antigravity_email_in(&home).filter(|e| e.eq_ignore_ascii_case(&email)).map(|_| p.id.clone())
        })
    };
    let id = existing_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let dst = state.antigravity_profile_home(&id)?;
    tauri::async_runtime::spawn_blocking(move || rpc::copy_antigravity_auth(&active_root, &dst))
        .await.map_err(|_| "Could not save the Antigravity account.")??;
    {
        let mut config = state.config.lock().unwrap();
        config.antigravity_profiles.retain(|p| p.id != id);
        config.antigravity_profiles.push(Profile { id, label });
    }
    state.persist()?;
    drop(_guard);
    refresh_all(app).await;
    Ok(())
}

#[tauri::command]
pub async fn switch_antigravity_account(app: AppHandle, id: String, restart_desktop: bool) -> Result<(), String> {
    let state = app.state::<AppState>();
    if state.login_running.load(Ordering::SeqCst) { return Err("Finish or cancel the current sign-in first.".into()) }
    if state.switch_running.swap(true, Ordering::SeqCst) { return Err("An account switch is already running.".into()) }
    state.snapshot.lock().unwrap().switching = Some("Preparing the Antigravity account switch…".into()); state.emit(&app);
    let result = async {
        let _guard = state.io.lock().await;
        if !state.config.lock().unwrap().antigravity_profiles.iter().any(|p| p.id == id) {
            return Err("Save this Antigravity sign-in before switching to it.".into())
        }
        let target_home = state.antigravity_profile_home(&id)?;
        // Validate and refresh the target before interrupting any running work.
        rpc::read_antigravity_in(Some(&target_home)).await?;
        let incoming = rpc::temporary_auth_home()?;
        rpc::copy_antigravity_auth(&target_home, incoming.path())?;
        let runtime = crate::processes::inspect(crate::processes::Provider::Antigravity).await?;
        if runtime.running() && !restart_desktop { return Err("Review and confirm ‘Close sessions and switch’ before closing running apps and terminals.".into()) }
        if runtime.running() {
            state.snapshot.lock().unwrap().switching = Some("Closing Antigravity and related terminal sessions…".into()); state.emit(&app);
            if let Err(error) = runtime.close_sessions().await { let _ = runtime.reopen_desktop(); return Err(error) }
        }
        let switched = async {
            let active = rpc::antigravity_home();
            let backup = rpc::temporary_auth_home()?;
            rpc::sync_antigravity_auth(&active, &backup.path().join(".gemini"))?;
            if let Some(current_email) = rpc::antigravity_email() {
                let existing = {
                    let config = state.config.lock().unwrap();
                    config.antigravity_profiles.iter().find_map(|p| {
                        let home = state.antigravity_profile_home(&p.id).ok()?;
                        rpc::antigravity_email_in(&home).filter(|e| e.eq_ignore_ascii_case(&current_email)).map(|_| p.id.clone())
                    })
                };
                let outgoing_id = existing.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
                let outgoing_home = state.antigravity_profile_home(&outgoing_id)?;
                rpc::copy_antigravity_auth(backup.path(), &outgoing_home)?;
                let mut config = state.config.lock().unwrap();
                if !config.antigravity_profiles.iter().any(|p| p.id == outgoing_id) {
                    let fallback = current_email.split('@').next().unwrap_or("Antigravity").to_owned();
                    config.antigravity_profiles.push(Profile { id: outgoing_id, label: fallback });
                }
            }
            state.persist()?;
            state.snapshot.lock().unwrap().switching = Some("Switching the Antigravity sign-in…".into()); state.emit(&app);
            if crate::processes::inspect(crate::processes::Provider::Antigravity).await?.running() {
                return Err("An Antigravity session started during the switch. No sign-in was changed. Review the sessions and retry.".into())
            }
            let replacement = async {
                rpc::sync_antigravity_auth(&incoming.path().join(".gemini"), &active)?;
                rpc::read_antigravity().await?;
                Ok::<(), String>(())
            }.await;
            if let Err(error) = replacement {
                return match rpc::sync_antigravity_auth(&backup.path().join(".gemini"), &active) {
                    Ok(()) => Err(format!("{error} Your previous Antigravity sign-in was restored.")),
                    Err(_) => Err("The switch failed and the previous Antigravity sign-in could not be restored. Sign in again with agy.".into()),
                }
            }
            Ok::<(), String>(())
        }.await;
        let reopened = runtime.reopen_desktop();
        switched?;
        reopened
    }.await;
    state.switch_running.store(false, Ordering::SeqCst);
    state.snapshot.lock().unwrap().switching = None; state.emit(&app);
    result?;
    refresh_all(app).await;
    Ok(())
}

#[tauri::command]
pub fn rename_antigravity_account(app: AppHandle, id: String, label: String) -> Result<(), String> {
    let label: String = label.trim().chars().take(48).collect();
    if label.is_empty() { return Err("Enter a name for this account.".into()) }
    let state = app.state::<AppState>();
    {
        let mut config = state.config.lock().unwrap();
        let profile = config.antigravity_profiles.iter_mut().find(|p| p.id == id).ok_or("Save this Antigravity account first before renaming it.")?;
        profile.label = label.clone();
    }
    if let Some(acc) = state.snapshot.lock().unwrap().antigravity.accounts.iter_mut().find(|a| a.id == id) {
        acc.label = label;
    }
    state.persist()?;
    state.emit(&app);
    Ok(())
}

#[tauri::command]
pub fn disconnect_antigravity_account(app: AppHandle, id: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    let home = state.antigravity_profile_home(&id)?;
    let _ = fs::remove_dir_all(home);
    state.config.lock().unwrap().antigravity_profiles.retain(|p| p.id != id);
    state.snapshot.lock().unwrap().antigravity.accounts.retain(|a| a.id != id || a.active);
    state.persist()?;
    state.emit(&app);
    Ok(())
}

#[tauri::command]
pub fn check_for_updates(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>();
        let current = env!("CARGO_PKG_VERSION").to_owned();
        {
            let mut snapshot = state.snapshot.lock().unwrap();
            snapshot.update.checking = true;
            snapshot.update.error = None;
        }
        state.emit(&app);
        let next = match rpc::fetch_latest_release(&current).await {
            Ok(status) => status,
            Err(error) => UpdateStatus { current_version: current, checking: false, error: Some(error), ..UpdateStatus::default() },
        };
        state.snapshot.lock().unwrap().update = next;
        state.emit(&app);
    });
}

#[tauri::command]
pub fn open_release_url(app: AppHandle, url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|_| "Invalid release URL.")?;
    if parsed.scheme() != "https" || !matches!(parsed.host_str(), Some("github.com" | "objects.githubusercontent.com")) {
        return Err("Only official GitHub release links can be opened.".into())
    }
    app.opener().open_url(&url, None::<&str>).map_err(|_| "Could not open the release link in your browser.".into())
}

#[tauri::command]
pub fn connect_account(app: AppHandle, label: String, reconnect_id: Option<String>) -> Result<(), String> {
    let state = app.state::<AppState>();
    if state.switch_running.load(Ordering::SeqCst) { return Err("Wait for the account switch to finish.".into()) }
    if state.login_running.swap(true, Ordering::SeqCst) { return Err("Finish or cancel the current sign-in first.".into()) }
    state.cancel_login.store(false, Ordering::SeqCst);
    state.snapshot.lock().unwrap().login = Some(Login { status: "Opening sign-in…".into(), error: None });
    state.emit(&app);
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>();
        let result = perform_login(&app, label, reconnect_id).await;
        state.login_running.store(false, Ordering::SeqCst);
        state.snapshot.lock().unwrap().login = result.err().map(|error| Login { status: "Sign-in stopped".into(), error: Some(error) });
        state.emit(&app);
        refresh_all(app.clone()).await;
    });
    Ok(())
}

async fn perform_login(app: &AppHandle, label: String, reconnect_id: Option<String>) -> Result<(), String> {
    let state = app.state::<AppState>();
    let _guard = state.io.lock().await;
    let id = reconnect_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let home = state.profile_home(&id)?;
    fs::create_dir_all(&home).map_err(|_| "Could not prepare this account's local profile.")?;
    let mut rpc = Rpc::start(&home, true).await?;
    let response = rpc.request("account/login/start", json!({"type":"chatgpt"})).await?;
    let auth_url = response["authUrl"].as_str().ok_or("Codex did not provide a sign-in link. Update Codex and retry.")?;
    let parsed = url::Url::parse(auth_url).map_err(|_| "Codex provided an invalid sign-in link.")?;
    if parsed.scheme() != "https" || !matches!(parsed.host_str(), Some("auth.openai.com" | "chatgpt.com")) {
        return Err("Codex provided an unrecognized sign-in destination.".into())
    }
    app.opener().open_url(auth_url, None::<&str>).map_err(|_| "Could not open your browser for sign-in.")?;
    state.snapshot.lock().unwrap().login = Some(Login { status: "Finish signing in in your browser".into(), error: None });
    state.emit(app);
    let deadline = Instant::now() + Duration::from_secs(600);
    loop {
        if state.cancel_login.load(Ordering::SeqCst) || Instant::now() >= deadline {
            let _ = rpc.request("account/login/cancel", json!({"loginId":response["loginId"]})).await;
            return Err("Sign-in was cancelled. You can try again whenever you're ready.".into())
        }
        if let Some(result) = rpc.login_result.take() { result?; break }
        match timeout(Duration::from_secs(1), rpc.next()).await {
            Ok(Err(error)) => return Err(error),
            Ok(Ok(_)) | Err(_) => {}
        }
    }
    let label: String = label.trim().chars().take(48).collect();
    let account = read_account(&mut rpc, &id, &label, false).await?.ok_or("Sign in with a ChatGPT account to view Codex allowance.")?;
    {
        let mut config = state.config.lock().unwrap();
        config.profiles.retain(|p| p.id != id);
        config.profiles.push(Profile { id: id.clone(), label: label.clone() });
    }
    {
        let mut snapshot = state.snapshot.lock().unwrap();
        snapshot.accounts.retain(|a| a.id != id);
        snapshot.accounts.push(account);
    }
    state.persist()?;
    Ok(())
}

#[tauri::command]
pub fn cancel_sign_in(state: State<'_, AppState>) { state.cancel_login.store(true, Ordering::SeqCst); }

#[tauri::command]
pub fn dismiss_login_error(app: AppHandle) {
    let state = app.state::<AppState>();
    if !state.login_running.load(Ordering::SeqCst) { state.snapshot.lock().unwrap().login = None; }
    state.emit(&app);
}

#[tauri::command]
pub async fn disconnect_account(app: AppHandle, id: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    if state.switch_running.load(Ordering::SeqCst) { return Err("Wait for the account switch to finish.".into()) }
    if state.login_running.load(Ordering::SeqCst) { return Err("Finish or cancel sign-in before disconnecting an account.".into()) }
    if id == "desktop" { return Err("The desktop account is managed by Codex.".into()) }
    let home = state.profile_home(&id)?;
    if !state.config.lock().unwrap().profiles.iter().any(|p| p.id == id) { return Err("This account is not connected.".into()) }
    let _guard = state.io.lock().await;
    // Log out before forgetting the profile so credentials are removed from the OS store.
    let mut rpc = Rpc::start(&home, true).await?;
    rpc.request("account/logout", json!(null)).await?;
    state.config.lock().unwrap().profiles.retain(|p| p.id != id);
    state.snapshot.lock().unwrap().accounts.retain(|a| a.id != id);
    state.persist()?;
    state.emit(&app);
    Ok(())
}

#[tauri::command]
pub fn rename_account(app: AppHandle, id: String, label: String) -> Result<(), String> {
    let label: String = label.trim().chars().take(48).collect();
    if label.is_empty() { return Err("Enter a name for this account.".into()) }
    let state = app.state::<AppState>();
    {
        let mut config = state.config.lock().unwrap();
        if id == "desktop" { config.desktop_label = Some(label.clone()); }
        else {
            let profile = config.profiles.iter_mut().find(|p| p.id == id).ok_or("This account is not connected.")?;
            profile.label = label.clone();
        }
    }
    if let Some(account) = state.snapshot.lock().unwrap().accounts.iter_mut().find(|a| a.id == id) { account.label = label; }
    state.persist()?;
    state.emit(&app);
    Ok(())
}

fn valid_slug(id: &str) -> bool {
    !id.is_empty() && id.len() <= 48 && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn valid_notch_source(value: &str) -> bool {
    value == "codex"
        || value == "custom"
        || value == "claude"
        || value == "antigravity"
        || value == "both"
        || value.strip_prefix("antigravity:").is_some_and(valid_slug)
        || value.strip_prefix("both:").is_some_and(valid_slug)
        || value.strip_prefix("custom:").is_some_and(valid_slug)
}

fn save_usage_preferences(directory: &std::path::Path, config: &mut Config, preferences: UsagePreferences) -> Result<(), String> {
    preferences.validate()?;
    let mut next = config.clone();
    next.usage_preferences = preferences;
    let bytes = serde_json::to_vec_pretty(&next).map_err(|_| "Could not save usage preferences.")?;
    atomic_write(&directory.join("settings.json"), &bytes)?;
    *config = next;
    Ok(())
}

#[tauri::command]
pub fn update_usage_preferences(app: AppHandle, preferences: UsagePreferences) -> Result<(), String> {
    let state = app.state::<AppState>();
    {
        let _guard = state.persist_guard.lock().unwrap();
        let mut config = state.config.lock().unwrap();
        save_usage_preferences(&state.directory, &mut config, preferences.clone())?;
        state.snapshot.lock().unwrap().settings.usage_preferences = preferences;
    }
    state.emit(&app);
    Ok(())
}

#[tauri::command]
pub fn update_settings(
    app: AppHandle,
    start_with_windows: bool,
    refresh_seconds: u64,
    notch_source: Option<String>,
    notifications_enabled: Option<bool>,
    provider_colors: Option<ProviderColors>,
    hidden_providers: Option<Vec<String>>,
    app_theme: Option<AppTheme>,
) -> Result<(), String> {
    if !(30..=600).contains(&refresh_seconds) { return Err("Choose a refresh interval between 30 seconds and 10 minutes.".into()) }
    if let Some(ref source) = notch_source {
        if !valid_notch_source(source) { return Err("Choose a valid notch preview source.".into()) }
    }
    if app_theme.as_ref().is_some_and(|theme| !theme.valid()) { return Err("Choose a valid six-digit hex color for the app background and accent.".into()) }
    if provider_colors.as_ref().is_some_and(|colors| !colors.valid()) { return Err("Choose a valid six-digit hex color for each subscription.".into()) }
    if hidden_providers.as_ref().is_some_and(|hidden| hidden.iter().any(|p| !["codex", "antigravity", "claude"].contains(&p.as_str()))) { return Err("Choose a valid subscription to hide.".into()) }
    if !cfg!(debug_assertions) {
        if start_with_windows { app.autolaunch().enable() } else { app.autolaunch().disable() }
            .map_err(|_| "Windows could not update the startup setting.")?;
    }
    let state = app.state::<AppState>();
    let (resolved_source, resolved_notifications, resolved_colors, resolved_hidden, resolved_theme) = {
        let mut config = state.config.lock().unwrap();
        config.start_with_windows = start_with_windows;
        config.refresh_seconds = refresh_seconds;
        if let Some(source) = notch_source { config.notch_source = source; }
        if let Some(enabled) = notifications_enabled { config.notifications_enabled = enabled; }
        if let Some(colors) = provider_colors { config.provider_colors = colors; }
        if let Some(hidden) = hidden_providers { config.hidden_providers = hidden; }
        if let Some(theme) = app_theme { config.app_theme = theme; }
        (config.notch_source.clone(), config.notifications_enabled, config.provider_colors.clone(), config.hidden_providers.clone(), config.app_theme.clone())
    };
    {
        let mut snapshot = state.snapshot.lock().unwrap();
        let settings = &mut snapshot.settings;
        settings.start_with_windows = start_with_windows;
        settings.refresh_seconds = refresh_seconds;
        settings.notch_source = resolved_source;
        settings.notifications_enabled = resolved_notifications;
        settings.provider_colors = resolved_colors;
        settings.hidden_providers = resolved_hidden;
        settings.app_theme = resolved_theme;
    }
    state.persist()?;
    state.emit(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn existing_settings_gain_visible_subscriptions_and_default_colors() {
        let config: Config = serde_json::from_str(r##"{"notchSource":"both:gemini","desktopLabel":"Personal"}"##).unwrap();
        assert_eq!(config.notch_source, "both:gemini");
        assert_eq!(config.desktop_label.as_deref(), Some("Personal"));
        assert!(config.hidden_providers.is_empty());
        assert_eq!(config.provider_colors, ProviderColors::default());
        assert_eq!(config.app_theme, AppTheme::default());
        assert_eq!(config.usage_preferences, UsagePreferences::default());
    }

    #[test]
    fn colors_and_hidden_subscriptions_survive_saved_settings() {
        let mut config = Config::default();
        config.provider_colors.codex = "#ff66aa".into();
        config.app_theme = AppTheme { background: "#e9e4ff".into(), accent: "#8b45ce".into() };
        config.hidden_providers = vec!["claude".into(), "antigravity".into()];
        let restored: Config = serde_json::from_slice(&serde_json::to_vec(&config).unwrap()).unwrap();
        assert_eq!(restored.provider_colors.codex, "#ff66aa");
        assert_eq!(restored.hidden_providers, config.hidden_providers);
        assert_eq!(restored.app_theme, config.app_theme);
        assert!(restored.app_theme.valid());
        assert!(!AppTheme { background: "#fff;display:none".into(), ..AppTheme::default() }.valid());
        assert!(valid_notch_source("claude"));
        assert!(valid_notch_source("custom"));
        assert!(valid_notch_source("custom:gemini-4-argon"));
        assert!(!valid_notch_source("custom:../credentials"));
        assert!(!valid_notch_source("none"));
        config.provider_colors.claude = "#fff;display:none".into();
        assert!(!config.provider_colors.valid());
    }

    #[test]
    fn preferences_and_alert_dedup_survive_disk_roundtrip_without_partial_changes() {
        let directory = tempfile::tempdir().unwrap();
        let mut config = Config::default();
        let mut preferences = UsagePreferences::default();
        preferences.notch_providers = vec!["claude".into(), "codex".into()];
        preferences.alert_rules.snoozed_until = Some(1800000000);
        save_usage_preferences(directory.path(), &mut config, preferences.clone()).unwrap();
        let saved: Config = serde_json::from_slice(&fs::read(directory.path().join("settings.json")).unwrap()).unwrap();
        assert_eq!(saved.usage_preferences, preferences);
        assert_eq!(config.usage_preferences, preferences);
        let mut invalid = preferences.clone(); invalid.alert_rules.codex.critical_percent = 99.0;
        assert!(save_usage_preferences(directory.path(), &mut config, invalid).is_err());
        assert_eq!(config.usage_preferences, preferences);
        assert_eq!(serde_json::from_slice::<Config>(&fs::read(directory.path().join("settings.json")).unwrap()).unwrap().usage_preferences, preferences);
        let missing_directory = directory.path().join("absent");
        assert!(save_usage_preferences(&missing_directory, &mut config, UsagePreferences::default()).is_err());
        assert_eq!(config.usage_preferences, preferences);
        let mut history = AlertHistory::new();
        history.insert("codex:account:5h".into(), usage::AlertObservation { remaining: 7.0, resets_at: Some(100) });
        atomic_write(&directory.path().join("alert-state.json"), &serde_json::to_vec(&history).unwrap()).unwrap();
        assert_eq!(load_alert_history(directory.path()), history);
    }

    #[test]
    fn antigravity_failure_preserves_only_the_same_known_account_and_timestamp() {
        let previous = vec![AntigravityAccount { id: "saved".into(), email: Some("work@example.com".into()),
            groups: vec![crate::model::AntigravityGroup { id: "gemini".into(), ..Default::default() }],
            updated_at: Some(100), ..Default::default() }];
        let mut failure = AntigravityAccount { id: "saved".into(), email: Some("WORK@example.com".into()),
            error: Some("Connection unavailable".into()), ..Default::default() };
        preserve_antigravity_reading(&mut failure, &previous);
        assert_eq!(failure.groups.len(), 1); assert_eq!(failure.updated_at, Some(100));
        failure.groups.clear(); failure.updated_at = None; failure.email = Some("personal@example.com".into());
        preserve_antigravity_reading(&mut failure, &previous);
        assert!(failure.groups.is_empty()); assert_eq!(failure.updated_at, None);
        failure.email = None; preserve_antigravity_reading(&mut failure, &previous);
        assert!(failure.groups.is_empty());
    }

    #[test]
    fn retry_times_follow_the_configured_scan_schedule_and_provider_cooldown() {
        assert_eq!(next_scheduled_retry(100, 60, 400), 400);
        assert_eq!(next_scheduled_retry(100, 600, 400), 700);
        assert_eq!(next_scheduled_retry(100, 60, 401), 460);
        assert_eq!(next_scheduled_retry(100, 60, 99), 160);
    }

    #[test]
    fn codex_health_retains_only_the_desktop_success_time_before_startup_identity_check() {
        let mut accounts = vec![
            Account { id: "saved".into(), updated_at: Some(200), ..Account::default() },
            Account { id: "desktop".into(), desktop: true, updated_at: Some(100), error: Some("CLI unavailable".into()), ..Account::default() },
        ];
        assert_eq!(codex_last_success(&accounts, None), Some(100));
        assert_eq!(codex_last_success(&accounts, Some("desktop")), Some(100));
        accounts.retain(|account| !account.desktop);
        assert_eq!(codex_last_success(&accounts, None), None);
        assert_eq!(codex_last_success(&accounts, Some("desktop")), None);
    }
}
