use crate::{model::{Account, AntigravityStatus, ClaudeStatus, UsageWindow}, state::{self, AppState, Snapshot}};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::{HashMap, HashSet}, fs, path::Path};
use tauri::{AppHandle, Manager};

const VERSION: u8 = 1;
const SAMPLE_INTERVAL: i64 = 300;
const MAX_SERIES: usize = 128;
const MAX_SAMPLES: usize = 200_000;
const MAX_FILE_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Provider { Codex, Antigravity, Claude }

impl Provider {
    fn name(self) -> &'static str { match self { Self::Codex => "Codex", Self::Antigravity => "Antigravity", Self::Claude => "Claude" } }
    fn key(self) -> &'static str { match self { Self::Codex => "codex", Self::Antigravity => "antigravity", Self::Claude => "claude" } }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Window { FiveHour, Weekly }

impl Window {
    fn key(self) -> &'static str { match self { Self::FiveHour => "fiveHour", Self::Weekly => "weekly" } }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HistorySample { pub at: i64, pub remaining: f64, pub resets_at: Option<i64> }

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PacingEstimate {
    pub percentage_points_per_hour: f64,
    pub estimated_exhausts_at: i64,
    pub reset_at: Option<i64>,
    pub may_run_out_before_reset: bool,
    pub observed_minutes: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySeries {
    pub id: String,
    pub provider: Provider,
    pub account_id: String,
    pub label: String,
    pub group_label: Option<String>,
    pub window: Window,
    pub samples: Vec<HistorySample>,
    pub pacing: Option<PacingEstimate>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageHistory {
    pub series: Vec<HistorySeries>,
    pub retention_days: u16,
    pub recording_since: Option<i64>,
}

// Identity hashes distinguish accounts without persisting names, emails, or credentials.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredSeries {
    id: String,
    provider: Provider,
    account_key: String,
    alias: u32,
    group_id: Option<String>,
    window: Window,
    samples: Vec<HistorySample>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryStore {
    version: u8,
    next_alias: u32,
    series: Vec<StoredSeries>,
    #[serde(skip)]
    dirty: bool,
}

impl Default for HistoryStore {
    fn default() -> Self { Self { version: VERSION, next_alias: 1, series: vec![], dirty: false } }
}

struct Reading<'a> {
    provider: Provider,
    account_key: String,
    account_id: &'a str,
    label: &'a str,
    group_id: Option<&'a str>,
    group_label: Option<&'a str>,
    window: Window,
    usage: &'a UsageWindow,
    at: i64,
    successful: bool,
}

fn identity(provider: Provider, value: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(provider.key()); digest.update(b"\0"); digest.update(value.trim().to_lowercase());
    format!("{:x}", digest.finalize())
}

fn readings<'a>(accounts: &'a [Account], antigravity: &'a AntigravityStatus, claude: &'a ClaudeStatus) -> Vec<Reading<'a>> {
    let mut out = vec![];
    for account in accounts {
        // An unknown desktop identity could silently concatenate two different logins.
        let account_identity = account.identity.as_deref().filter(|v| !v.is_empty())
            .or(account.email.as_deref().filter(|v| !v.is_empty()));
        let Some(account_identity) = account_identity else { continue; };
        let Some(at) = account.updated_at else { continue; };
        for (window, usage) in [(Window::FiveHour, &account.five_hour), (Window::Weekly, &account.weekly)] {
            if let Some(usage) = usage { out.push(Reading { provider: Provider::Codex, account_key: identity(Provider::Codex, account_identity),
                account_id: &account.id, label: &account.label, group_id: None, group_label: None, window, usage, at, successful: account.error.is_none() }); }
        }
    }
    for account in &antigravity.accounts {
        let (Some(email), Some(at)) = (account.email.as_deref().filter(|v| !v.is_empty()), account.updated_at) else { continue; };
        for group in &account.groups {
            for (window, usage) in [(Window::FiveHour, &group.five_hour), (Window::Weekly, &group.weekly)] {
                if let Some(usage) = usage { out.push(Reading { provider: Provider::Antigravity, account_key: identity(Provider::Antigravity, email),
                    account_id: &account.id, label: &account.label, group_id: Some(&group.id), group_label: Some(&group.label), window, usage, at, successful: account.error.is_none() }); }
            }
        }
    }
    // Older caches may have only the active Antigravity reading.
    if antigravity.accounts.is_empty() {
        if let (Some(email), Some(at)) = (antigravity.email.as_deref().filter(|v| !v.is_empty()), antigravity.updated_at) {
            for group in &antigravity.groups {
                for (window, usage) in [(Window::FiveHour, &group.five_hour), (Window::Weekly, &group.weekly)] {
                    if let Some(usage) = usage { out.push(Reading { provider: Provider::Antigravity, account_key: identity(Provider::Antigravity, email),
                        account_id: "active", label: "Antigravity", group_id: Some(&group.id), group_label: Some(&group.label), window, usage, at, successful: antigravity.error.is_none() }); }
                }
            }
        }
    }
    if let (Some(email), Some(at)) = (claude.email.as_deref().filter(|v| !v.is_empty()), claude.updated_at) {
        for (window, usage) in [(Window::FiveHour, &claude.five_hour), (Window::Weekly, &claude.weekly)] {
            if let Some(usage) = usage { out.push(Reading { provider: Provider::Claude, account_key: identity(Provider::Claude, email),
                account_id: "active", label: "Claude", group_id: None, group_label: None, window, usage, at, successful: claude.error.is_none() }); }
        }
    }
    out
}

fn valid_hash(value: &str) -> bool { value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit()) }
fn valid_group(value: &str) -> bool { !value.is_empty() && value.len() <= 96 && value.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-') }

pub fn valid_retention(days: u16) -> bool { matches!(days, 7 | 30 | 90) }

impl HistoryStore {
    pub fn is_dirty(&self) -> bool { self.dirty }
    pub fn mark_saved(&mut self) { self.dirty = false; }

    pub fn load(directory: &Path, retention: u16, now: i64) -> Self {
        let path = directory.join("usage-history.json");
        let mut store: Self = fs::metadata(&path).ok().filter(|meta| meta.len() <= MAX_FILE_BYTES)
            .and_then(|_| fs::read(path).ok()).and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .filter(|store: &Self| store.version == VERSION).unwrap_or_default();
        store.prune(retention, now);
        store
    }

    pub fn capture(&mut self, snapshot: &Snapshot, now: i64) {
        self.capture_readings(readings(&snapshot.accounts, &snapshot.antigravity, &snapshot.claude), snapshot.settings.history_retention_days, now);
    }

    fn capture_readings(&mut self, readings: Vec<Reading<'_>>, retention: u16, now: i64) {
        self.prune(retention, now);
        // Pick the newest successful owner when active and saved profiles share a login.
        let mut newest = HashMap::new();
        for reading in readings.into_iter().filter(|r| r.successful && r.at > 0 && r.at <= now + 60 && now - r.at <= 900
            && r.usage.remaining.is_finite() && (0.0..=100.0).contains(&r.usage.remaining)
            && r.group_id.is_none_or(valid_group)) {
            let id = format!("{}:{}:{}:{}", reading.provider.key(), reading.account_key, reading.group_id.unwrap_or_default(), reading.window.key());
            match newest.entry(id) {
                std::collections::hash_map::Entry::Vacant(entry) => { entry.insert(reading); }
                std::collections::hash_map::Entry::Occupied(mut entry) => {
                    if reading.at > entry.get().at { entry.insert(reading); }
                }
            }
        }
        // Stable sorting makes aliases reproducible across a refresh with multiple new accounts.
        let mut incoming: Vec<_> = newest.into_iter().collect();
        incoming.sort_by(|(a, _), (b, _)| a.cmp(b));
        for (id, reading) in incoming {
            let existing = self.series.iter().position(|series| series.id == id);
            let index = if let Some(index) = existing { index } else {
                if self.series.len() >= MAX_SERIES { continue; }
                let alias = self.series.iter().find(|series| series.provider == reading.provider && series.account_key == reading.account_key)
                    .map(|series| series.alias).unwrap_or_else(|| { let alias = self.next_alias; self.next_alias = self.next_alias.saturating_add(1); alias });
                self.series.push(StoredSeries { id, provider: reading.provider, account_key: reading.account_key, alias,
                    group_id: reading.group_id.map(str::to_owned), window: reading.window, samples: vec![] });
                self.series.len() - 1
            };
            let samples = &mut self.series[index].samples;
            if samples.last().is_some_and(|last| reading.at <= last.at || reading.at - last.at < 60
                || (reading.at - last.at < SAMPLE_INTERVAL && reading.usage.resets_at == last.resets_at && reading.usage.remaining <= last.remaining + 0.001)) { continue; }
            samples.push(HistorySample { at: reading.at, remaining: reading.usage.remaining, resets_at: reading.usage.resets_at });
            self.dirty = true;
        }
        self.prune(retention, now);
    }

    pub fn prune(&mut self, retention: u16, now: i64) {
        let retention = if valid_retention(retention) { retention } else { 30 };
        let cutoff = now.saturating_sub(i64::from(retention) * 86400);
        let detailed_cutoff = now.saturating_sub(7 * 86400);
        let initial_series = self.series.len();
        let initial_samples: usize = self.series.iter().map(|series| series.samples.len()).sum();
        self.series.retain(|series| valid_hash(&series.account_key) && series.group_id.as_deref().is_none_or(valid_group));
        let mut ids = HashSet::new();
        self.series.retain(|series| ids.insert(series.id.clone()));
        for series in &mut self.series {
            series.samples.retain(|sample| sample.at >= cutoff && sample.at > 0 && sample.at <= now + 60
                && sample.remaining.is_finite() && (0.0..=100.0).contains(&sample.remaining));
            series.samples.sort_by_key(|sample| sample.at);
            series.samples.dedup_by_key(|sample| sample.at);
            // Keep actual readings, never interpolated values, when compacting older history.
            let mut compacted: Vec<HistorySample> = Vec::with_capacity(series.samples.len());
            for sample in series.samples.drain(..) {
                if sample.at < detailed_cutoff && compacted.last().is_some_and(|last| last.at < detailed_cutoff && last.at / 3600 == sample.at / 3600
                    && last.resets_at == sample.resets_at && sample.remaining <= last.remaining + 0.001) {
                    *compacted.last_mut().unwrap() = sample;
                } else { compacted.push(sample); }
            }
            series.samples = compacted;
        }
        self.series.retain(|series| !series.samples.is_empty());
        self.series.sort_by_key(|series| std::cmp::Reverse(series.samples.last().map(|sample| sample.at).unwrap_or_default()));
        self.series.truncate(MAX_SERIES);
        let total: usize = self.series.iter().map(|series| series.samples.len()).sum();
        if total > MAX_SAMPLES {
            let mut timestamps: Vec<_> = self.series.iter().flat_map(|series| series.samples.iter().map(|sample| sample.at)).collect();
            timestamps.sort_unstable();
            let remove_before = timestamps[total - MAX_SAMPLES];
            for series in &mut self.series { series.samples.retain(|sample| sample.at > remove_before); }
            self.series.retain(|series| !series.samples.is_empty());
        }
        let next_alias = self.next_alias.max(self.series.iter().map(|series| series.alias.saturating_add(1)).max().unwrap_or(1));
        self.dirty |= initial_series != self.series.len() || initial_samples != self.series.iter().map(|series| series.samples.len()).sum::<usize>() || self.next_alias != next_alias;
        self.next_alias = next_alias;
    }

    pub fn query(&self, snapshot: &Snapshot, range_hours: u16, now: i64) -> UsageHistory {
        let cutoff = now.saturating_sub(i64::from(range_hours) * 3600);
        let current = readings(&snapshot.accounts, &snapshot.antigravity, &snapshot.claude);
        let privacy = snapshot.settings.privacy_mode;
        let mut series: Vec<_> = self.series.iter().filter_map(|stored| {
            let samples: Vec<_> = stored.samples.iter().filter(|sample| sample.at >= cutoff && sample.at <= now).cloned().collect();
            if samples.is_empty() { return None; }
            let owner = current.iter().find(|r| r.provider == stored.provider && r.account_key == stored.account_key && r.group_id == stored.group_id.as_deref() && r.window == stored.window);
            let generic = format!("{} account {}", stored.provider.name(), stored.alias);
            let label = if privacy { generic.clone() } else { owner.map(|r| r.label).filter(|label| !label.is_empty()).map(str::to_owned).unwrap_or(generic) };
            let group_label = stored.group_id.as_ref().map(|id| owner.and_then(|r| r.group_label).unwrap_or(id).to_owned());
            let estimate = owner.filter(|reading| reading.successful && stored.samples.last().is_some_and(|last| last.resets_at == reading.usage.resets_at
                && reading.usage.remaining <= last.remaining + 0.001)).and_then(|_| pacing(&stored.samples, now));
            Some(HistorySeries { id: stored.id.clone(), provider: stored.provider,
                account_id: owner.map(|r| r.account_id.to_owned()).unwrap_or_else(|| format!("history-{}", stored.account_key)), label, group_label,
                window: stored.window, samples, pacing: estimate })
        }).collect();
        series.sort_by(|a, b| (a.provider.key(), &a.label, &a.group_label, a.window.key()).cmp(&(b.provider.key(), &b.label, &b.group_label, b.window.key())));
        UsageHistory { series, retention_days: snapshot.settings.history_retention_days,
            recording_since: self.series.iter().flat_map(|series| series.samples.first().map(|sample| sample.at)).min() }
    }
}

pub fn pacing(samples: &[HistorySample], now: i64) -> Option<PacingEstimate> {
    let latest = samples.last()?;
    if latest.at > now || now - latest.at > 900 || latest.remaining <= 0.0 || latest.resets_at.is_some_and(|reset| reset <= now) { return None; }
    let mut start = samples.len() - 1;
    while start > 0 {
        let previous = &samples[start - 1]; let next = &samples[start];
        if previous.resets_at != latest.resets_at || next.at - previous.at > 1200 || next.remaining > previous.remaining + 0.001
            || previous.at < latest.at - 4 * 3600 { break; }
        start -= 1;
    }
    let first = &samples[start];
    let span = latest.at - first.at;
    let consumed = first.remaining - latest.remaining;
    if samples.len() - start < 3 || span < 900 || consumed < 1.0 { return None; }
    let rate = consumed * 3600.0 / span as f64;
    if !rate.is_finite() || rate <= 0.0 { return None; }
    let exhausts = latest.at.saturating_add((latest.remaining / rate * 3600.0).ceil() as i64);
    if exhausts <= now { return None; }
    Some(PacingEstimate { percentage_points_per_hour: rate, estimated_exhausts_at: exhausts, reset_at: latest.resets_at,
        may_run_out_before_reset: latest.resets_at.is_some_and(|reset| exhausts < reset), observed_minutes: (span / 60) as u64 })
}

fn validate_range(hours: u16) -> Result<(), String> {
    if !(1..=2160).contains(&hours) { return Err("Choose a history range between one hour and 90 days.".into()); }
    Ok(())
}

pub fn csv(history: &UsageHistory) -> String {
    fn cell(value: &str) -> String {
        // Spreadsheet applications interpret leading formula characters even inside CSV quotes.
        let unsafe_start = value.trim_start_matches(|c: char| c.is_whitespace() || c.is_control()).starts_with(['=', '+', '-', '@']);
        let value = if unsafe_start { format!("'{value}") } else { value.to_owned() };
        format!("\"{}\"", value.replace('"', "\"\""))
    }
    let mut out = "provider,account,group,window,observed_at_unix,remaining_percent,resets_at_unix\r\n".to_owned();
    for series in &history.series {
        for sample in &series.samples {
            out.push_str(&format!("{},{},{},{},{},{:.4},{}\r\n", series.provider.key(), cell(&series.label), cell(series.group_label.as_deref().unwrap_or_default()),
                series.window.key(), sample.at, sample.remaining, sample.resets_at.map(|at| at.to_string()).unwrap_or_default()));
        }
    }
    out
}

#[tauri::command]
pub fn get_usage_history(app: AppHandle, range_hours: u16) -> Result<UsageHistory, String> {
    validate_range(range_hours)?;
    let state = app.state::<AppState>();
    let snapshot = state.snapshot.lock().unwrap().clone();
    let mut history = state.usage_history.lock().unwrap();
    history.prune(snapshot.settings.history_retention_days, state::now());
    Ok(history.query(&snapshot, range_hours, state::now()))
}

#[tauri::command]
pub fn export_usage_history(app: AppHandle, range_hours: u16) -> Result<String, String> {
    Ok(csv(&get_usage_history(app, range_hours)?))
}

#[tauri::command]
pub fn clear_usage_history(app: AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    state.save_history_change(HistoryStore::default())?;
    state.emit(&app);
    Ok(())
}

#[tauri::command]
pub fn update_history_settings(app: AppHandle, retention_days: u16) -> Result<(), String> {
    if !valid_retention(retention_days) { return Err("Choose 7, 30, or 90 days of history.".into()); }
    let state = app.state::<AppState>();
    state.save_history_retention(retention_days)?;
    state.emit(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{model::{AppTheme, ProviderColors, UpdateStatus}, state::{Config, Settings}, usage::{Health, UsagePreferences}};

    fn account(at: i64, remaining: f64) -> Account {
        Account { id: "desktop".into(), label: "Private work account".into(), email: Some("private@example.com".into()), identity: Some("private@example.com:org-1".into()),
            five_hour: Some(UsageWindow { remaining, resets_at: Some(100_000) }), updated_at: Some(at), desktop: true, ..Account::default() }
    }

    fn snapshot(accounts: Vec<Account>) -> Snapshot {
        Snapshot { accounts, active_account_id: Some("desktop".into()), antigravity: AntigravityStatus::default(), claude: ClaudeStatus::default(), alerts: vec![],
            update: UpdateStatus::default(), refreshing: false, desktop_error: None, login: None, switching: None, health: Health::default(),
            settings: Settings { start_with_windows: false, refresh_seconds: 60, notch_source: "codex".into(), notifications_enabled: true, provider_colors: ProviderColors::default(),
                hidden_providers: vec![], app_theme: AppTheme::default(), usage_preferences: UsagePreferences::default(), privacy_mode: false, history_retention_days: 30 } }
    }

    fn sample(at: i64, remaining: f64, resets_at: Option<i64>) -> HistorySample { HistorySample { at, remaining, resets_at } }

    #[test]
    fn recording_uses_successful_read_times_and_deduplicates_same_login_and_cadence() {
        let mut store = HistoryStore::default();
        let mut active = account(1000, 90.0);
        let mut saved = active.clone(); saved.id = "saved".into(); saved.updated_at = Some(1060); saved.five_hour.as_mut().unwrap().remaining = 88.0;
        store.capture(&snapshot(vec![active.clone(), saved.clone()]), 1060);
        assert_eq!(store.series.len(), 1);
        assert_eq!(store.series[0].samples, vec![sample(1060, 88.0, Some(100_000))]);
        store.capture(&snapshot(vec![active.clone(), saved]), 1100);
        active.updated_at = Some(1180); active.five_hour.as_mut().unwrap().remaining = 85.0;
        store.capture(&snapshot(vec![active.clone()]), 1180);
        assert_eq!(store.series[0].samples.len(), 1);
        active.updated_at = Some(1360); active.error = Some("network unavailable".into());
        store.capture(&snapshot(vec![active.clone()]), 1360);
        assert_eq!(store.series[0].samples.len(), 1);
        active.error = None; store.capture(&snapshot(vec![active.clone()]), 1360);
        assert_eq!(store.series[0].samples.len(), 2);
        active.updated_at = Some(1420); active.five_hour = Some(UsageWindow { remaining: 100.0, resets_at: Some(200_000) });
        store.capture(&snapshot(vec![active]), 1420);
        assert_eq!(store.series[0].samples.len(), 3, "a reset is retained immediately after the one-minute minimum");
    }

    #[test]
    fn unknown_and_changed_accounts_do_not_share_history() {
        let mut store = HistoryStore::default();
        let first = account(1000, 90.0);
        let mut second = first.clone(); second.identity = Some("private@example.com:org-2".into());
        let mut unknown = first.clone(); unknown.identity = None; unknown.email = None;
        store.capture(&snapshot(vec![first, second, unknown]), 1000);
        assert_eq!(store.series.len(), 2);
        assert_ne!(store.series[0].account_key, store.series[1].account_key);
        let bytes = serde_json::to_string(&store).unwrap();
        assert!(!bytes.contains("private")); assert!(!bytes.contains("org-")); assert!(!bytes.contains("work account"));
    }

    #[test]
    fn retention_prunes_and_old_readings_compact_to_actual_hourly_samples() {
        let now = 100 * 86400;
        let mut store = HistoryStore::default();
        store.capture(&snapshot(vec![account(now, 90.0)]), now);
        store.series[0].samples = vec![sample(now - 31 * 86400, 99.0, None), sample(now - 10 * 86400, 97.0, None),
            sample(now - 10 * 86400 + 300, 96.0, None), sample(now - 6 * 86400, 95.0, None), sample(now - 6 * 86400 + 300, 94.0, None)];
        store.prune(30, now);
        assert_eq!(store.series[0].samples.len(), 3);
        assert_eq!(store.series[0].samples[0], sample(now - 10 * 86400 + 300, 96.0, None));
        store.prune(7, now);
        assert_eq!(store.series[0].samples.len(), 2);
        assert!(!valid_retention(0)); assert!(!valid_retention(365));
        assert!(valid_retention(7) && valid_retention(30) && valid_retention(90));
    }

    #[test]
    fn pacing_uses_percentage_points_and_marks_only_known_reset_risk() {
        let samples = vec![sample(1000, 100.0, Some(20_000)), sample(1300, 98.0, Some(20_000)), sample(1600, 96.0, Some(20_000)), sample(1900, 94.0, Some(20_000))];
        let estimate = pacing(&samples, 1900).unwrap();
        assert_eq!(estimate.percentage_points_per_hour, 24.0);
        assert_eq!(estimate.observed_minutes, 15);
        assert_eq!(estimate.estimated_exhausts_at, 16_000);
        assert!(estimate.may_run_out_before_reset);
        let unknown: Vec<_> = samples.into_iter().map(|mut sample| { sample.resets_at = None; sample }).collect();
        let estimate = pacing(&unknown, 1900).unwrap();
        assert_eq!(estimate.reset_at, None);
        assert!(!estimate.may_run_out_before_reset);
    }

    #[test]
    fn pacing_refuses_sparse_stale_flat_reset_due_or_broken_cycles() {
        let valid = vec![sample(1000, 100.0, Some(20_000)), sample(1300, 98.0, Some(20_000)), sample(1600, 96.0, Some(20_000)), sample(1900, 94.0, Some(20_000))];
        assert!(pacing(&valid, 2801).is_none());
        assert!(pacing(&valid[..2], 1300).is_none());
        assert!(pacing(&[sample(1000, 90.0, None), sample(1300, 90.0, None), sample(1900, 90.0, None)], 1900).is_none());
        let mut gap = valid.clone(); gap[3].at = 2900; assert!(pacing(&gap, 2900).is_none());
        let mut reset = valid.clone(); reset[3].resets_at = Some(30_000); assert!(pacing(&reset, 1900).is_none());
        let mut jump = valid.clone(); jump[2].remaining = 99.0; assert!(pacing(&jump, 1900).is_none());
        let due: Vec<_> = valid.into_iter().map(|mut sample| { sample.resets_at = Some(1900); sample }).collect();
        assert!(pacing(&due, 1900).is_none());
    }

    #[test]
    fn history_queries_filter_range_and_redact_exports_with_safe_csv_cells() {
        let now = 200_000;
        let mut current = snapshot(vec![account(now, 90.0)]);
        current.accounts[0].label = "=HYPERLINK(\"private\")".into();
        let mut store = HistoryStore::default(); store.capture(&current, now);
        store.series[0].samples.insert(0, sample(now - 25 * 3600, 100.0, None));
        let history = store.query(&current, 24, now);
        assert_eq!(history.series[0].samples.len(), 1);
        assert_eq!(history.recording_since, Some(now - 25 * 3600));
        let exported = csv(&history);
        assert!(exported.contains("\"'=HYPERLINK(\"\"private\"\")\""));
        current.settings.privacy_mode = true;
        let redacted = store.query(&current, 168, now);
        assert_eq!(redacted.series[0].label, "Codex account 1");
        assert!(!csv(&redacted).contains("private"));
        assert!(!csv(&redacted).contains("HYPERLINK"));
        assert!(validate_range(0).is_err()); assert!(validate_range(2161).is_err());
    }

    #[test]
    fn loading_recovers_from_unknown_versions_and_invalid_files_without_inventing_samples() {
        let directory = tempfile::tempdir().unwrap();
        let mut store = HistoryStore::default(); store.capture(&snapshot(vec![account(1000, 90.0)]), 1000);
        let path = directory.path().join("usage-history.json");
        fs::write(&path, serde_json::to_vec(&store).unwrap()).unwrap();
        let loaded = HistoryStore::load(directory.path(), 30, 1000);
        assert_eq!(loaded.series[0].samples, store.series[0].samples);
        store.version = 2;
        fs::write(&path, serde_json::to_vec(&store).unwrap()).unwrap();
        assert!(HistoryStore::load(directory.path(), 30, 1000).series.is_empty());
        fs::write(&path, b"partial data").unwrap();
        assert!(HistoryStore::load(directory.path(), 30, 1000).series.is_empty());
        let old: Config = serde_json::from_str(r#"{"refreshSeconds":60}"#).unwrap();
        assert_eq!(old.history_retention_days, 30); assert!(!old.privacy_mode);
    }

    #[test]
    fn query_suppresses_forecast_for_old_accounts_and_connection_failures() {
        let mut store = HistoryStore::default();
        let mut current = snapshot(vec![]);
        for (at, remaining) in [(1000, 100.0), (1300, 98.0), (1600, 96.0), (1900, 94.0)] {
            current.accounts = vec![account(at, remaining)]; store.capture(&current, at);
        }
        assert!(store.query(&current, 24, 1900).series[0].pacing.is_some());
        current.accounts[0].error = Some("Offline".into());
        assert!(store.query(&current, 24, 1900).series[0].pacing.is_none());
        current.accounts.clear();
        assert!(store.query(&current, 24, 1900).series[0].pacing.is_none());
    }

    #[test]
    fn weekly_pacing_uses_its_own_reset_and_provider_windows_keep_separate_series() {
        let mut store = HistoryStore::default();
        let mut current = snapshot(vec![]);
        for (at, remaining) in [(1000, 100.0), (1300, 98.0), (1600, 96.0), (1900, 94.0)] {
            let mut codex = account(at, remaining);
            codex.weekly = Some(UsageWindow { remaining, resets_at: Some(200_000) });
            current.accounts = vec![codex];
            current.claude = ClaudeStatus { email: Some("private@example.com".into()), five_hour: Some(UsageWindow { remaining, resets_at: Some(300_000) }),
                updated_at: Some(at), ..ClaudeStatus::default() };
            let active = crate::model::AntigravityAccount { id: "active".into(), label: "AGY".into(), email: Some("private@example.com".into()),
                groups: vec![crate::model::AntigravityGroup { id: "gemini".into(), label: "Gemini".into(), weekly: Some(UsageWindow { remaining, resets_at: Some(400_000) }), ..Default::default() }],
                updated_at: Some(at), active: true, ..Default::default() };
            let mut duplicate = active.clone(); duplicate.id = "saved".into(); duplicate.email = Some("PRIVATE@example.com".into()); duplicate.active = false;
            current.antigravity.accounts = vec![active, duplicate];
            store.capture(&current, at);
        }
        let queried = store.query(&current, 24, 1900);
        assert_eq!(queried.series.len(), 4);
        let weekly = queried.series.iter().find(|s| s.provider == Provider::Codex && s.window == Window::Weekly).unwrap();
        assert_eq!(weekly.pacing.as_ref().unwrap().reset_at, Some(200_000));
        assert!(queried.series.iter().all(|series| series.samples.len() == 4 && series.pacing.is_some()));
    }

    #[test]
    fn history_is_hard_bounded_and_only_changed_history_requires_a_write() {
        let now = 1_000_000;
        let mut store = HistoryStore::default();
        assert!(!store.is_dirty());
        let current = snapshot(vec![account(now, 90.0)]);
        store.capture(&current, now); assert!(store.is_dirty());
        store.mark_saved(); store.capture(&current, now + 60); assert!(!store.is_dirty());
        store.series[0].samples = (0..MAX_SAMPLES + 10).map(|i| sample(now - (MAX_SAMPLES + 9 - i) as i64, 90.0, None)).collect();
        store.prune(30, now);
        assert!(store.is_dirty());
        assert!(store.series.iter().map(|series| series.samples.len()).sum::<usize>() <= MAX_SAMPLES);
        assert_eq!(store.series[0].samples.last().unwrap().at, now);
    }
}
