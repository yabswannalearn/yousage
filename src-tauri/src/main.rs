#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod desktop;
mod model;
mod rpc;
mod state;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| desktop::show(app)))
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            state::get_snapshot, state::refresh_usage, state::connect_account, state::cancel_sign_in, state::dismiss_login_error,
            state::disconnect_account, state::rename_account, state::update_settings,
            desktop::set_expanded, desktop::hide_notch,
        ])
        .setup(|app| {
            let state = state::AppState::load(app.handle())?;
            app.manage(state);
            desktop::setup(app.handle())?;
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
