#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod desktop;
mod auth;
mod processes;
mod switching;
mod model;
mod rpc;
mod state;
mod claude;
mod usage;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| desktop::show(app)))
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            state::get_snapshot, state::refresh_usage, state::dismiss_alert, state::test_notification,
            state::save_antigravity_account, state::switch_antigravity_account, state::rename_antigravity_account, state::disconnect_antigravity_account,
            state::check_for_updates, state::open_release_url,
            state::connect_account, state::cancel_sign_in, state::dismiss_login_error,
            state::disconnect_account, state::rename_account, state::update_settings, state::update_usage_preferences,
            desktop::set_expanded, desktop::hide_notch, desktop::start_notch_drag,
            switching::prepare_switch, switching::prepare_antigravity_switch, switching::switch_account,
        ])
        .setup(|app| {
            let state = state::AppState::load(app.handle())?;
            app.manage(state);
            desktop::setup(app.handle())?;
            state::check_for_updates(app.handle().clone());
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    state::refresh_all(handle.clone()).await;
                    let seconds = handle.state::<state::AppState>().config.lock().unwrap().refresh_seconds;
                    tokio::time::sleep(std::time::Duration::from_secs(seconds)).await;
                }
            });
            Ok(())
        })
        .on_window_event(desktop::on_window_event)
        .run(tauri::generate_context!())
        .expect("YouSage could not start");
}
