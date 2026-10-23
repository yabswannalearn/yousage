use crate::{model::{place_docked_panel, snap_center_x, snap_edge, DockEdge, Point, WorkArea}, state::{self, AppState}};
use serde::Serialize;
use std::sync::atomic::Ordering;
use tauri::{menu::{Menu, MenuItem}, tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent}, AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WindowEvent};
use tauri_plugin_autostart::ManagerExt;

const WIDTH: f64 = 440.0;
const COMPACT: f64 = 80.0;

#[derive(Default)]
pub struct WindowState { pub expanded: bool, pub upward: bool, pub dragging: bool }

#[tauri::command]
pub fn start_notch_drag(app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("The notch window is unavailable.")?;
    app.state::<AppState>().window.lock().unwrap().dragging = true;
    if window.start_dragging().is_err() {
        app.state::<AppState>().window.lock().unwrap().dragging = false;
        return Err("Could not move the notch.".into());
    }
    // Windows owns the mouse during a native move loop. Its focus changes must
    // not collapse the panel, and the webview may not receive pointerup.
    tauri::async_runtime::spawn(async move {
        #[cfg(windows)]
        while unsafe { windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState(1) } < 0 {
            tokio::time::sleep(std::time::Duration::from_millis(16)).await;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        let _ = finish_notch_drag(&app);
        app.state::<AppState>().window.lock().unwrap().dragging = false;
        let _ = app.state::<AppState>().persist();
        let _ = app.emit("notch-drag-finished", ());
    });
    Ok(())
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Layout { pub upward: bool, pub height: f64, pub width: f64, pub edge: DockEdge }

fn finish_notch_drag(app: &AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("The notch window is unavailable.")?;
    let monitor = window.current_monitor().map_err(|e| e.to_string())?.ok_or("Could not find a display.")?;
    let area = monitor.work_area();
    let scale = monitor.scale_factor();
    let work = WorkArea { x: area.position.x, y: area.position.y, width: area.size.width as i32, height: area.size.height as i32 };
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let edge = snap_edge(Point { x: position.x, y: position.y }, work, size.width as i32, size.height as i32, (28.0 * scale).round() as i32);
    let state = app.state::<AppState>();
    let (expanded, upward) = { let placement = state.window.lock().unwrap(); (placement.expanded, placement.upward) };
    let compact = if edge == DockEdge::Floating { COMPACT } else { 40.0 };
    let mut anchor = Point {
        x: if edge == DockEdge::Right { position.x + size.width as i32 - (58.0 * scale).round() as i32 } else { position.x },
        y: if edge == DockEdge::Bottom || (edge == DockEdge::Floating && expanded && upward) {
            position.y + size.height as i32 - (compact * scale).round() as i32
        } else { position.y },
    };
    if !matches!(edge, DockEdge::Left | DockEdge::Right) {
        let target_width = if matches!(edge, DockEdge::Top | DockEdge::Bottom) { (480.0 * scale).round() as i32 } else { size.width as i32 };
        // Detect proximity using the width the person actually dragged. Docking
        // can change that width, so center the resulting notch separately.
        if snap_center_x(Point { x: position.x, y: position.y }, work, size.width as i32, (32.0 * scale).round() as i32).is_some() {
            anchor.x = work.x + (work.width - target_width) / 2;
        }
    }
    { let mut config = state.config.lock().unwrap(); config.anchor = Some(anchor); config.dock_edge = edge; }
    set_expanded(app.clone(), expanded, size.height as f64 / scale)?;
    Ok(())
}

#[tauri::command]
pub fn set_expanded(app: AppHandle, expanded: bool, height: f64) -> Result<Layout, String> {
    let state = app.state::<AppState>();
    let window = app.get_webview_window("main").ok_or("The notch window is unavailable.")?;
    let (saved_anchor, edge) = { let config = state.config.lock().unwrap(); (config.anchor, config.dock_edge) };
    let saved_monitor = saved_anchor.and_then(|point| window.available_monitors().ok()?.into_iter().find(|monitor| {
        let area = monitor.work_area();
        point.x >= area.position.x && point.y >= area.position.y && point.x < area.position.x + area.size.width as i32 && point.y < area.position.y + area.size.height as i32
    }));
    let monitor = saved_monitor.or_else(|| window.current_monitor().ok().flatten()).or_else(|| window.primary_monitor().ok().flatten()).ok_or("Could not find a display.")?;
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let work = WorkArea { x: area.position.x, y: area.position.y, width: area.size.width as i32, height: area.size.height as i32 };
    let anchor = saved_anchor.unwrap_or(Point { x: work.x + work.width - (WIDTH * scale) as i32 - 20, y: work.y + 20 });
    let side = matches!(edge, DockEdge::Left | DockEdge::Right);
    let compact = if side { 184.0 } else if edge == DockEdge::Floating { COMPACT } else { 40.0 };
    let width = if side && !expanded { 58.0 } else if !side && edge != DockEdge::Floating { 480.0 } else { WIDTH }.min(work.width as f64 / scale);
    let desired = if expanded && height.is_finite() { height.clamp(compact, 700.0) } else { compact };
    let placement = place_docked_panel(anchor, work, edge, (width * scale).round() as i32, (compact * scale).round() as i32, (desired * scale).round() as i32);
    state.resizing.store(true, Ordering::SeqCst);
    let generation = state.resize_generation.fetch_add(1, Ordering::SeqCst) + 1;
    {
        let mut placement_state = state.window.lock().unwrap();
        placement_state.expanded = expanded;
        placement_state.upward = placement.upward;
    }
    let result = window.set_size(LogicalSize::new(width, placement.height as f64 / scale))
        .and_then(|_| window.set_position(PhysicalPosition::new(placement.x, placement.y)));
    let reset_app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(220)).await;
        let state = reset_app.state::<AppState>();
        if state.resize_generation.load(Ordering::SeqCst) == generation { state.resizing.store(false, Ordering::SeqCst); }
    });
    result.map_err(|_| "Could not resize the notch.")?;
    let layout = Layout { upward: placement.upward, height: placement.height as f64 / scale, width, edge };
    let _ = app.emit("notch-layout", &layout);
    Ok(layout)
}

pub fn show(app: &AppHandle) {
    let _ = set_expanded(app.clone(), false, COMPACT);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show(); let _ = window.set_focus();
        app.state::<AppState>().config.lock().unwrap().hidden = false;
        let _ = app.state::<AppState>().persist();
        let _ = app.emit("panel-collapsed", ());
    }
}

#[tauri::command]
pub fn hide_notch(app: AppHandle) {
    let _ = set_expanded(app.clone(), false, COMPACT);
    if let Some(window) = app.get_webview_window("main") { let _ = window.hide(); }
    let state = app.state::<AppState>();
    state.config.lock().unwrap().hidden = true;
    let _ = state.persist();
    let _ = app.emit("panel-collapsed", ());
}

fn tray_icon_image(attention: bool) -> tauri::image::Image<'static> {
    let size = 32usize;
    let mut rgba = vec![0u8; size * size * 4];
    let badge = if attention { [224u8, 175, 114, 255] } else { [183u8, 200, 177, 255] };
    for y in 0..size {
        for x in 0..size {
            let idx = (y * size + x) * 4;
            let dx = (x as f32 - 15.5).abs();
            let dy = (y as f32 - 15.5).abs();
            let in_box = dx <= 13.5 && dy <= 13.5 && ((dx - 9.5).max(0.0).powi(2) + (dy - 9.5).max(0.0).powi(2) <= 16.0);
            if in_box {
                rgba[idx..idx + 4].copy_from_slice(&[32, 34, 33, 255]);
            }
            let bar1 = (8..=10).contains(&x) && (12..=22).contains(&y);
            let bar2 = (14..=16).contains(&x) && (8..=22).contains(&y);
            let bar3 = (20..=22).contains(&x) && (15..=22).contains(&y);
            if bar1 || bar2 || bar3 {
                rgba[idx..idx + 4].copy_from_slice(&badge);
            }
            let dot_dist_sq = (x as f32 - 25.0).powi(2) + (y as f32 - 25.0).powi(2);
            if dot_dist_sq <= 20.0 {
                rgba[idx..idx + 4].copy_from_slice(&[23, 25, 24, 255]);
            }
            if dot_dist_sq <= 11.0 {
                rgba[idx..idx + 4].copy_from_slice(&badge);
            }
        }
    }
    tauri::image::Image::new_owned(rgba, size as u32, size as u32)
}

pub fn update_tray(app: &AppHandle, snapshot: &state::Snapshot) {
    let Some(tray) = app.tray_by_id("yousage") else { return; };
    let visible = |provider: &str| !snapshot.settings.hidden_providers.iter().any(|p| p == provider);
    let codex_active = snapshot.accounts.iter().find(|a| visible("codex") && Some(a.id.as_str()) == snapshot.active_account_id.as_deref());
    let codex_5h = codex_active.and_then(|a| a.five_hour.as_ref()).map(|w| format!("{:.0}%", w.remaining.round()));
    let agy_group = snapshot.antigravity.groups.first().filter(|_| visible("antigravity"));
    let agy_5h = agy_group.and_then(|g| g.five_hour.as_ref().or(g.weekly.as_ref())).map(|w| format!("{:.0}%", w.remaining.round()));
    let claude_5h = snapshot.claude.five_hour.as_ref().filter(|_| visible("claude")).map(|w| format!("{:.0}%", w.remaining.round()));
    let mut readings = vec!["YouSage".to_owned()];
    if let Some(c) = codex_5h { readings.push(format!("Codex 5h {c}")); }
    if let Some(a) = agy_5h { readings.push(format!("AGY {a}")); }
    if let Some(c) = claude_5h { readings.push(format!("Claude 5h {c}")); }
    let tooltip = format!("{} (Alt+Shift+U)", readings.join(" · "));
    let _ = tray.set_tooltip(Some(&tooltip));
    let low_codex = codex_active.is_some_and(|a| {
        a.error.is_some()
            || a.five_hour.as_ref().is_some_and(|w| w.remaining <= snapshot.settings.usage_preferences.alert_rules.codex.warning_percent)
            || a.weekly.as_ref().is_some_and(|w| w.remaining <= snapshot.settings.usage_preferences.alert_rules.codex.warning_percent)
    });
    let low_agy = visible("antigravity") && (snapshot.antigravity.error.is_some()
        || snapshot.antigravity.groups.iter().any(|g| {
            g.five_hour.as_ref().is_some_and(|w| w.remaining <= snapshot.settings.usage_preferences.alert_rules.antigravity.warning_percent)
                || g.weekly.as_ref().is_some_and(|w| w.remaining <= snapshot.settings.usage_preferences.alert_rules.antigravity.warning_percent)
        }));
    let low_claude = visible("claude") && (snapshot.claude.error.is_some()
        || snapshot.claude.five_hour.as_ref().is_some_and(|w| w.remaining <= snapshot.settings.usage_preferences.alert_rules.claude.warning_percent)
        || snapshot.claude.weekly.as_ref().is_some_and(|w| w.remaining <= snapshot.settings.usage_preferences.alert_rules.claude.warning_percent));
    let _ = tray.set_icon(Some(tray_icon_image(low_codex || low_agy || low_claude)));
}

#[cfg(windows)]
fn spawn_global_hotkey(app: AppHandle) {
    std::thread::spawn(move || unsafe {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{RegisterHotKey, MOD_ALT, MOD_NOREPEAT, MOD_SHIFT};
        use windows_sys::Win32::UI::WindowsAndMessaging::{GetMessageW, MSG, WM_HOTKEY};
        let notch_registered = RegisterHotKey(std::ptr::null_mut(), 1, MOD_ALT | MOD_SHIFT | MOD_NOREPEAT, 0x55) != 0;
        let privacy_registered = RegisterHotKey(std::ptr::null_mut(), 2, MOD_ALT | MOD_SHIFT | MOD_NOREPEAT, 0x50) != 0;
        if !notch_registered && !privacy_registered { return; }
        let mut msg: MSG = std::mem::zeroed();
        while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
            if msg.message == WM_HOTKEY {
                if msg.wParam == 2 {
                    let private = app.state::<AppState>().config.lock().unwrap().privacy_mode;
                    let _ = state::set_privacy_mode(app.clone(), !private);
                    continue;
                }
                let hidden = app.state::<AppState>().config.lock().unwrap().hidden;
                if hidden {
                    show(&app);
                } else if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = app.emit("hotkey-toggle", ());
                }
            }
        }
    });
}

pub fn setup(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show_item = MenuItem::with_id(app, "show", "Show notch (Alt+Shift+U)", true, None::<&str>)?;
    let hide_item = MenuItem::with_id(app, "hide", "Hide notch", true, None::<&str>)?;
    let refresh_item = MenuItem::with_id(app, "refresh", "Refresh usage", true, None::<&str>)?;
    let privacy_item = MenuItem::with_id(app, "privacy", "Toggle privacy mode (Alt+Shift+P)", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit YouSage", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &hide_item, &refresh_item, &privacy_item, &quit_item])?;
    let mut tray = TrayIconBuilder::with_id("yousage").tooltip("YouSage · Codex & Antigravity usage (Alt+Shift+U)").menu(&menu).show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if matches!(event, TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. }) { show(tray.app_handle()); }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show(app), "hide" => hide_notch(app.clone()),
            "refresh" => { tauri::async_runtime::spawn(state::refresh_all(app.clone())); },
            "privacy" => {
                let private = app.state::<AppState>().config.lock().unwrap().privacy_mode;
                let _ = state::set_privacy_mode(app.clone(), !private);
            },
            "quit" => { let _ = app.state::<AppState>().persist(); app.exit(0); }, _ => {}
        });
    tray = tray.icon(tray_icon_image(false));
    tray.build(app)?;
    #[cfg(windows)]
    spawn_global_hotkey(app.clone());
    let _ = set_expanded(app.clone(), false, COMPACT);
    let state = app.state::<AppState>();
    if !state.config.lock().unwrap().hidden {
        if let Some(window) = app.get_webview_window("main") { window.show()?; }
    }
    if !cfg!(debug_assertions) {
        let enabled = state.config.lock().unwrap().start_with_windows;
        let result = if enabled { app.autolaunch().enable() } else { app.autolaunch().disable() };
        if result.is_err() { state.snapshot.lock().unwrap().settings.start_with_windows = app.autolaunch().is_enabled().unwrap_or(false); }
    }
    Ok(())
}

pub fn on_window_event(window: &tauri::Window, event: &WindowEvent) {
    let app = window.app_handle();
    let state = app.state::<AppState>();
    match event {
        WindowEvent::CloseRequested { api, .. } => { api.prevent_close(); hide_notch(app.clone()); }
        WindowEvent::Focused(true) => { let _ = app.emit("notch-focused", ()); }
        WindowEvent::Focused(false) if !state.resizing.load(Ordering::SeqCst) && !state.window.lock().unwrap().dragging => { let _ = app.emit("collapse-requested", ()); }
        WindowEvent::Moved(position) if !state.resizing.load(Ordering::SeqCst) => {
            let placement = state.window.lock().unwrap();
            let height = window.outer_size().map(|s| s.height as i32).unwrap_or(80);
            let compact = window.scale_factor().map(|s| (COMPACT * s).round() as i32).unwrap_or(80);
            state.config.lock().unwrap().anchor = Some(Point { x: position.x, y: position.y + if placement.expanded && placement.upward { height - compact } else { 0 } });
        }
        _ => {}
    }
}
