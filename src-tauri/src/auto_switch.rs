use crate::{model::{AntigravityGroup, UsageWindow}, state::{self, AppState, Snapshot}, usage::{HealthStatus, Purpose}};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::atomic::Ordering};
use tauri::{AppHandle, Manager};

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AutoSwitchStatus {
    pub message: String,
    pub next_attempt_at: Option<i64>,
}

#[derive(Clone, Debug)]
pub struct Request {
    pub provider: &'static str,
    pub id: String,
    pub identity: String,
    pub group: Option<String>,
    pub windows: HashMap<String, UsageWindow>,
}

pub fn windows(five: Option<&UsageWindow>, weekly: Option<&UsageWindow>) -> HashMap<String, UsageWindow> {
    [("fiveHour", five), ("weekly", weekly)].into_iter().filter_map(|(key, value)| value.map(|value| (key.into(), value.clone()))).collect()
}

fn fresh(updated: Option<i64>, error: Option<&str>, now: i64, maximum_age: i64) -> bool {
    error.is_none() && updated.is_some_and(|at| at <= now + 30 && now.saturating_sub(at) <= maximum_age)
}

fn valid(window: &UsageWindow, now: i64) -> bool {
    window.remaining.is_finite() && (0.0..=100.0).contains(&window.remaining) && window.resets_at.is_none_or(|reset| reset > now)
}

fn exhausted(windows: &HashMap<String, UsageWindow>, now: i64) -> bool {
    !windows.is_empty() && windows.values().all(|window| valid(window, now)) && windows.values().any(|window| window.remaining == 0.0)
}

pub fn capacity(required: &HashMap<String, UsageWindow>, available: &HashMap<String, UsageWindow>, now: i64) -> Option<f64> {
    if required.is_empty() || available.iter().any(|(key, window)| (matches!(key.as_str(), "fiveHour" | "weekly") || required.contains_key(key)) && (!valid(window, now) || window.remaining == 0.0)) { return None; }
    required.keys().try_fold(100.0_f64, |score, key| {
        let window = available.get(key)?;
        (valid(window, now) && window.remaining > 0.0).then_some(score.min(window.remaining))
    })
}

fn group<'a>(groups: &'a [AntigravityGroup], source: &str) -> Option<&'a AntigravityGroup> {
    let chosen = source.split_once(':').filter(|(provider, _)| matches!(*provider, "antigravity" | "both" | "custom")).map(|(_, id)| id);
    chosen.and_then(|id| groups.iter().find(|group| group.id == id)).or_else(|| groups.first())
}

fn trigger(snapshot: &Snapshot, provider: &'static str, now: i64) -> Option<Request> {
    let preferences = &snapshot.settings.usage_preferences;
    if !preferences.auto_switch.enabled(provider) || snapshot.settings.hidden_providers.iter().any(|hidden| hidden == provider) { return None; }
    let health = match provider { "codex" => &snapshot.health.codex, "antigravity" => &snapshot.health.antigravity, _ => &snapshot.health.claude };
    if health.status != HealthStatus::Ready { return None; }
    let (identity, selected_group, limits) = match provider {
        "codex" => {
            let active = snapshot.accounts.iter().find(|account| Some(&account.id) == snapshot.active_account_id.as_ref())?;
            if !fresh(active.updated_at, active.error.as_deref(), now, 180) { return None; }
            (active.identity.clone().or_else(|| active.email.clone())?, None, windows(active.five_hour.as_ref(), active.weekly.as_ref()))
        }
        "antigravity" => {
            let active = &snapshot.antigravity;
            if !fresh(active.updated_at, active.error.as_deref(), now, 180) { return None; }
            let group = group(&active.groups, &snapshot.settings.notch_source)?;
            (active.email.clone()?, Some(group.id.clone()), windows(group.five_hour.as_ref(), group.weekly.as_ref()))
        }
        "claude" => {
            let active = &snapshot.claude;
            if !fresh(active.updated_at, active.error.as_deref(), now, 600) { return None; }
            let mut limits = windows(active.five_hour.as_ref(), active.weekly.as_ref());
            let model = snapshot.settings.notch_source.strip_prefix("claude:").and_then(|id| active.model_limits.iter().find(|group| group.id == id));
            if let Some(model) = model {
                limits.insert(format!("model:{}", model.id), model.weekly.clone()?);
            }
            (active.email.clone()?, model.map(|model| model.id.clone()), limits)
        }
        _ => return None,
    };
    exhausted(&limits, now).then_some(Request { provider, id: String::new(), identity, group: selected_group, windows: limits })
}

fn eligible(snapshot: &Snapshot, provider: &str, id: &str) -> bool {
    let preferences = &snapshot.settings.usage_preferences;
    let account = preferences.account_preferences.get(&format!("{provider}:{id}"));
    !account.is_some_and(|account| account.exclude_from_suggestions)
        && (preferences.recommendation_purpose == Purpose::Any || account.is_some_and(|account| account.purpose == preferences.recommendation_purpose))
}

fn candidates(snapshot: &Snapshot, active: &Request, now: i64) -> Vec<String> {
    let mut candidates: Vec<(String, f64)> = match active.provider {
        "codex" => snapshot.accounts.iter().filter_map(|account| {
            if account.desktop || !eligible(snapshot, "codex", &account.id) || !fresh(account.updated_at, account.error.as_deref(), now, 180) { return None; }
            let identity = account.identity.as_ref().or(account.email.as_ref())?;
            if identity.eq_ignore_ascii_case(&active.identity) { return None; }
            capacity(&active.windows, &windows(account.five_hour.as_ref(), account.weekly.as_ref()), now).map(|score| (account.id.clone(), score))
        }).collect(),
        "antigravity" => snapshot.antigravity.accounts.iter().filter_map(|account| {
            if account.active || !eligible(snapshot, "antigravity", &account.id) || !fresh(account.updated_at, account.error.as_deref(), now, 180)
                || account.email.as_ref().is_none_or(|email| email.eq_ignore_ascii_case(&active.identity)) { return None; }
            let group = account.groups.iter().find(|group| Some(&group.id) == active.group.as_ref())?;
            capacity(&active.windows, &windows(group.five_hour.as_ref(), group.weekly.as_ref()), now).map(|score| (account.id.clone(), score))
        }).collect(),
        // Claude saved credentials are probed once at exhaustion, with provider
        // cooldowns. Do not poll every inactive Claude account in the background.
        "claude" => snapshot.claude.accounts.iter().filter(|account| !account.active && !account.email.eq_ignore_ascii_case(&active.identity) && eligible(snapshot, "claude", &account.id)).map(|account| (account.id.clone(), 0.0)).collect(),
        _ => vec![],
    };
    candidates.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    candidates.into_iter().map(|(id, _)| id).collect()
}

/// Called within the provider's switch I/O guard, before interrupting sessions
/// and again before replacement. Disabling the setting cancels pending work.
pub fn authorize(state: &AppState, request: &Request, available: &HashMap<String, UsageWindow>) -> Result<bool, String> {
    let snapshot = state.snapshot.lock().unwrap();
    authorize_snapshot(&snapshot, request, available, state::now())
}

fn authorize_snapshot(snapshot: &Snapshot, request: &Request, available: &HashMap<String, UsageWindow>, now: i64) -> Result<bool, String> {
    let current = trigger(snapshot, request.provider, now).ok_or("Auto switch no longer applies: the setting, sign-in, or allowance changed.")?;
    if current.identity != request.identity || current.group != request.group || !eligible(&snapshot, request.provider, &request.id) {
        return Err("Auto switch cancelled because the active account or account preferences changed.".into());
    }
    if capacity(&current.windows, available, now).is_none() { return Err("The next account has no verified allowance for the exhausted windows.".into()); }
    Ok(snapshot.settings.usage_preferences.auto_switch.closes_sessions())
}

fn status(state: &AppState, provider: &str, message: &str, next: Option<i64>) {
    state.snapshot.lock().unwrap().auto_switch.insert(provider.into(), AutoSwitchStatus { message: message.into(), next_attempt_at: next });
}

pub async fn run(app: AppHandle) {
    let state = app.state::<AppState>();
    if state.login_running.load(Ordering::SeqCst) || state.switch_running.load(Ordering::SeqCst) { return; }
    if !["codex", "antigravity", "claude"].iter().any(|provider| state.config.lock().unwrap().usage_preferences.auto_switch.enabled(provider)) { return; }
    for provider in ["codex", "antigravity", "claude"] {
        let snapshot = state.snapshot.lock().unwrap().clone();
        let Some(mut request) = trigger(&snapshot, provider, state::now()) else { continue; };
        if snapshot.auto_switch.get(provider).and_then(|status| status.next_attempt_at).is_some_and(|retry| retry > state::now()) { continue; }
        let ids = candidates(&snapshot, &request, state::now());
        if ids.is_empty() {
            status(&state, provider, "Waiting for another saved account with fresh, available allowance.", None);
            continue;
        }
        let runtime_provider = match provider { "codex" => crate::processes::Provider::Codex, "antigravity" => crate::processes::Provider::Antigravity, _ => crate::processes::Provider::Claude };
        let allow_close = snapshot.settings.usage_preferences.auto_switch.closes_sessions();
        if !allow_close {
            match crate::processes::inspect(runtime_provider).await {
                Ok(runtime) if runtime.running() => { status(&state, provider, "At 0% remaining. Waiting for this provider's open sessions to close.", None); continue; }
                Err(_) => { status(&state, provider, "Could not inspect open sessions. Will retry in five minutes.", Some(state::now() + 300)); continue; }
                _ => {}
            }
        }
        status(&state, provider, "Checking the next account before switching…", Some(state::now() + 300));
        let _ = state.persist(); state.emit(&app);
        let mut switched = false;
        for id in ids {
            if state.login_running.load(Ordering::SeqCst) || state.switch_running.load(Ordering::SeqCst) { break; }
            request.id = id.clone();
            let result = match provider {
                "codex" => crate::switching::switch_account_with_request(app.clone(), id, false, Some(request.clone())).await,
                "antigravity" => crate::state::switch_antigravity_with_request(app.clone(), id, false, Some(request.clone())).await,
                _ => crate::claude_accounts::switch_with_request(app.clone(), id, false, Some(request.clone())).await,
            };
            if result.is_ok() {
                status(&state, provider, "Automatically switched to an account with available allowance.", Some(state::now() + 300));
                switched = true; break;
            }
            let health = state.snapshot.lock().unwrap().health.clone();
            if provider == "claude" && health.claude.status == HealthStatus::RateLimited { break; }
            // Only Claude needs to probe successive saved accounts. CLI sources
            // already rank fresh readings; retry failures on the next interval.
            if provider != "claude" { break; }
        }
        if !switched { status(&state, provider, "No switch completed. Check saved sign-ins, allowance, and session settings; retrying in five minutes.", Some(state::now() + 300)); }
        let _ = state.persist(); state.emit(&app);
    }
    let _ = state.persist(); state.emit(&app);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{model::{Account, AntigravityAccount, AntigravityStatus, ClaudeAccount, ClaudeStatus}, state::Settings, usage::{AccountPreference, AutoSwitch, Health, ProviderHealth, UsagePreferences}};
    fn snapshot() -> Snapshot {
        let reading = |remaining| Some(UsageWindow { remaining, resets_at: Some(2000) });
        let health = ProviderHealth { status: HealthStatus::Ready, ..ProviderHealth::default() };
        let mut preferences = UsagePreferences::default(); preferences.auto_switch = AutoSwitch { codex: true, antigravity: true, claude: true, ..AutoSwitch::default() };
        let group = AntigravityGroup { id: "argon".into(), five_hour: None, weekly: reading(0.0), ..AntigravityGroup::default() };
        let account = Account { id: "desktop".into(), identity: Some("work:123".into()), email: Some("work@example.com".into()), desktop: true, five_hour: reading(0.0), weekly: reading(50.0), updated_at: Some(1000), ..Account::default() };
        Snapshot {
            accounts: vec![account.clone(), Account { id: "personal".into(), identity: Some("personal:123".into()), email: Some("personal@example.com".into()), desktop: false, five_hour: reading(80.0), weekly: reading(70.0), ..account }],
            active_account_id: Some("desktop".into()), antigravity: AntigravityStatus { email: Some("work@example.com".into()), groups: vec![group.clone()], updated_at: Some(1000), accounts: vec![AntigravityAccount { id: "agy-personal".into(), email: Some("personal@example.com".into()), groups: vec![AntigravityGroup { weekly: reading(90.0), ..group }], updated_at: Some(1000), ..AntigravityAccount::default() }], ..AntigravityStatus::default() },
            claude: ClaudeStatus { email: Some("work@example.com".into()), five_hour: reading(50.0), weekly: reading(60.0), model_limits: vec![AntigravityGroup { id: "fable".into(), weekly: reading(0.0), ..AntigravityGroup::default() }], updated_at: Some(1000), accounts: vec![ClaudeAccount { id: "claude-personal".into(), email: "personal@example.com".into(), ..ClaudeAccount::default() }], ..ClaudeStatus::default() },
            alerts: vec![], update: Default::default(), refreshing: false, desktop_error: None, login: None, switching: None, health: Health { codex: health.clone(), antigravity: health.clone(), claude: health }, pacing: HashMap::new(), auto_switch: HashMap::new(),
            settings: Settings { start_with_windows: false, refresh_seconds: 60, notch_source: "both:argon".into(), notifications_enabled: true, provider_colors: Default::default(), hidden_providers: vec![], app_theme: Default::default(), usage_preferences: preferences, privacy_mode: false, history_retention_days: 30, sessions_enabled: false, onboarding_completed: true },
        }
    }
    #[test]
    fn zero_means_exact_exhaustion_and_requires_current_valid_windows() {
        let window = |remaining, resets_at| UsageWindow { remaining, resets_at };
        assert!(exhausted(&windows(Some(&window(0.0, Some(200))), Some(&window(50.0, Some(300)))), 100));
        assert!(!exhausted(&windows(Some(&window(0.4, None)), None), 100));
        assert!(!exhausted(&windows(Some(&window(0.0, Some(99))), None), 100));
        assert!(!exhausted(&windows(Some(&window(f64::NAN, None)), None), 100));
        assert!(!exhausted(&HashMap::new(), 100));
    }
    #[test]
    fn destination_needs_positive_matching_limits_and_cannot_use_unknown_reset_windows() {
        let required = windows(Some(&UsageWindow { remaining: 0.0, resets_at: Some(200) }), Some(&UsageWindow { remaining: 20.0, resets_at: Some(300) }));
        let mut available = windows(Some(&UsageWindow { remaining: 80.0, resets_at: Some(200) }), Some(&UsageWindow { remaining: 40.0, resets_at: Some(300) }));
        assert_eq!(capacity(&required, &available, 100), Some(40.0));
        available.insert("model:unrelated".into(), UsageWindow { remaining: 0.0, resets_at: None });
        assert_eq!(capacity(&required, &available, 100), Some(40.0), "an unrelated model limit must not block the selected allowance");
        available.remove("weekly"); assert_eq!(capacity(&required, &available, 100), None);
        available.insert("weekly".into(), UsageWindow { remaining: 0.0, resets_at: Some(300) }); assert_eq!(capacity(&required, &available, 100), None);
        available.insert("weekly".into(), UsageWindow { remaining: 50.0, resets_at: Some(100) }); assert_eq!(capacity(&required, &available, 100), None);
    }

    #[test]
    fn triggers_only_enabled_visible_fresh_successful_accounts_and_skips_reset_due() {
        let mut snapshot = snapshot();
        assert!(trigger(&snapshot, "codex", 1000).is_some());
        snapshot.settings.usage_preferences.auto_switch.codex = false;
        assert!(trigger(&snapshot, "codex", 1000).is_none());
        snapshot.settings.usage_preferences.auto_switch.codex = true;
        snapshot.settings.hidden_providers.push("codex".into());
        assert!(trigger(&snapshot, "codex", 1000).is_none());
        snapshot.settings.hidden_providers.clear();
        assert!(trigger(&snapshot, "codex", 1181).is_none());
        snapshot.accounts[0].error = Some("cached usage".into());
        assert!(trigger(&snapshot, "codex", 1000).is_none());
        snapshot.accounts[0].error = None; snapshot.accounts[0].five_hour.as_mut().unwrap().resets_at = Some(1000);
        assert!(trigger(&snapshot, "codex", 1000).is_none());
    }

    #[test]
    fn candidate_selection_excludes_current_stale_and_disallowed_accounts() {
        let mut snapshot = snapshot();
        let request = trigger(&snapshot, "codex", 1000).unwrap();
        assert_eq!(candidates(&snapshot, &request, 1000), vec!["personal"]);
        snapshot.settings.usage_preferences.account_preferences.insert("codex:personal".into(), AccountPreference { exclude_from_suggestions: true, ..AccountPreference::default() });
        assert!(candidates(&snapshot, &request, 1000).is_empty());
        snapshot.settings.usage_preferences.account_preferences.get_mut("codex:personal").unwrap().exclude_from_suggestions = false;
        snapshot.settings.usage_preferences.recommendation_purpose = Purpose::Work;
        assert!(candidates(&snapshot, &request, 1000).is_empty());
        snapshot.settings.usage_preferences.account_preferences.get_mut("codex:personal").unwrap().purpose = Purpose::Work;
        assert_eq!(candidates(&snapshot, &request, 1000), vec!["personal"]);
        snapshot.accounts[1].identity = Some(request.identity.clone());
        assert!(candidates(&snapshot, &request, 1000).is_empty());
    }

    #[test]
    fn antigravity_compares_the_same_group_and_claude_fable_only_when_selected() {
        let mut snapshot = snapshot();
        let request = trigger(&snapshot, "antigravity", 1000).unwrap();
        assert_eq!(request.group.as_deref(), Some("argon"));
        assert_eq!(candidates(&snapshot, &request, 1000), vec!["agy-personal"]);
        snapshot.antigravity.accounts[0].groups[0].id = "different-model".into();
        assert!(candidates(&snapshot, &request, 1000).is_empty());
        assert!(trigger(&snapshot, "claude", 1000).is_none());
        snapshot.settings.notch_source = "claude:fable".into();
        let request = trigger(&snapshot, "claude", 1000).unwrap();
        assert!(request.windows.contains_key("model:fable"));
        assert_eq!(candidates(&snapshot, &request, 1000), vec!["claude-personal"]);
        assert!(capacity(&request.windows, &windows(snapshot.claude.five_hour.as_ref(), snapshot.claude.weekly.as_ref()), 1000).is_none());
        snapshot.health.claude.status = HealthStatus::RateLimited;
        assert!(trigger(&snapshot, "claude", 1000).is_none());
    }

    #[test]
    fn switching_rechecks_settings_capacity_identity_and_explicit_close_policy() {
        let mut snapshot = snapshot();
        let mut request = trigger(&snapshot, "codex", 1000).unwrap(); request.id = "personal".into();
        let available = windows(snapshot.accounts[1].five_hour.as_ref(), snapshot.accounts[1].weekly.as_ref());
        assert_eq!(authorize_snapshot(&snapshot, &request, &available, 1000), Ok(false));
        snapshot.settings.usage_preferences.auto_switch.sessions = crate::usage::AutoSwitchSessions::Close;
        assert_eq!(authorize_snapshot(&snapshot, &request, &available, 1000), Ok(false));
        snapshot.settings.usage_preferences.auto_switch.force_close_confirmed = true;
        assert_eq!(authorize_snapshot(&snapshot, &request, &available, 1000), Ok(true));
        snapshot.settings.usage_preferences.auto_switch.codex = false;
        assert!(authorize_snapshot(&snapshot, &request, &available, 1000).is_err());
        snapshot.settings.usage_preferences.auto_switch.codex = true;
        snapshot.accounts[0].identity = Some("another-account".into());
        assert!(authorize_snapshot(&snapshot, &request, &available, 1000).is_err());
        snapshot.accounts[0].identity = Some(request.identity.clone());
        snapshot.accounts[0].five_hour.as_mut().unwrap().remaining = 100.0;
        assert!(authorize_snapshot(&snapshot, &request, &available, 1000).is_err());
    }
}
