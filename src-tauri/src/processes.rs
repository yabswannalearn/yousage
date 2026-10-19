use serde::Deserialize;
use std::{collections::{HashMap, HashSet}, path::{Path, PathBuf}, process::Stdio};
use tokio::{process::Command, time::{timeout, Duration}};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Process {
    process_id: u32,
    parent_process_id: u32,
    executable_path: Option<PathBuf>,
    command_line: Option<String>,
    name: String,
    #[serde(default)]
    started: Option<String>,
}

pub struct Desktop { executable: PathBuf }
#[derive(Clone, Copy)]
pub enum Provider { Codex, Antigravity }
pub struct Runtime {
    pub desktop: Vec<Desktop>,
    pub cli_running: bool,
    targets: Vec<Process>,
    provider: Provider,
    contains_own_ancestor: bool,
}

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

fn classify(processes: &[Process], own_pid: u32, desktop_paths: &HashSet<PathBuf>, provider: Provider) -> Runtime {
    let desktop_ids: HashSet<u32> = processes.iter().filter(|p| p.executable_path.as_ref().is_some_and(|path| desktop_paths.contains(path)) || match provider {
        Provider::Codex => p.name.eq_ignore_ascii_case("ChatGPT.exe"),
        Provider::Antigravity => p.name.eq_ignore_ascii_case("Antigravity.exe"),
    }).map(|p| p.process_id).collect();
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
    let desktop: Vec<_> = processes.iter().filter(|p| desktop_ids.contains(&p.process_id) && !desktop_ids.contains(&p.parent_process_id))
        .filter_map(|p| p.executable_path.clone().map(|executable| Desktop { executable })).collect();
    let by_id: HashMap<_, _> = processes.iter().map(|p| (p.process_id, p)).collect();
    let mut protected = HashSet::from([own_pid]);
    let mut ancestor = own_pid;
    for _ in 0..64 {
        let Some(parent) = parents.get(&ancestor) else { break };
        if !protected.insert(*parent) { break }
        ancestor = *parent;
    }
    let owned = |mut pid| {
        for _ in 0..64 {
            if pid == own_pid { return true }
            let Some(parent) = parents.get(&pid) else { break };
            if *parent == pid { break }
            pid = *parent;
        }
        false
    };
    let is_cli = |p: &&Process| match provider {
        Provider::Codex => p.name.eq_ignore_ascii_case("codex.exe") && !desktop_ids.contains(&p.process_id),
        Provider::Antigravity => p.name.eq_ignore_ascii_case("agy.exe"),
    };
    let cli_running = processes.iter().any(|p| {
        if !is_cli(&p) || owned(p.process_id) { return false }
        let server = p.command_line.as_deref().is_some_and(is_engine);
        // Interactive sessions count even when opened in an app terminal.
        !(server && belongs_to_app(p.parent_process_id))
    });
    let mut targets: HashMap<u32, Process> = HashMap::new();
    for process in processes.iter().filter(|p| desktop_ids.contains(&p.process_id) || is_cli(p)) {
        if owned(process.process_id) { continue }
        let mut root = process;
        let mut parent = process.parent_process_id;
        for _ in 0..64 {
            let Some(candidate) = by_id.get(&parent) else { break };
            if candidate.process_id == candidate.parent_process_id { break }
            if desktop_ids.contains(&candidate.process_id) {
                root = candidate;
            } else if is_shell(&candidate.name) && !protected.contains(&candidate.process_id) {
                root = candidate;
            } else if is_cli_shim(candidate, provider) && !protected.contains(&candidate.process_id) {
                root = candidate;
            } else {
                break;
            }
            parent = candidate.parent_process_id;
        }
        targets.insert(root.process_id, root.clone());
    }
    // A desktop tree can already contain another selected session/shell.
    let ids: HashSet<_> = targets.keys().copied().collect();
    targets.retain(|pid, _| {
        let mut current = *pid;
        for _ in 0..64 {
            let Some(parent) = parents.get(&current) else { break };
            if *parent == current { break }
            if ids.contains(parent) { return false }
            current = *parent;
        }
        true
    });
    let contains_own_ancestor = targets.keys().any(|pid| protected.contains(pid));
    Runtime { desktop, cli_running, targets: targets.into_values().collect(), provider, contains_own_ancestor }
}

fn is_shell(name: &str) -> bool {
    matches!(name.to_ascii_lowercase().as_str(), "cmd.exe" | "powershell.exe" | "pwsh.exe" | "bash.exe" | "wsl.exe")
}

fn is_cli_shim(process: &Process, provider: Provider) -> bool {
    if !process.name.eq_ignore_ascii_case("node.exe") { return false }
    matches!(provider, Provider::Codex) && process.command_line.as_deref().is_some_and(|line| {
        arguments(line).iter().skip(1).any(|arg| {
            let path = arg.replace('\\', "/").to_ascii_lowercase();
            path.contains("/@openai/codex/") && path.ends_with("/codex.js")
        })
    })
}

pub fn command(executable: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut command = Command::new(executable);
    command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    command
}

pub async fn inspect(provider: Provider) -> Result<Runtime, String> {
    // Built-in Windows process metadata, queried only when a switch is requested.
    // Command lines are used for classification and never sent to the interface.
    let script = "[Console]::OutputEncoding = [Text.UTF8Encoding]::new(); $ErrorActionPreference='Stop'; ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine,Name,@{Name='Started';Expression={if ($_.CreationDate) {$_.CreationDate.ToUniversalTime().Ticks.ToString()}}})";
    let output = timeout(Duration::from_secs(15), command("powershell.exe").args(["-NoProfile", "-NonInteractive", "-Command", script]).output()).await
        .map_err(|_| "Windows took too long to check running sessions.")?.map_err(|_| "Could not inspect running sessions.")?;
    if !output.status.success() { return Err("Windows could not check running sessions. Close the relevant apps and retry.".into()) }
    let processes: Vec<Process> = serde_json::from_slice(&output.stdout).map_err(|_| "Windows returned unreadable process information.")?;
    let paths = processes.iter().filter(|p| match provider {
        Provider::Codex => p.name.eq_ignore_ascii_case("ChatGPT.exe") || (p.name.eq_ignore_ascii_case("Codex.exe") && p.executable_path.as_ref().is_some_and(|path| is_desktop(path))),
        Provider::Antigravity => p.name.eq_ignore_ascii_case("Antigravity.exe"),
    }).filter_map(|p| p.executable_path.clone()).collect();
    Ok(classify(&processes, std::process::id(), &paths, provider))
}

impl Runtime {
    pub fn running(&self) -> bool { !self.targets.is_empty() }

    pub fn session_names(&self) -> Vec<String> {
        let mut names: Vec<_> = self.targets.iter().map(|p| p.name.clone()).collect();
        names.sort(); names.dedup(); names
    }

    pub async fn close_sessions(&self) -> Result<(), String> {
        if self.contains_own_ancestor { return Err("YouSage was launched inside a session that must close. Open YouSage from its shortcut and retry.".into()) }
        for target in &self.targets {
            // Refresh metadata before killing: never reuse a stale PID for a
            // process that exited while the confirmation panel was open.
            let fresh = inspect(self.provider).await?;
            if !fresh.targets.iter().any(|p| same_process(p, target)) { continue }
            if fresh.contains_own_ancestor { return Err("A session now contains YouSage. Open YouSage from its shortcut and retry.".into()) }
            let _output = timeout(Duration::from_secs(15), command("taskkill.exe").args(["/PID", &target.process_id.to_string(), "/T", "/F"]).output()).await
                .map_err(|_| "A session took too long to close. Close it yourself, then retry the switch.")?.map_err(|_| "Could not close a running session. Close it yourself, then retry the switch.")?;
        }
        for _ in 0..8 {
            let state = inspect(self.provider).await?;
            if !state.running() { return Ok(()) }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        Err("A session is still running. No sign-in was changed. Close the relevant apps and terminals, then retry.".into())
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
                command.spawn().map_err(|_| "A desktop app could not reopen. Open it from your usual shortcut.")?;
            }
        }
        Ok(())
    }
}

fn same_process(a: &Process, b: &Process) -> bool {
    a.process_id == b.process_id && a.started.is_some() && a.started == b.started && a.executable_path == b.executable_path && a.name.eq_ignore_ascii_case(&b.name)
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
    fn process(pid: u32, parent: u32, name: &str, args: &str) -> Process { Process { process_id: pid, parent_process_id: parent, name: name.into(), executable_path: Some(PathBuf::from(name)), command_line: Some(args.into()), started: Some("1".into()) } }

    #[test]
    fn only_owned_engine_processes_are_safe_to_restart() {
        let desktop_paths = HashSet::from([PathBuf::from("ChatGPT.exe")]);
        let mut processes = vec![process(1, 0, "ChatGPT.exe", "ChatGPT"), process(2, 1, "ChatGPT.exe", "renderer"), process(3, 2, "codex.exe", "codex app-server"), process(4, 50, "codex.exe", "codex app-server"), process(7, 2, "codex.exe", "codex -c 'key=value' exec-server")];
        let runtime = classify(&processes, 50, &desktop_paths, Provider::Codex);
        assert_eq!(runtime.desktop.len(), 1); assert!(!runtime.cli_running);
        processes.push(process(5, 2, "codex.exe", "codex resume"));
        assert!(classify(&processes, 50, &desktop_paths, Provider::Codex).cli_running);
        processes.pop(); processes.push(process(6, 99, "codex.exe", "codex app-server"));
        assert!(classify(&processes, 50, &desktop_paths, Provider::Codex).cli_running);
    }

    #[test]
    fn prompt_arguments_cannot_disguise_terminal_work_as_an_engine() {
        assert!(!is_engine("codex exec app-server"));
        assert!(!is_engine("codex -c key=app-server resume"));
        assert!(is_engine("codex -c key=value exec-server --listen stdio://"));
        assert!(is_engine("codex app-server --listen stdio://"));
    }

    #[test]
    fn codex_switch_closes_desktop_and_related_terminal_but_not_other_tabs() {
        let processes = vec![
            process(1, 0, "WindowsTerminal.exe", "terminal"),
            process(2, 1, "pwsh.exe", "pwsh"),
            process(3, 2, "node.exe", "node C:/npm/node_modules/@openai/codex/bin/codex.js"),
            process(4, 3, "codex.exe", "codex resume"),
            process(5, 1, "pwsh.exe", "pwsh unrelated"),
            process(6, 5, "agy.exe", "agy"),
            process(7, 0, "ChatGPT.exe", "ChatGPT"),
            process(8, 7, "codex.exe", "codex app-server"),
            process(9, 50, "codex.exe", "codex app-server"),
        ];
        let runtime = classify(&processes, 50, &HashSet::from([PathBuf::from("ChatGPT.exe")]), Provider::Codex);
        let ids: HashSet<_> = runtime.targets.iter().map(|p| p.process_id).collect();
        assert_eq!(ids, HashSet::from([2, 7]));
        assert!(runtime.cli_running);
        assert!(!runtime.contains_own_ancestor);
    }

    #[test]
    fn antigravity_switch_finds_agy_and_ignores_its_own_usage_check() {
        let processes = vec![
            process(1, 0, "WindowsTerminal.exe", "terminal"),
            process(2, 1, "cmd.exe", "cmd"),
            process(3, 2, "agy.exe", "agy --continue"),
            process(4, 0, "Antigravity.exe", "Antigravity"),
            process(5, 4, "agy.exe", "agy"),
            process(6, 50, "agy.exe", "agy -p /usage --output-format json"),
            process(7, 6, "agy.exe", "agy helper"),
            process(8, 0, "codex.exe", "codex"),
        ];
        let runtime = classify(&processes, 50, &HashSet::new(), Provider::Antigravity);
        let ids: HashSet<_> = runtime.targets.iter().map(|p| p.process_id).collect();
        assert_eq!(ids, HashSet::from([2, 4]));
    }

    #[test]
    fn a_switch_cannot_kill_an_ancestor_of_yousage() {
        let processes = vec![process(1, 0, "ChatGPT.exe", "ChatGPT"), process(50, 1, "yousage.exe", "yousage")];
        assert!(classify(&processes, 50, &HashSet::new(), Provider::Codex).contains_own_ancestor);
    }

    #[test]
    fn reused_or_unknown_process_start_times_cannot_be_killed() {
        let old = process(1, 0, "cmd.exe", "cmd");
        let mut reused = old.clone(); reused.started = Some("2".into());
        assert!(!same_process(&old, &reused));
        reused.started = None;
        assert!(!same_process(&old, &reused));
        assert!(!same_process(&reused, &reused));
        assert!(same_process(&old, &old));
    }

    #[test]
    #[cfg(windows)]
    fn windows_process_snapshot_is_readable_and_excludes_our_helpers() {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime.block_on(async {
            for provider in [Provider::Codex, Provider::Antigravity] {
                let sessions = inspect(provider).await.unwrap();
                assert!(sessions.targets.iter().all(|p| p.process_id != std::process::id()));
                assert!(sessions.targets.iter().all(|p| !p.name.eq_ignore_ascii_case("yousage.exe")));
            }
        });
    }
}
