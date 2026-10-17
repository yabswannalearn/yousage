use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    pub remaining: f64,
    pub resets_at: Option<i64>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub label: String,
    pub email: Option<String>,
    pub plan: Option<String>,
    pub identity: Option<String>,
    pub five_hour: Option<UsageWindow>,
    pub weekly: Option<UsageWindow>,
    pub updated_at: Option<i64>,
    pub error: Option<String>,
    pub desktop: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AntigravityGroup {
    pub id: String,
    pub label: String,
    pub description: Option<String>,
    pub five_hour: Option<UsageWindow>,
    pub weekly: Option<UsageWindow>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AntigravityStatus {
    pub email: Option<String>,
    pub groups: Vec<AntigravityGroup>,
    pub updated_at: Option<i64>,
    pub error: Option<String>,
}

pub fn allowance(value: &Value) -> Option<UsageWindow> {
    let used = value.get("usedPercent")?.as_f64()?;
    used.is_finite().then(|| UsageWindow {
        remaining: (100.0 - used).clamp(0.0, 100.0),
        resets_at: value.get("resetsAt").and_then(Value::as_i64),
    })
}

pub fn parse_limits(value: &Value) -> (Option<UsageWindow>, Option<UsageWindow>) {
    let bucket = value
        .pointer("/rateLimitsByLimitId/codex")
        .filter(|v| v.is_object())
        .or_else(|| value.get("rateLimits"));
    let Some(bucket) = bucket else { return (None, None) };
    let mut five_hour = None;
    let mut weekly = None;
    for field in ["primary", "secondary"] {
        let window = &bucket[field];
        match window["windowDurationMins"].as_u64() {
            Some(300) => five_hour = allowance(window),
            Some(10080) => weekly = allowance(window),
            _ => {}
        }
    }
    (five_hour, weekly)
}

pub fn parse_rfc3339(text: &str) -> Option<i64> {
    let (date, rest) = text.trim().split_once(['T', 't'])?;
    let mut date_parts = date.splitn(3, '-');
    let year: i64 = date_parts.next()?.parse().ok()?;
    let month: i64 = date_parts.next()?.parse().ok()?;
    let day: i64 = date_parts.next()?.parse().ok()?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) { return None; }
    let (time_part, offset_secs) = if let Some(stripped) = rest.strip_suffix(['Z', 'z']) {
        (stripped, 0i64)
    } else if let Some(pos) = rest.rfind(['+', '-']) {
        let (t, off) = rest.split_at(pos);
        let sign = if off.starts_with('-') { -1i64 } else { 1i64 };
        let (oh, om) = off[1..].split_once(':')?;
        let offset = sign * (oh.parse::<i64>().ok()? * 3600 + om.parse::<i64>().ok()? * 60);
        (t, offset)
    } else {
        return None;
    };
    let mut time_parts = time_part.splitn(3, ':');
    let hour: i64 = time_parts.next()?.parse().ok()?;
    let minute: i64 = time_parts.next()?.parse().ok()?;
    let second: i64 = time_parts.next()?.split('.').next()?.parse().ok()?;
    if !(0..=23).contains(&hour) || !(0..=59).contains(&minute) || !(0..=60).contains(&second) { return None; }
    let y = year - i64::from(month <= 2);
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    Some(days * 86400 + hour * 3600 + minute * 60 + second - offset_secs)
}

fn slug(label: &str) -> String {
    let mut out = String::new();
    for ch in label.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    out.trim_end_matches('-').to_owned()
}

fn antigravity_bucket(bucket: &Value, group_name: &str, response_tsv: &str) -> Option<UsageWindow> {
    if bucket["disabled"].as_bool() == Some(true) { return None; }
    let bucket_name = bucket["name"].as_str().unwrap_or_default();
    let percent = bucket.get("remaining_fraction").and_then(Value::as_f64).map(|f| f * 100.0).or_else(|| {
        let prefix = format!("{group_name}\t{bucket_name}\t");
        response_tsv.lines().find_map(|line| {
            let rest = line.strip_prefix(&prefix)?;
            rest.split('\t').next()?.strip_suffix('%')?.parse::<f64>().ok()
        })
    })?;
    percent.is_finite().then(|| UsageWindow {
        remaining: percent.clamp(0.0, 100.0),
        resets_at: bucket.get("reset_time").and_then(Value::as_str).and_then(parse_rfc3339),
    })
}

pub fn parse_antigravity_usage(value: &Value) -> Vec<AntigravityGroup> {
    let Some(groups) = value.pointer("/command/data/groups").and_then(Value::as_array) else { return vec![]; };
    let response_tsv = value["response"].as_str().unwrap_or_default();
    let mut result = Vec::new();
    for group in groups {
        let Some(label) = group["name"].as_str().map(str::trim).filter(|s| !s.is_empty()) else { continue; };
        let id = slug(label);
        if id.is_empty() { continue; }
        let description = group["description"].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_owned);
        let mut five_hour = None;
        let mut weekly = None;
        if let Some(buckets) = group["buckets"].as_array() {
            for bucket in buckets {
                match bucket["window"].as_str() {
                    Some("5h") => five_hour = antigravity_bucket(bucket, label, response_tsv),
                    Some("weekly") => weekly = antigravity_bucket(bucket, label, response_tsv),
                    _ => {}
                }
            }
        }
        if five_hour.is_some() || weekly.is_some() {
            result.push(AntigravityGroup { id, label: label.to_owned(), description, five_hour, weekly });
        }
    }
    result
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
pub struct Point {
    pub x: i32,
    pub y: i32,
}

#[derive(Clone, Copy, Debug)]
pub struct WorkArea {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Debug)]
pub struct PanelPlacement {
    pub x: i32,
    pub y: i32,
    pub height: i32,
    pub upward: bool,
}

pub fn place_panel(anchor: Point, work: WorkArea, width: i32, compact: i32, wanted: i32) -> PanelPlacement {
    let x = anchor.x.clamp(work.x, work.x + (work.width - width).max(0));
    let anchor_y = anchor.y.clamp(work.y, work.y + (work.height - compact).max(0));
    let down = work.y + work.height - anchor_y;
    let up = anchor_y + compact - work.y;
    let upward = wanted > down && up > down;
    let height = wanted.max(compact).min(if upward { up } else { down });
    PanelPlacement {
        x,
        y: if upward { anchor_y + compact - height } else { anchor_y },
        height,
        upward,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn quotas_use_duration_and_preserve_unknown_values() {
        let (short, week) = parse_limits(&json!({"rateLimitsByLimitId":{"codex":{
            "primary":{"usedPercent":30,"windowDurationMins":10080,"resetsAt":123},
            "secondary":{"usedPercent":58,"windowDurationMins":300,"resetsAt":456}
        }}}));
        assert_eq!(short.unwrap().remaining, 42.0);
        assert_eq!(week.unwrap().remaining, 70.0);
        assert!(allowance(&json!({"usedPercent":null})).is_none());
        assert_eq!(allowance(&json!({"usedPercent":100})).unwrap().remaining, 0.0);
    }

    #[test]
    fn multi_bucket_quota_takes_precedence_over_legacy() {
        let (short, _) = parse_limits(&json!({
            "rateLimits":{"primary":{"usedPercent":90,"windowDurationMins":300}},
            "rateLimitsByLimitId":{"codex":{"primary":{"usedPercent":20,"windowDurationMins":300}}}
        }));
        assert_eq!(short.unwrap().remaining, 80.0);
        assert!(parse_limits(&json!({})).0.is_none());
    }

    #[test]
    fn antigravity_usage_parses_groups_windows_and_zero_fallback() {
        let groups = parse_antigravity_usage(&json!({
            "status": "SUCCESS",
            "response": "Gemini Models\tWeekly Limit Remaining\t100%\t2026-10-24T06:56:53Z\nGemini Models\tFive Hour Limit Remaining\t0%\t2026-10-17T11:56:53Z\nGemini 4 Argon\tGemini 4 Argon Weekly Limit\t90%\t2026-10-24T05:01:46Z\n",
            "command": {
                "name": "usage",
                "data": {
                    "groups": [
                        {
                            "name": "Gemini Models",
                            "description": "Models within this group: Gemini Flash, Gemini Pro",
                            "buckets": [
                                {"id": "gemini-weekly", "name": "Weekly Limit Remaining", "window": "weekly", "remaining_fraction": 1.0, "reset_time": "2026-10-24T06:56:53Z"},
                                {"id": "gemini-5h", "name": "Five Hour Limit Remaining", "window": "5h", "reset_time": "2026-10-17T11:56:53Z"}
                            ]
                        },
                        {
                            "name": "Gemini 4 Argon",
                            "buckets": [
                                {"id": "gemini-argon-wtu-weekly", "name": "Gemini 4 Argon Weekly Limit", "window": "weekly", "remaining_fraction": 0.9, "reset_time": "2026-10-24T05:01:46Z"}
                            ]
                        }
                    ]
                }
            }
        }));
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].id, "gemini-models");
        assert_eq!(groups[0].five_hour.as_ref().unwrap().remaining, 0.0);
        assert_eq!(groups[0].weekly.as_ref().unwrap().remaining, 100.0);
        assert_eq!(groups[0].weekly.as_ref().unwrap().resets_at, Some(1792825013));
        assert_eq!(groups[1].id, "gemini-4-argon");
        assert!(groups[1].five_hour.is_none());
        assert_eq!(groups[1].weekly.as_ref().unwrap().remaining, 90.0);
        assert_eq!(parse_rfc3339("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_rfc3339("not-a-timestamp"), None);
    }

    #[test]
    fn panel_opens_up_near_bottom_and_respects_negative_monitor_coordinates() {
        let work = WorkArea { x: -1920, y: 0, width: 1920, height: 1040 };
        let placement = place_panel(Point { x: -200, y: 940 }, work, 344, 80, 480);
        assert!(placement.upward);
        assert_eq!(placement.x, -344);
        assert_eq!(placement.y + placement.height, 1020);
        assert!(placement.y >= work.y);
    }

    #[test]
    fn panel_stays_on_screen_when_neither_direction_fits() {
        let work = WorkArea { x: 0, y: 0, width: 800, height: 500 };
        let placement = place_panel(Point { x: 100, y: 180 }, work, 344, 80, 650);
        assert_eq!(placement.height, 320);
        assert!(!placement.upward);
        assert_eq!(placement.y + placement.height, 500);
    }
}
