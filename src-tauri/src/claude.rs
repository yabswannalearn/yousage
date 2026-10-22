use crate::{model::{parse_rfc3339, ClaudeStatus, UsageWindow}, state::{now, AppState}, usage::{HealthStatus, ProviderHealth}};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{path::PathBuf, process::Stdio, sync::atomic::Ordering, time::Duration};
use tauri::{AppHandle, Manager};
use tokio::{io::AsyncWriteExt, process::Command, time::timeout};
use zeroize::Zeroizing;

const REFRESH_SECONDS: u64 = 300;

fn config_directory() -> PathBuf {
    std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from).unwrap_or_else(|| {
        std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from).unwrap_or_default().join(".claude")
    })
}

fn read_sign_in() -> Result<(Zeroizing<String>, Option<String>, Option<String>), String> {
    let directory = config_directory();
    let bytes = Zeroizing::new(std::fs::read(directory.join(".credentials.json"))
        .map_err(|_| "Sign in to a Claude subscription with `claude auth login` to see usage.".to_owned())?);
    let credentials: Value = serde_json::from_slice(&bytes)
        .map_err(|_| "Claude sign-in could not be read. Run `claude auth login` to reconnect.".to_owned())?;
    let oauth = &credentials["claudeAiOauth"];
    if oauth["expiresAt"].as_i64().is_some_and(|expires| expires <= now() * 1000) {
        return Err("Claude sign-in expired. Open Claude Code or run `claude auth login`, then refresh.".into());
    }
    let token = oauth["accessToken"].as_str().filter(|token| !token.is_empty()
        && token.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b)))
        .ok_or("A Claude subscription sign-in is required. Run `claude auth login`.")?;
    // Read only the account label. Neither credentials nor access tokens enter
    // the snapshot, webview, process arguments, or YouSage's saved files.
    let settings_path = directory.with_extension("json");
    let email = std::fs::read(settings_path).ok().and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .and_then(|settings| settings["oauthAccount"]["emailAddress"].as_str().map(str::to_owned));
    Ok((Zeroizing::new(token.to_owned()), email, oauth["subscriptionType"].as_str().map(str::to_owned)))
}

pub fn parse_usage(value: &Value) -> Result<(Option<UsageWindow>, Option<UsageWindow>), String> {
    if value.get("five_hour").is_none() && value.get("seven_day").is_none() {
        return Err("Claude returned an unrecognized usage response. Try again later.".into());
    }
    let window = |key: &str| {
        let data = &value[key];
        let used = data["utilization"].as_f64().filter(|n| n.is_finite())?;
        Some(UsageWindow {
            remaining: (100.0 - used).clamp(0.0, 100.0),
            resets_at: data["resets_at"].as_str().and_then(parse_rfc3339),
        })
    };
    Ok((window("five_hour"), window("seven_day")))
}

async fn fetch_usage(token: &str) -> Result<Value, (String, u64)> {
    let mut command = Command::new(if cfg!(windows) { "curl.exe" } else { "curl" });
    command.args([
        "--silent", "--show-error", "--max-time", "15", "--proto", "=https",
        "--config", "-", "--dump-header", "-", "--write-out", "\n%{http_code}",
        "-H", "Accept: application/json", "-H", "anthropic-beta: oauth-2025-04-20",
        "https://api.anthropic.com/api/oauth/usage",
    ]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let output = timeout(Duration::from_secs(17), async {
        let mut child = command.spawn().map_err(|_| ())?;
        let mut stdin = child.stdin.take().ok_or(())?;
        let header = Zeroizing::new(format!("header = \"Authorization: Bearer {token}\"\n"));
        stdin.write_all(header.as_bytes()).await.map_err(|_| ())?;
        drop(stdin);
        child.wait_with_output().await.map_err(|_| ())
    }).await.ok().and_then(Result::ok)
        .filter(|output| output.status.success())
        .ok_or_else(|| ("Could not reach Claude usage. Check your connection; last known readings are kept.".into(), REFRESH_SECONDS))?;
    parse_http_response(&String::from_utf8_lossy(&output.stdout))
}

fn parse_http_response(response: &str) -> Result<Value, (String, u64)> {
    let (response, status) = response.rsplit_once('\n').ok_or_else(|| ("Claude returned an invalid usage response.".into(), REFRESH_SECONDS))?;
    let (headers, body) = response.rsplit_once("\r\n\r\n").unwrap_or(("", response));
    match status.trim() {
        "200" => serde_json::from_str(body).map_err(|_| ("Claude returned an invalid usage response.".into(), REFRESH_SECONDS)),
        "401" | "403" => Err(("Claude sign-in needs attention. Run `claude auth login`, then refresh.".into(), REFRESH_SECONDS)),
        "429" => {
            let retry_after = headers.lines().find_map(|line| {
                let (key, value) = line.split_once(':')?;
                key.eq_ignore_ascii_case("retry-after").then(|| value.trim().parse::<u64>().ok()).flatten()
            }).unwrap_or(900).max(900);
            Err(("Claude usage is rate limited. Last known readings are kept; retrying later.".into(), retry_after))
        }
        _ => Err(("Claude usage is temporarily unavailable. Last known readings are kept.".into(), REFRESH_SECONDS)),
    }
}

pub async fn refresh(app: &AppHandle) {
    let state = app.state::<AppState>();
    let sign_in = read_sign_in();
    let (token, email, plan) = match sign_in {
        Ok(sign_in) => sign_in,
        Err(error) => {
            // Never present another or expired sign-in's cached allowance as live.
            {
                let mut snapshot = state.snapshot.lock().unwrap();
                snapshot.claude = ClaudeStatus { error: Some(error.clone()), ..ClaudeStatus::default() };
                let retry = now().saturating_add(snapshot.settings.refresh_seconds as i64);
                snapshot.health.claude.update("claude", Some(&error), None, Some(retry));
            }
            *state.claude_token_fingerprint.lock().unwrap() = None;
            state.emit(app);
            return;
        }
    };
    let fingerprint: [u8; 32] = Sha256::digest(token.as_bytes()).into();
    let previous_fingerprint = *state.claude_token_fingerprint.lock().unwrap();
    let changed_token = previous_fingerprint.as_ref() != Some(&fingerprint);
    let cached_email = state.snapshot.lock().unwrap().claude.email.clone();
    let changed_account = cached_email != email || (email.is_none() && changed_token);
    let known_auth_change = cached_email.as_ref().zip(email.as_ref()).is_some_and(|(old, current)| !old.eq_ignore_ascii_case(current));
    if !known_auth_change && (now() as u64) < state.claude_next_refresh.load(Ordering::SeqCst) {
        if changed_account {
            let mut snapshot = state.snapshot.lock().unwrap();
            snapshot.claude = ClaudeStatus { email, plan, error: Some("Claude usage is waiting for its retry cooldown.".into()), ..ClaudeStatus::default() };
            snapshot.health.claude.last_success_at = None;
        }
        // Remember the current token so an unchanged, unidentified sign-in does
        // not look like a different account on every background scan.
        *state.claude_token_fingerprint.lock().unwrap() = Some(fingerprint);
        state.emit(app);
        return;
    }
    *state.claude_token_fingerprint.lock().unwrap() = Some(fingerprint);
    {
        let mut snapshot = state.snapshot.lock().unwrap();
        if changed_account { snapshot.claude = ClaudeStatus::default(); }
        snapshot.health.claude = ProviderHealth::checking(snapshot.claude.updated_at);
    }
    state.emit(app);
    let result = fetch_usage(&token).await.and_then(|value| parse_usage(&value).map_err(|error| (error, REFRESH_SECONDS)))
        .and_then(|windows| if windows.0.is_none() && windows.1.is_none() {
            Err(("Claude returned no allowance windows for this sign-in.".into(), REFRESH_SECONDS))
        } else { Ok(windows) });
    let delay = result.as_ref().err().map(|(_, delay)| *delay).unwrap_or(REFRESH_SECONDS);
    state.claude_next_refresh.store((now() as u64).saturating_add(delay), Ordering::SeqCst);
    {
        let mut snapshot = state.snapshot.lock().unwrap();
        if changed_account { snapshot.claude = ClaudeStatus::default(); }
        let claude = &mut snapshot.claude;
        claude.email = email;
        claude.plan = plan;
        match result {
            Ok((five_hour, weekly)) => {
                claude.five_hour = five_hour; claude.weekly = weekly;
                claude.updated_at = Some(now()); claude.error = None;
            }
            Err((error, _)) => { claude.error = Some(error); }
        }
        let error = snapshot.claude.error.clone();
        let last_success = snapshot.claude.updated_at;
        let next_retry = state.claude_next_refresh.load(Ordering::SeqCst).min(i64::MAX as u64) as i64;
        snapshot.health.claude.update("claude", error.as_deref(), last_success, Some(next_retry));
        if snapshot.claude.five_hour.is_none() && snapshot.claude.weekly.is_none() && error.is_none() {
            snapshot.health.claude.status = HealthStatus::Error;
            snapshot.health.claude.message = "Claude returned no allowance windows for this sign-in.".into();
        }
    }
    state.emit(app);
    let _ = state.persist();
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn usage_converts_consumed_percent_and_parses_reset_times() {
        let (five, week) = parse_usage(&json!({
            "five_hour": {"utilization": 23.5, "resets_at": "2026-10-17T12:00:00Z"},
            "seven_day": {"utilization": 100, "resets_at": "2026-10-22T12:00:00+08:00"}
        })).unwrap();
        assert_eq!(five.as_ref().unwrap().remaining, 76.5);
        assert_eq!(five.unwrap().resets_at, parse_rfc3339("2026-10-17T12:00:00Z"));
        assert_eq!(week.unwrap().remaining, 0.0);
    }

    #[test]
    fn missing_and_null_windows_are_unknown_and_invalid_responses_fail() {
        assert_eq!(parse_usage(&json!({"five_hour": null, "seven_day": {"utilization": null}})).unwrap(), (None, None));
        assert!(parse_usage(&json!({"error": "unauthorized"})).is_err());
        let (five, week) = parse_usage(&json!({"five_hour": {"utilization": -5}, "seven_day": {"utilization": 150}})).unwrap();
        assert_eq!(five.unwrap().remaining, 100.0);
        assert_eq!(week.unwrap().remaining, 0.0);
    }

    #[test]
    fn http_responses_handle_proxy_headers_auth_errors_and_backoff() {
        let reply = "HTTP/1.1 200 Connection established\r\n\r\nHTTP/2 200\r\ncontent-type: application/json\r\n\r\n{\"five_hour\":null}\n200";
        assert!(parse_http_response(reply).unwrap()["five_hour"].is_null());
        let limited = "HTTP/2 429\r\nretry-after: 3600\r\n\r\n{}\n429";
        assert_eq!(parse_http_response(limited).unwrap_err().1, 3600);
        let immediate = "HTTP/2 429\r\nretry-after: 0\r\n\r\n{}\n429";
        assert_eq!(parse_http_response(immediate).unwrap_err().1, 900);
        assert!(parse_http_response("HTTP/2 401\r\n\r\n{}\n401").unwrap_err().0.contains("claude auth login"));
        assert!(parse_http_response("malformed response").is_err());
    }
}
