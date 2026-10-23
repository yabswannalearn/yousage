//! Native delivery stays synchronous through Windows' Show call. The Tauri
//! notification plugin schedules that call and discards its errors on Windows.
use serde::Serialize;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager};

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Availability { Available, DisabledForApp, DisabledForUser, DisabledByPolicy, Unavailable }

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationStatus {
    pub availability: Availability,
    pub message: String,
    pub last_attempt_at: Option<i64>,
    pub last_error: Option<String>,
}

#[derive(Default)]
struct Diagnostics { last_attempt_at: Option<i64>, last_error: Option<String>, initialization_error: Option<String>, attempt: u64 }

fn diagnostics() -> &'static Mutex<Diagnostics> {
    static STATE: OnceLock<Mutex<Diagnostics>> = OnceLock::new();
    STATE.get_or_init(Mutex::default)
}

fn delivery_gate() -> &'static Mutex<()> {
    static GATE: Mutex<()> = Mutex::new(());
    &GATE
}

pub fn initialize(app: &AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    let result = native::register(app);
    #[cfg(not(windows))]
    let result = { let _ = app; Ok(()) };
    diagnostics().lock().unwrap().initialization_error = result.as_ref().err().cloned();
    result
}

#[tauri::command]
pub fn get_notification_status(app: AppHandle) -> NotificationStatus { status(&app) }

pub fn clear_notification_history(app: &AppHandle) -> Result<(), String> {
    let _delivery = delivery_gate().lock().unwrap();
    #[cfg(windows)]
    let result = native::clear(app);
    #[cfg(not(windows))]
    let result = { let _ = app; Ok(()) };
    if let Err(error) = &result { diagnostics().lock().unwrap().last_error = Some(error.clone()); }
    result
}

/// Read privacy inside the same gate used when clearing previous notifications.
/// A refresh already in flight cannot submit an old, named toast after that clear.
pub fn send_alert(app: &AppHandle, alert: &crate::model::Alert) -> Result<NotificationStatus, String> {
    let _delivery = delivery_gate().lock().unwrap();
    let private = app.state::<crate::state::AppState>().config.lock().unwrap().privacy_mode;
    let (title, body) = alert_content(alert, private);
    send(app, &title, &body)
}

fn status(app: &AppHandle) -> NotificationStatus {
    #[cfg(windows)]
    let (availability, message) = native::setting(app).unwrap_or_else(|error| (Availability::Unavailable, error));
    #[cfg(not(windows))]
    let (availability, message) = { let _ = app; (Availability::Unavailable, "Native Windows notifications are unavailable on this platform.".into()) };
    let state = diagnostics().lock().unwrap();
    let (availability, message) = if let Some(error) = &state.initialization_error {
        (Availability::Unavailable, error.clone())
    } else { (availability, message) };
    NotificationStatus { availability, message, last_attempt_at: state.last_attempt_at, last_error: state.last_error.clone() }
}

pub fn send(app: &AppHandle, title: &str, body: &str) -> Result<NotificationStatus, String> {
    let attempt = {
        let mut state = diagnostics().lock().unwrap();
        state.last_attempt_at = Some(crate::state::now());
        state.last_error = None;
        state.attempt += 1;
        state.attempt
    };
    let before = status(app);
    if before.availability != Availability::Available {
        record_failure(attempt, before.message.clone());
        return Err(before.message);
    }
    #[cfg(windows)]
    let result = native::show(app, title, body, attempt);
    #[cfg(not(windows))]
    let result = { let _ = (title, body); Err("Native Windows notifications are unavailable on this platform.".into()) };
    if let Err(error) = result { record_failure(attempt, error.clone()); return Err(error); }
    let result = status(app);
    if let Some(error) = &result.last_error { return Err(error.clone()); }
    Ok(result)
}

fn record_failure(attempt: u64, error: String) {
    let mut state = diagnostics().lock().unwrap();
    if state.attempt == attempt { state.last_error = Some(error); }
}

/// Account labels, emails, and provider error strings never enter a private toast.
pub fn alert_content(alert: &crate::model::Alert, privacy_mode: bool) -> (String, String) {
    if !privacy_mode { return (alert.title.clone(), alert.message.clone()); }
    let provider = if alert.id.starts_with("agy:") { "Antigravity" } else if alert.id.starts_with("claude:") { "Claude" } else { "Codex" };
    let action = if alert.kind == "reset" { "allowance refilled" } else { "allowance running low" };
    (format!("{provider} {action}"), "Open YouSage to review remaining allowance and reset times.".into())
}

#[cfg(windows)]
mod native {
    use super::{Availability, record_failure};
    use std::{path::{Path, PathBuf}, sync::{Mutex, OnceLock}};
    use tauri::AppHandle;
    use windows::{
        core::{HSTRING, Interface, PCWSTR, IInspectable},
        Data::Xml::Dom::XmlDocument,
        Foundation::TypedEventHandler,
        UI::Notifications::{NotificationSetting, ToastFailedEventArgs, ToastNotification, ToastNotificationManager},
        Win32::{Storage::EnhancedStorage::PKEY_AppUserModel_ID, System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, StructuredStorage::PROPVARIANT}, UI::Shell::{IShellLinkW, PropertiesSystem::IPropertyStore, SetCurrentProcessExplicitAppUserModelID, ShellLink, SHQueryUserNotificationState, QUNS_ACCEPTS_NOTIFICATIONS}},
    };

    struct Apartment(bool);
    impl Apartment {
        fn new() -> Self { Self(unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok() }) }
    }
    impl Drop for Apartment { fn drop(&mut self) { if self.0 { unsafe { CoUninitialize(); } } } }

    fn identity(app: &AppHandle) -> String {
        if cfg!(debug_assertions) { format!("{}.dev", app.config().identifier) } else { app.config().identifier.clone() }
    }

    fn wide(value: &std::ffi::OsStr) -> Vec<u16> {
        use std::os::windows::ffi::OsStrExt;
        value.encode_wide().chain(Some(0)).collect()
    }

    pub(super) fn register(app: &AppHandle) -> Result<(), String> {
        let executable = std::env::current_exe().map_err(|_| "Could not find YouSage's executable for notification registration.".to_string())?;
        let name = if cfg!(debug_assertions) { "YouSage Dev" } else { "YouSage" };
        let programs = std::env::var_os("APPDATA").map(PathBuf::from).ok_or("Windows did not provide a Start Menu folder for notifications.")?
            .join("Microsoft/Windows/Start Menu/Programs");
        std::fs::create_dir_all(&programs).map_err(|_| "Could not prepare YouSage's Start Menu notification shortcut.".to_string())?;
        register_shortcut(&programs.join(format!("{name}.lnk")), &executable, &identity(app))
            .map_err(|error| format!("Could not register YouSage with Windows notifications ({error})."))
    }

    fn register_shortcut(shortcut: &Path, executable: &Path, app_id: &str) -> windows::core::Result<()> {
        register_identity(app_id, executable)?;
        let _apartment = Apartment::new();
        let target = wide(executable.as_os_str());
        let shortcut_path = wide(shortcut.as_os_str());
        let app_id_wide = HSTRING::from(app_id);
        unsafe {
            SetCurrentProcessExplicitAppUserModelID(&app_id_wide)?;
            let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
            let file: IPersistFile = link.cast()?;
            // Preserve a valid installer-created shortcut, including its target.
            if shortcut.is_file() && file.Load(PCWSTR(shortcut_path.as_ptr()), windows::Win32::System::Com::STGM_READ).is_ok() {
                let properties: IPropertyStore = link.cast()?;
                if properties.GetValue(&PKEY_AppUserModel_ID).ok().is_some_and(|value| value.to_string() == app_id) { return Ok(()); }
            }
            link.SetPath(PCWSTR(target.as_ptr()))?;
            link.SetArguments(windows::core::w!(""))?;
            link.SetDescription(windows::core::w!("YouSage usage companion"))?;
            link.SetIconLocation(PCWSTR(target.as_ptr()), 0)?;
            if let Some(parent) = executable.parent() { let parent = wide(parent.as_os_str()); link.SetWorkingDirectory(PCWSTR(parent.as_ptr()))?; }
            let properties: IPropertyStore = link.cast()?;
            properties.SetValue(&PKEY_AppUserModel_ID, &PROPVARIANT::from(app_id))?;
            properties.Commit()?;
            file.Save(PCWSTR(shortcut_path.as_ptr()), true)?;
        }
        Ok(())
    }

    fn register_identity(app_id: &str, executable: &Path) -> windows::core::Result<()> {
        use windows_sys::Win32::System::Registry::*;
        let path = wide(std::ffi::OsStr::new(&format!("Software\\Classes\\AppUserModelId\\{app_id}")));
        let mut key = std::ptr::null_mut();
        let result = unsafe { RegCreateKeyExW(HKEY_CURRENT_USER, path.as_ptr(), 0, std::ptr::null(), 0, KEY_SET_VALUE, std::ptr::null(), &mut key, std::ptr::null_mut()) };
        if result != 0 { return Err(windows::core::Error::from_hresult(windows::core::HRESULT::from_win32(result))); }
        let write = |name: &str, value: &std::ffi::OsStr| {
            let name = wide(std::ffi::OsStr::new(name));
            let value = wide(value);
            unsafe { RegSetValueExW(key, name.as_ptr(), 0, REG_SZ, value.as_ptr().cast(), (value.len() * 2) as u32) }
        };
        let display = write("DisplayName", std::ffi::OsStr::new("YouSage"));
        let icon = write("IconUri", executable.as_os_str());
        unsafe { RegCloseKey(key); }
        let result = if display != 0 { display } else { icon };
        if result != 0 { return Err(windows::core::Error::from_hresult(windows::core::HRESULT::from_win32(result))); }
        Ok(())
    }

    fn availability(value: NotificationSetting) -> (Availability, &'static str) {
        match value {
            NotificationSetting::Enabled => (Availability::Available, "Windows accepts YouSage notifications. Do not disturb and banner settings can still send them quietly to Notification Center."),
            NotificationSetting::DisabledForApplication => (Availability::DisabledForApp, "Windows has disabled YouSage notifications. Enable YouSage under Windows Settings → System → Notifications."),
            NotificationSetting::DisabledForUser => (Availability::DisabledForUser, "Windows notifications are disabled for this user. Check Windows Settings → System → Notifications."),
            NotificationSetting::DisabledByGroupPolicy => (Availability::DisabledByPolicy, "Windows notification delivery is disabled by your organization's policy."),
            _ => (Availability::Unavailable, "Windows notifications are unavailable on this computer."),
        }
    }

    pub(super) fn setting(app: &AppHandle) -> Result<(Availability, String), String> {
        let notifier = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(identity(app)))
            .map_err(|error| format!("Windows notification service is unavailable ({error})."))?;
        // Windows may not have a notification-database row until the first Show.
        // Allow that first request; its real delivery errors are still returned.
        let setting = match notifier.Setting() {
            Ok(setting) => setting,
            Err(error) if error.code().0 as u32 == 0x80070490 => return Ok((Availability::Available, "YouSage is registered. Send a test to initialize Windows notification delivery; banner settings remain controlled by Windows.".into())),
            Err(error) => return Err(format!("Could not read Windows notification settings ({error}).")),
        };
        let (availability, message) = availability(setting);
        let suppressed = availability == Availability::Available && unsafe { SHQueryUserNotificationState().is_ok_and(|state| state != QUNS_ACCEPTS_NOTIFICATIONS) };
        Ok((availability, if suppressed { "Windows currently limits interruptions (for example, a full-screen or presentation session). Check Notification Center for accepted alerts.".into() } else { message.into() }))
    }

    pub(super) fn clear(app: &AppHandle) -> Result<(), String> {
        ToastNotificationManager::History().and_then(|history| history.ClearWithId(&HSTRING::from(identity(app))))
            .map_err(|error| format!("Could not clear earlier YouSage notifications from Notification Center ({error})."))
    }

    pub(super) fn show(app: &AppHandle, title: &str, body: &str, attempt: u64) -> Result<(), String> {
        show_with_id(&identity(app), title, body, attempt, Some(app.clone())).map_err(|error| format!("Windows rejected the notification ({error})."))
    }

    fn show_with_id(app_id: &str, title: &str, body: &str, attempt: u64, app: Option<AppHandle>) -> windows::core::Result<()> {
        let xml = XmlDocument::new()?;
        // SetInnerText escapes user-provided names, rather than interpolating XML.
        xml.LoadXml(windows::core::h!("<toast><visual><binding template=\"ToastGeneric\"><text/><text/></binding></visual></toast>"))?;
        let texts = xml.GetElementsByTagName(windows::core::h!("text"))?;
        texts.Item(0)?.SetInnerText(&HSTRING::from(title))?;
        texts.Item(1)?.SetInnerText(&HSTRING::from(body))?;
        let toast = ToastNotification::CreateToastNotification(&xml)?;
        toast.SetGroup(windows::core::h!("yousage"))?;
        toast.SetTag(&HSTRING::from(format!("alert-{attempt}")))?;
        toast.Failed(&TypedEventHandler::<ToastNotification, ToastFailedEventArgs>::new(move |_, args| {
            let code = args.as_ref().and_then(|args| args.ErrorCode().ok());
            record_failure(attempt, format!("Windows could not deliver the notification ({}).", code.map(|code| format!("0x{:08X}", code.0 as u32)).unwrap_or_else(|| "unknown error".into())));
            Ok(())
        }))?;
        if let Some(app) = app {
            toast.Activated(&TypedEventHandler::<ToastNotification, IInspectable>::new(move |_, _| {
                crate::desktop::show(&app);
                Ok(())
            }))?;
        }
        let notifier = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(app_id))?;
        // Return the real API error; do not put Show on a fire-and-forget task.
        notifier.Show(&toast)?;
        // Keep event handlers alive for asynchronous Windows delivery failures.
        static ACTIVE: OnceLock<Mutex<Vec<ToastNotification>>> = OnceLock::new();
        let mut active = ACTIVE.get_or_init(Mutex::default).lock().unwrap();
        active.push(toast);
        if active.len() > 32 { active.remove(0); }
        Ok(())
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        struct DiagnosticCleanup { shortcut: PathBuf, app_id: String }
        impl Drop for DiagnosticCleanup {
            fn drop(&mut self) {
                let _ = ToastNotificationManager::History().and_then(|history| history.ClearWithId(&HSTRING::from(&self.app_id)));
                let _ = std::fs::remove_file(&self.shortcut);
                let key = wide(std::ffi::OsStr::new(&format!("Software\\Classes\\AppUserModelId\\{}", self.app_id)));
                unsafe { windows_sys::Win32::System::Registry::RegDeleteTreeW(windows_sys::Win32::System::Registry::HKEY_CURRENT_USER, key.as_ptr()); }
            }
        }
        #[test]
        fn distinguishes_windows_notification_settings() {
            assert_eq!(availability(NotificationSetting::DisabledForApplication).0, Availability::DisabledForApp);
            assert_eq!(availability(NotificationSetting::DisabledForUser).0, Availability::DisabledForUser);
            assert_eq!(availability(NotificationSetting::DisabledByGroupPolicy).0, Availability::DisabledByPolicy);
        }

        /// Explicit opt-in: creates an isolated shortcut and sends a real native toast.
        #[test]
        #[ignore = "requires an interactive Windows desktop and sends one native diagnostic toast"]
        fn portable_registration_and_native_delivery() {
            let app_id = format!("com.yousage.desktop.test.{}", std::process::id());
            let name = format!("YouSage Notification Test {}.lnk", std::process::id());
            let shortcut = PathBuf::from(std::env::var_os("APPDATA").unwrap()).join("Microsoft/Windows/Start Menu/Programs").join(name);
            let _cleanup = DiagnosticCleanup { shortcut: shortcut.clone(), app_id: app_id.clone() };
            let executable = std::env::current_exe().unwrap();
            register_shortcut(&shortcut, &executable, &app_id).unwrap();
            let _apartment = Apartment::new();
            unsafe {
                let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).unwrap();
                let file: IPersistFile = link.cast().unwrap();
                let path = wide(shortcut.as_os_str());
                file.Load(PCWSTR(path.as_ptr()), windows::Win32::System::Com::STGM_READ).unwrap();
                let properties: IPropertyStore = link.cast().unwrap();
                assert_eq!(properties.GetValue(&PKEY_AppUserModel_ID).unwrap().to_string(), app_id);
            }
            let notifier = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(&app_id)).unwrap();
            show_with_id(&app_id, "YouSage notification diagnostic", "Native delivery test. You can dismiss this notification.", 424242, None).unwrap();
            let history = ToastNotificationManager::History().unwrap();
            let mut found = false;
            for _ in 0..20 {
                found = history.GetHistoryWithId(&HSTRING::from(&app_id)).unwrap().into_iter().any(|toast| toast.Tag().is_ok_and(|tag| tag == "alert-424242"));
                if found { break; }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            assert!(found, "Windows accepted Show but did not retain the tagged toast in Notification Center; this does not verify a banner was visible");
            assert_eq!(notifier.Setting().unwrap(), NotificationSetting::Enabled);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn privacy_toasts_never_contain_account_names_or_emails() {
        let alert = crate::model::Alert { id: "codex:alice@example.com:weekly:low".into(), title: "Alice Work".into(), message: "alice@example.com is running low".into(), kind: "low".into() };
        let (title, body) = alert_content(&alert, true);
        assert_eq!(title, "Codex allowance running low");
        assert!(!body.contains("alice") && !body.contains("Work") && !title.contains('@'));
        assert_eq!(alert_content(&alert, false), (alert.title, alert.message));
    }
}
