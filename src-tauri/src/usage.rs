use crate::model::{Account, Alert, AntigravityStatus, ClaudeStatus, UsageWindow};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum NotchWindow { FiveHour, Weekly, #[default] Limiting }

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Purpose { #[default] Any, Work, Personal }

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct AccountPreference {
    pub purpose: Purpose,
    pub exclude_from_suggestions: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Thresholds {
    pub warning_percent: f64,
    pub critical_percent: f64,
}

impl Default for Thresholds {
    fn default() -> Self { Self { warning_percent: 20.0, critical_percent: 10.0 } }
}

impl Thresholds {
    fn valid(&self) -> bool {
        self.warning_percent.is_finite() && self.critical_percent.is_finite()
            && self.critical_percent >= 0.0 && self.warning_percent <= 100.0
            && self.critical_percent < self.warning_percent
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct AlertRules {
    pub codex: Thresholds,
    pub antigravity: Thresholds,
    pub claude: Thresholds,
    pub low_enabled: bool,
    pub reset_enabled: bool,
    pub quiet_hours_enabled: bool,
    pub quiet_start: String,
    pub quiet_end: String,
    pub snoozed_until: Option<i64>,
}

impl Default for AlertRules {
    fn default() -> Self {
        Self { codex: Thresholds::default(), antigravity: Thresholds::default(), claude: Thresholds::default(),
            low_enabled: true, reset_enabled: true, quiet_hours_enabled: false,
            quiet_start: "22:00".into(), quiet_end: "08:00".into(), snoozed_until: None }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct UsagePreferences {
    pub notch_providers: Vec<String>,
    pub notch_window: NotchWindow,
    pub alert_rules: AlertRules,
    pub account_preferences: HashMap<String, AccountPreference>,
    pub recommendation_purpose: Purpose,
}

impl UsagePreferences {
    pub fn validate(&self) -> Result<(), String> {
        let mut providers = HashSet::new();
        if self.notch_providers.iter().any(|p| !["codex", "antigravity", "claude"].contains(&p.as_str()) || !providers.insert(p)) {
            return Err("Choose each notch subscription at most once.".into());
        }
        let rules = &self.alert_rules;
        if ![&rules.codex, &rules.antigravity, &rules.claude].into_iter().all(|t| t.valid()) {
            return Err("Alert percentages must be between 0 and 100, with critical below warning.".into());
        }
        if clock_minutes(&rules.quiet_start).is_none() || clock_minutes(&rules.quiet_end).is_none() {
            return Err("Enter quiet hours as a 24-hour time, such as 22:00.".into());
        }
        if rules.snoozed_until.is_some_and(|until| until < 0) { return Err("Choose a valid snooze time.".into()); }
        if self.account_preferences.len() > 1000 || self.account_preferences.keys().any(|key| {
            let Some((provider, id)) = key.split_once(':') else { return true; };
            !["codex", "antigravity"].contains(&provider) || id.is_empty() || id.len() > 128
                || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b))
        }) { return Err("Choose a valid account preference.".into()); }
        Ok(())
    }
}

pub fn clock_minutes(value: &str) -> Option<u16> {
    if value.len() != 5 || value.as_bytes()[2] != b':' { return None; }
    if !value.as_bytes().iter().enumerate().all(|(i, b)| i == 2 || b.is_ascii_digit()) { return None; }
    let hour: u16 = value[..2].parse().ok()?;
    let minute: u16 = value[3..].parse().ok()?;
    (hour < 24 && minute < 60).then_some(hour * 60 + minute)
}

impl AlertRules {
    pub fn suppressed(&self, now: i64, local_minute: u16) -> bool {
        if self.snoozed_until.is_some_and(|until| until > now) { return true; }
        if !self.quiet_hours_enabled { return false; }
        let (Some(start), Some(end)) = (clock_minutes(&self.quiet_start), clock_minutes(&self.quiet_end)) else { return false; };
        if start == end { return false; }
        if start < end { (start..end).contains(&local_minute) } else { local_minute >= start || local_minute < end }
    }
}

pub fn local_minutes() -> u16 {
    #[cfg(windows)]
    {
        let mut time = windows_sys::Win32::Foundation::SYSTEMTIME::default();
        unsafe { windows_sys::Win32::System::SystemInformation::GetLocalTime(&mut time); }
        time.wHour * 60 + time.wMinute
    }
    #[cfg(not(windows))]
    { ((crate::state::now().rem_euclid(86400)) / 60) as u16 }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum HealthStatus { #[default] Checking, Ready, SignInRequired, ToolMissing, RateLimited, Offline, Error }

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct ProviderHealth {
    pub status: HealthStatus,
    pub message: String,
    pub last_success_at: Option<i64>,
    pub next_retry_at: Option<i64>,
    pub recovery_command: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(default)]
pub struct Health {
    pub codex: ProviderHealth,
    pub antigravity: ProviderHealth,
    pub claude: ProviderHealth,
}

impl ProviderHealth {
    pub fn checking(last_success_at: Option<i64>) -> Self {
        Self { message: "Checking latest usage…".into(), last_success_at, ..Self::default() }
    }

    pub fn update(&mut self, provider: &str, error: Option<&str>, last_success_at: Option<i64>, next_retry_at: Option<i64>) {
        self.last_success_at = last_success_at;
        self.next_retry_at = next_retry_at;
        self.recovery_command = None;
        let Some(error) = error else {
            self.status = HealthStatus::Ready;
            self.message = "Usage is up to date.".into();
            return;
        };
        self.message = error.into();
        let lower = error.to_ascii_lowercase();
        self.status = if lower.contains("rate limit") || lower.contains("429") {
            HealthStatus::RateLimited
        } else if lower.contains("could not be started") || lower.contains("not installed") || lower.contains("check your path") {
            HealthStatus::ToolMissing
        } else if lower.contains("sign in") || lower.contains("sign-in") || lower.contains("reconnect") || lower.contains("expired") {
            self.recovery_command = Some(match provider { "claude" => "claude auth login", "antigravity" => "agy", _ => "codex login" }.into());
            HealthStatus::SignInRequired
        } else if lower.contains("could not reach") || lower.contains("timed out") || lower.contains("too long") || lower.contains("connection") {
            HealthStatus::Offline
        } else { HealthStatus::Error };
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AlertObservation {
    pub remaining: f64,
    pub resets_at: Option<i64>,
}

pub type AlertHistory = HashMap<String, AlertObservation>;

fn reset_countdown(window: &UsageWindow, now: i64) -> String {
    match window.resets_at {
        Some(reset) if reset <= now => " Reset is due; checking for the refill.".into(),
        Some(reset) => {
            let minutes = (reset - now + 59) / 60;
            if minutes < 60 { format!(" Resets in {minutes}m.") }
            else if minutes < 1440 { format!(" Resets in {}h {}m.", minutes / 60, minutes % 60) }
            else { format!(" Resets in {}d {}h.", minutes / 1440, minutes % 1440 / 60) }
        }
        None => " Reset time is unavailable.".into(),
    }
}

/// Always observe successful readings, even while delivery is disabled. Suppressed
/// crossings are consumed so unmuting never replays a backlog of old warnings.
pub fn evaluate_alerts(
    previous: &mut AlertHistory, accounts: &[Account], antigravity: &AntigravityStatus,
    claude: &ClaudeStatus, rules: &AlertRules, now: i64,
) -> Vec<Alert> {
    let mut alerts = Vec::new();
    let mut check = |key: String, owner: &str, window_name: &str, window: Option<&UsageWindow>, thresholds: &Thresholds| {
        let Some(w) = window.filter(|w| w.remaining.is_finite()) else { return; };
        let pct = w.remaining.clamp(0.0, 100.0);
        let prev = previous.insert(key.clone(), AlertObservation { remaining: pct, resets_at: w.resets_at });
        let changed_window = prev.as_ref().is_some_and(|p| match (p.resets_at, w.resets_at) { (Some(old), Some(new)) => new > old && old <= now, _ => false });
        let reset = prev.as_ref().is_some_and(|p| {
            (changed_window && pct > thresholds.warning_percent)
                || (pct >= 80.0 && p.remaining <= 20.0 && pct > p.remaining
                    && (p.resets_at.is_none() || w.resets_at.is_none()))
        });
        if reset && rules.reset_enabled {
            alerts.push(Alert { id: format!("{key}:reset"), title: format!("{owner} · {window_name} refilled"),
                message: format!("{owner} {window_name} window reset ({pct:.0}% remaining).{}", reset_countdown(w, now)), kind: "reset".into() });
        } else if rules.low_enabled {
            let critical = pct <= thresholds.critical_percent && (changed_window || prev.as_ref().is_none_or(|p| p.remaining > thresholds.critical_percent));
            let warning = pct <= thresholds.warning_percent && (changed_window || prev.as_ref().is_none_or(|p| p.remaining > thresholds.warning_percent));
            if critical || warning {
                alerts.push(Alert { id: format!("{key}:{}", if critical { "critical" } else { "low" }),
                    title: format!("{owner} · {window_name} {}", if critical { "critically low" } else { "low" }),
                    message: format!("{owner} has {pct:.0}% remaining in its {window_name} window.{}", reset_countdown(w, now)), kind: "low".into() });
            }
        }
    };
    for account in accounts.iter().filter(|a| a.error.is_none()) {
        let identity = account.identity.as_deref().or(account.email.as_deref()).unwrap_or(&account.id);
        let owner = format!("Codex ({})", account.label);
        check(format!("codex:{identity}:5h"), &owner, "5-hour", account.five_hour.as_ref(), &rules.codex);
        check(format!("codex:{identity}:weekly"), &owner, "weekly", account.weekly.as_ref(), &rules.codex);
    }
    if antigravity.error.is_none() {
        let identity = antigravity.email.as_deref().unwrap_or("active");
        for group in &antigravity.groups {
            let owner = format!("Antigravity ({})", group.label);
            check(format!("agy:{identity}:{}:5h", group.id), &owner, "5-hour", group.five_hour.as_ref(), &rules.antigravity);
            check(format!("agy:{identity}:{}:weekly", group.id), &owner, "weekly", group.weekly.as_ref(), &rules.antigravity);
        }
    }
    if claude.error.is_none() {
        let identity = claude.email.as_deref().unwrap_or("active");
        check(format!("claude:{identity}:5h"), "Claude", "5-hour", claude.five_hour.as_ref(), &rules.claude);
        check(format!("claude:{identity}:weekly"), "Claude", "weekly", claude.weekly.as_ref(), &rules.claude);
    }
    alerts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preferences_defaults_migrate_and_reject_invalid_inputs() {
        let defaults: UsagePreferences = serde_json::from_str("{}").unwrap();
        assert_eq!(defaults.notch_window, NotchWindow::Limiting);
        assert_eq!(defaults.alert_rules.codex.warning_percent, 20.0);
        assert!(defaults.validate().is_ok());
        let mut invalid = defaults.clone();
        invalid.alert_rules.claude.critical_percent = 25.0;
        assert!(invalid.validate().is_err());
        invalid = defaults.clone(); invalid.notch_providers = vec!["codex".into(), "codex".into()];
        assert!(invalid.validate().is_err());
        invalid = defaults.clone(); invalid.alert_rules.quiet_end = "24:00".into();
        assert!(invalid.validate().is_err());
        invalid = defaults; invalid.account_preferences.insert("claude:desktop".into(), AccountPreference::default());
        assert!(invalid.validate().is_err());
    }

    #[test]
    fn quiet_hours_include_overnight_start_and_exclude_end() {
        let mut rules = AlertRules { quiet_hours_enabled: true, ..AlertRules::default() };
        assert!(rules.suppressed(1, 22 * 60)); assert!(rules.suppressed(1, 0));
        assert!(rules.suppressed(1, 7 * 60 + 59)); assert!(!rules.suppressed(1, 8 * 60));
        assert!(!rules.suppressed(1, 21 * 60 + 59));
        rules.quiet_start = "09:00".into(); rules.quiet_end = "17:00".into();
        assert!(rules.suppressed(1, 12 * 60)); assert!(!rules.suppressed(1, 18 * 60));
        rules.snoozed_until = Some(100); assert!(rules.suppressed(99, 18 * 60));
        assert!(!rules.suppressed(100, 18 * 60));
    }

    #[test]
    fn thresholds_countdowns_dedup_and_suppression_survive_restart() {
        let mut history = AlertHistory::new();
        let mut account = Account { id: "desktop".into(), label: "Work".into(),
            five_hour: Some(UsageWindow { remaining: 28.0, resets_at: Some(3600) }), ..Account::default() };
        let mut rules = AlertRules::default(); rules.codex.warning_percent = 30.0;
        let evaluate = |h: &mut AlertHistory, a: &Account, r: &AlertRules| evaluate_alerts(h, &[a.clone()], &AntigravityStatus::default(), &ClaudeStatus::default(), r, 60);
        let alerts = evaluate(&mut history, &account, &rules);
        assert_eq!(alerts.len(), 1); assert!(alerts[0].message.contains("Resets in 59m"));
        let mut restored: AlertHistory = serde_json::from_slice(&serde_json::to_vec(&history).unwrap()).unwrap();
        assert!(evaluate(&mut restored, &account, &rules).is_empty());
        // A suppressed crossing still updates the map and is not queued for later.
        account.five_hour.as_mut().unwrap().remaining = 8.0;
        assert_eq!(evaluate(&mut restored, &account, &rules).len(), 1);
        assert!(evaluate(&mut restored, &account, &rules).is_empty());
        account.five_hour = Some(UsageWindow { remaining: 100.0, resets_at: Some(7200) });
        let reset = evaluate_alerts(&mut restored, &[account.clone()], &AntigravityStatus::default(), &ClaudeStatus::default(), &rules, 3601);
        assert_eq!(reset[0].kind, "reset");
        rules.low_enabled = false; account.five_hour.as_mut().unwrap().remaining = 1.0;
        assert!(evaluate(&mut restored, &account, &rules).is_empty());
        rules.low_enabled = true; assert!(evaluate(&mut restored, &account, &rules).is_empty());
    }

    #[test]
    fn high_custom_warning_does_not_infer_a_refill_and_new_window_can_warn_again() {
        let mut history = AlertHistory::new();
        let mut rules = AlertRules::default(); rules.codex.warning_percent = 90.0;
        let mut account = Account { id: "work".into(), five_hour: Some(UsageWindow { remaining: 84.0, resets_at: Some(100) }), ..Account::default() };
        let first = evaluate_alerts(&mut history, &[account.clone()], &AntigravityStatus::default(), &ClaudeStatus::default(), &rules, 1);
        assert_eq!(first[0].kind, "low");
        account.five_hour.as_mut().unwrap().remaining = 85.0;
        assert!(evaluate_alerts(&mut history, &[account.clone()], &AntigravityStatus::default(), &ClaudeStatus::default(), &rules, 2).is_empty());
        account.five_hour = Some(UsageWindow { remaining: 84.0, resets_at: Some(200) });
        let next_window = evaluate_alerts(&mut history, &[account], &AntigravityStatus::default(), &ClaudeStatus::default(), &rules, 101);
        assert_eq!(next_window.len(), 1); assert_eq!(next_window[0].kind, "low");
    }

    #[test]
    fn stale_readings_cannot_generate_alerts_and_health_keeps_real_success_time() {
        let account = Account { id: "desktop".into(), error: Some("offline".into()),
            five_hour: Some(UsageWindow { remaining: 1.0, resets_at: None }), ..Account::default() };
        assert!(evaluate_alerts(&mut AlertHistory::new(), &[account], &AntigravityStatus::default(), &ClaudeStatus::default(), &AlertRules::default(), 0).is_empty());
        let mut health = ProviderHealth::checking(Some(100));
        health.update("claude", Some("Claude usage is rate limited."), Some(100), Some(1000));
        assert_eq!(health.status, HealthStatus::RateLimited);
        assert_eq!(health.last_success_at, Some(100)); assert_eq!(health.next_retry_at, Some(1000));
        health.update("claude", Some("Claude sign-in expired."), None, None);
        assert_eq!(health.status, HealthStatus::SignInRequired);
        assert_eq!(health.recovery_command.as_deref(), Some("claude auth login"));
    }
}
