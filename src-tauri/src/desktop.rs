use crate::{model::{place_panel, Point, WorkArea}, state::{self, AppState}};
use serde::Serialize;
use std::sync::atomic::Ordering;
use tauri::{menu::{Menu, MenuItem}, tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent}, AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WindowEvent};
use tauri_plugin_autostart::ManagerExt;

const WIDTH: f64 = 344.0;
const COMPACT: f64 = 80.0;

#[derive(Default)]
pub struct WindowState { pub expanded: bool, pub upward: bool }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Layout { pub upward: bool, pub height: f64 }

#[tauri::command]
pub fn set_expanded(app: AppHandle, expanded: bool, height: f64) -> Result<Layout, String> {
    let state = app.state::<AppState>();
    let window = app.get_webview_window("main").ok_or("The notch window is unavailable.")?;
    let saved_anchor = state.config.lock().unwrap().anchor;
    let saved_monitor = saved_anchor.and_then(|point| window.available_monitors().ok()?.into_iter().find(|monitor| {
        let area = monitor.work_area();
        point.x >= area.position.x && point.y >= area.position.y && point.x < area.position.x + area.size.width as i32 && point.y < area.position.y + area.size.height as i32
    }));
    let monitor = saved_monitor.or_else(|| window.current_monitor().ok().flatten()).or_else(|| window.primary_monitor().ok().flatten()).ok_or("Could not find a display.")?;
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let work = WorkArea { x: area.position.x, y: area.position.y, width: area.size.width as i32, height: area.size.height as i32 };
    let anchor = saved_anchor.unwrap_or(Point { x: work.x + work.width - (WIDTH * scale) as i32 - 20, y: work.y + 20 });
    let desired = if expanded && height.is_finite() { height.clamp(COMPACT, 700.0) } else { COMPACT };
    let placement = place_panel(anchor, work, (WIDTH * scale).round() as i32, (COMPACT * scale).round() as i32, (desired * scale).round() as i32);
    state.resizing.store(true, Ordering::SeqCst);
    let generation = state.resize_generation.fetch_add(1, Ordering::SeqCst) + 1;
    {
        let mut placement_state = state.window.lock().unwrap();
        placement_state.expanded = expanded;
        placement_state.upward = placement.upward;
    }
    let result = window.set_size(LogicalSize::new(WIDTH, placement.height as f64 / scale))
        .and_then(|_| window.set_position(PhysicalPosition::new(placement.x, placement.y)));
    let reset_app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(220)).await;
        let state = reset_app.state::<AppState>();
        if state.resize_generation.load(Ordering::SeqCst) == generation { state.resizing.store(false, Ordering::SeqCst); }
    });
    result.map_err(|_| "Could not resize the notch.")?;
    Ok(Layout { upward: placement.upward, height: placement.height as f64 / scale })
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

pub fn setup(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show_item = MenuItem::with_id(app, "show", "Show notch", true, None::<&str>)?;
    let hide_item = MenuItem::with_id(app, "hide", "Hide notch", true, None::<&str>)?;
    let refresh_item = MenuItem::with_id(app, "refresh", "Refresh usage", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit YouSage", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &hide_item, &refresh_item, &quit_item])?;
    let mut tray = TrayIconBuilder::with_id("yousage").tooltip("YouSage · Codex & Antigravity usage").menu(&menu).show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if matches!(event, TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. }) { show(tray.app_handle()); }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show(app), "hide" => hide_notch(app.clone()),
            "refresh" => { tauri::async_runtime::spawn(state::refresh_all(app.clone())); },
            "quit" => { let _ = app.state::<AppState>().persist(); app.exit(0); }, _ => {}
        });
    if let Some(icon) = app.default_window_icon() { tray = tray.icon(icon.clone()); }
    tray.build(app)?;
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
        WindowEvent::Focused(false) if !state.resizing.load(Ordering::SeqCst) => { let _ = app.emit("collapse-requested", ()); }
        WindowEvent::Moved(position) if !state.resizing.load(Ordering::SeqCst) => {
            let placement = state.window.lock().unwrap();
            let height = window.outer_size().map(|s| s.height as i32).unwrap_or(80);
            let compact = window.scale_factor().map(|s| (COMPACT * s).round() as i32).unwrap_or(80);
            state.config.lock().unwrap().anchor = Some(Point { x: position.x, y: position.y + if placement.expanded && placement.upward { height - compact } else { 0 } });
        }
        _ => {}
    }
}
