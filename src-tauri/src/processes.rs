use serde::Deserialize;
use std::{collections::{HashMap, HashSet}, path::{Path, PathBuf}, process::Stdio};
use tokio::{process::Command, time::{timeout, Duration}};

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Process {
    process_id: u32,
    parent_process_id: u32,
    executable_path: Option<PathBuf>,
    command_line: Option<String>,
    name: String,
}

pub struct Desktop { pid: u32, executable: PathBuf }
pub struct Runtime { pub desktop: Vec<Desktop>, pub cli_running: bool }

fn is_desktop(path: &Path) -> bool {
    path.parent().is_some_and(|folder| folder.join("resources/app.asar").is_file())
}

#[cfg(windows)]
fn arguments(line: &str) -> Vec<String> {
    use windows_sys::Win32::{Foundation::LocalFree, UI::Shell::CommandLineToArgvW};
    let line: Vec<u16> = line.encode_utf16().chain(Some(0)).collect();
    let mut count = 0;
    let argv = unsafe { CommandLineToArgvW(line.as_ptr(), &mut count) };
    if argv.is_null() { return vec![] }
    let mut result = Vec::new();
    for index in 0..count as usize {
        let word = unsafe { *argv.add(index) };
        let mut len = 0; while unsafe { *word.add(len) } != 0 { len += 1; }
        result.push(String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(word, len) }));
    }
    unsafe { LocalFree(argv.cast()) };
    result
}

#[cfg(not(windows))]
fn arguments(line: &str) -> Vec<String> { line.split_whitespace().map(str::to_owned).collect() }

fn is_engine(line: &str) -> bool {
    let mut words = arguments(line).into_iter().skip(1);
    while let Some(word) = words.next() {
        if matches!(word.as_str(), "-c" | "--config" | "--enable" | "--disable" | "--remote" | "--remote-auth-token-env" | "-C" | "--cd" | "-m" | "--model" | "-p" | "--profile" | "-s" | "--sandbox" | "-a" | "--ask-for-approval" | "--add-dir" | "--local-provider" | "-i" | "--image") { if words.next().is_none() { return false } continue }
        if word.starts_with('-') { continue }
        return matches!(word.as_str(), "app-server" | "exec-server")
    }
    false
}

fn classify(processes: &[Process], own_pid: u32, desktop_paths: &HashSet<PathBuf>) -> Runtime {
    let desktop_ids: HashSet<u32> = processes.iter().filter(|p| p.executable_path.as_ref().is_some_and(|path| desktop_paths.contains(path))).map(|p| p.process_id).collect();
    let parents: HashMap<u32, u32> = processes.iter().map(|p| (p.process_id, p.parent_process_id)).collect();
    let belongs_to_app = |mut pid| {
        for _ in 0..32 {
            if pid == own_pid || desktop_ids.contains(&pid) { return true }
            let Some(parent) = parents.get(&pid) else { return false };
            if *parent == pid { return false }
            pid = *parent;
        }
        false
    };
    let desktop = processes.iter().filter(|p| desktop_ids.contains(&p.process_id) && !desktop_ids.contains(&p.parent_process_id))
        .filter_map(|p| p.executable_path.clone().map(|executable| Desktop { pid: p.process_id, executable })).collect();
    let cli_running = processes.iter().any(|p| {
        if !p.name.eq_ignore_ascii_case("codex.exe") || desktop_ids.contains(&p.process_id) { return false }
        let server = p.command_line.as_deref().is_some_and(is_engine);
        // Interactive CLI sessions are blocked even if opened in an app terminal.
        !(server && belongs_to_app(p.parent_process_id))
    });
    Runtime { desktop, cli_running }
}

pub fn command(executable: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut command = Command::new(executable);
    command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    command
}

pub async fn inspect() -> Result<Runtime, String> {
    // Built-in Windows process metadata, queried only when a switch is requested.
    // Command lines are used for classification and never sent to the interface.
    let script = "[Console]::OutputEncoding = [Text.UTF8Encoding]::new(); $ErrorActionPreference='Stop'; ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process -Filter \"Name='ChatGPT.exe' OR Name='Codex.exe' OR Name='yousage.exe'\" | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine,Name)";
    let output = timeout(Duration::from_secs(15), command("powershell.exe").args(["-NoProfile", "-NonInteractive", "-Command", script]).output()).await
        .map_err(|_| "Windows took too long to check running Codex sessions.")?.map_err(|_| "Could not inspect running Codex sessions.")?;
    if !output.status.success() { return Err("Windows could not check running Codex sessions. Close Codex and retry.".into()) }
    let processes: Vec<Process> = serde_json::from_slice(&output.stdout).map_err(|_| "Windows returned unreadable process information.")?;
    let paths = processes.iter().filter_map(|p| p.executable_path.clone()).filter(|p| is_desktop(p)).collect();
    Ok(classify(&processes, std::process::id(), &paths))
}

impl Runtime {
    pub async fn close_desktop(&self) -> Result<(), String> {
        for desktop in &self.desktop {
            let output = timeout(Duration::from_secs(15), command("taskkill.exe").args(["/PID", &desktop.pid.to_string(), "/T", "/F"]).output()).await
                .map_err(|_| "Codex took too long to close. Close it yourself, then retry the switch.")?.map_err(|_| "Could not close Codex. Close it yourself, then retry the switch.")?;
            if !output.status.success() && !inspect().await?.desktop.is_empty() { return Err("Codex could not be closed. Close it yourself, then retry the switch.".into()) }
        }
        for _ in 0..8 {
            let state = inspect().await?;
            if state.desktop.is_empty() && !state.cli_running { return Ok(()) }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        Err("A Codex process is still running. Close Codex terminal sessions and retry.".into())
    }

    pub fn reopen_desktop(&self) -> Result<(), String> {
        let mut paths = HashSet::new();
        for desktop in &self.desktop {
            if paths.insert(&desktop.executable) {
                // This is the interactive app the user explicitly chose to reopen.
                let mut command = if let Some(target) = store_app_target(&desktop.executable) {
                    let mut command = std::process::Command::new("explorer.exe"); command.arg(target); command
                } else { std::process::Command::new(&desktop.executable) };
                command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
                #[cfg(windows)]
                { use std::os::windows::process::CommandExt; command.creation_flags(0x00000208); }
                command.spawn().map_err(|_| "The account was switched, but Codex could not reopen. Open it from your usual shortcut.")?;
            }
        }
        Ok(())
    }
}

fn store_app_target(executable: &Path) -> Option<String> {
    let package = executable.parent()?.parent()?;
    if !package.parent()?.file_name()?.to_string_lossy().eq_ignore_ascii_case("WindowsApps") { return None }
    let package_name = package.file_name()?.to_str()?;
    let parts: Vec<_> = package_name.split('_').collect();
    if parts.len() < 5 || !parts[0].eq_ignore_ascii_case("OpenAI.Codex") { return None }
    Some(format!("shell:AppsFolder\\{}_{}!App", parts[0], parts.last()?))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn process(pid: u32, parent: u32, name: &str, args: &str) -> Process { Process { process_id: pid, parent_process_id: parent, name: name.into(), executable_path: Some(PathBuf::from(name)), command_line: Some(args.into()) } }

    #[test]
    fn only_owned_engine_processes_are_safe_to_restart() {
        let desktop_paths = HashSet::from([PathBuf::from("ChatGPT.exe")]);
        let mut processes = vec![process(1, 0, "ChatGPT.exe", "ChatGPT"), process(2, 1, "ChatGPT.exe", "renderer"), process(3, 2, "codex.exe", "codex app-server"), process(4, 50, "codex.exe", "codex app-server"), process(7, 2, "codex.exe", "codex -c 'key=value' exec-server")];
        let runtime = classify(&processes, 50, &desktop_paths);
        assert_eq!(runtime.desktop.len(), 1); assert!(!runtime.cli_running);
        processes.push(process(5, 2, "codex.exe", "codex resume"));
        assert!(classify(&processes, 50, &desktop_paths).cli_running);
        processes.pop(); processes.push(process(6, 99, "codex.exe", "codex app-server"));
        assert!(classify(&processes, 50, &desktop_paths).cli_running);
    }

    #[test]
    fn prompt_arguments_cannot_disguise_terminal_work_as_an_engine() {
        assert!(!is_engine("codex exec app-server"));
        assert!(!is_engine("codex -c key=app-server resume"));
        assert!(is_engine("codex -c key=value exec-server --listen stdio://"));
        assert!(is_engine("codex app-server --listen stdio://"));
    }
}
