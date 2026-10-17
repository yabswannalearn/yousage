use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
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
