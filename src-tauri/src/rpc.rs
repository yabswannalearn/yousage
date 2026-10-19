use serde_json::{json, Value};
use std::{path::{Path, PathBuf}, process::Stdio, time::Duration};
use tokio::{io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines}, process::{Child, ChildStdin, ChildStdout, Command}, time::timeout};

pub struct Rpc {
    _child: Child,
    input: ChildStdin,
    output: Lines<BufReader<ChildStdout>>,
    next_id: u64,
    pub login_result: Option<Result<(), String>>,
}

pub fn executable() -> PathBuf {
    if let Some(path) = std::env::var_os("YOUSAGE_CODEX_BIN") { return path.into() }
    if let Some(home) = std::env::var_os("USERPROFILE") {
        let home = PathBuf::from(home);
        for path in [
            home.join("AppData/Local/Programs/OpenAI/Codex/bin/codex.exe"),
            home.join(".codex/packages/standalone/current/bin/codex.exe"),
        ] {
            if path.is_file() { return path }
        }
    }
    PathBuf::from(if cfg!(windows) { "codex.exe" } else { "codex" })
}

pub fn desktop_home() -> PathBuf {
    std::env::var_os("CODEX_HOME").map(PathBuf::from).unwrap_or_else(|| {
        let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).unwrap_or_default();
        PathBuf::from(home).join(".codex")
    })
}

impl Rpc {
    pub async fn start(home: &Path, private: bool) -> Result<Self, String> {
        let mut command = Command::new(executable());
        command.arg("app-server").arg("--listen").arg("stdio://").env("CODEX_HOME", home)
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
        if private {
            // An isolated home gives each account a separate OS credential-store entry.
            command.arg("-c").arg("cli_auth_credentials_store=\"keyring\"");
        }
        #[cfg(windows)]
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW: never flash a console.
        let mut child = command.spawn().map_err(|_| "Codex could not be started. Install or update the Codex desktop app, then retry.".to_owned())?;
        let input = child.stdin.take().ok_or("Codex input is unavailable.")?;
        let output = BufReader::new(child.stdout.take().ok_or("Codex output is unavailable.")?).lines();
        let mut rpc = Self { _child: child, input, output, next_id: 0, login_result: None };
        rpc.request("initialize", json!({"clientInfo":{"name":"yousage","title":"YouSage","version":"0.1.0"}})).await?;
        rpc.send(json!({"method":"initialized","params":{}})).await?;
        Ok(rpc)
    }

    async fn send(&mut self, message: Value) -> Result<(), String> {
        let mut bytes = serde_json::to_vec(&message).map_err(|_| "Could not prepare a Codex request.")?;
        bytes.push(b'\n');
        self.input.write_all(&bytes).await.map_err(|_| "The connection to Codex closed.".to_owned())
    }

    pub async fn next(&mut self) -> Result<Value, String> {
        loop {
            let line = self.output.next_line().await.map_err(|_| "Could not read the Codex response.")?
                .ok_or("The connection to Codex closed.")?;
            let Ok(message) = serde_json::from_str::<Value>(&line) else { continue };
            if message["method"] == "account/login/completed" {
                self.login_result = Some(if message["params"]["success"] == true { Ok(()) } else {
                    Err("Sign-in did not finish. Try connecting the account again.".to_owned())
                });
            }
            return Ok(message)
        }
    }

    pub async fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        self.next_id += 1;
        let id = self.next_id;
        let mut request = json!({"id":id,"method":method});
        if !params.is_null() { request["params"] = params; }
        self.send(request).await?;
        timeout(Duration::from_secs(25), async {
            loop {
                let message = self.next().await?;
                if message["id"].as_u64() != Some(id) { continue }
                if message.get("error").is_some() {
                    // Do not forward raw RPC diagnostics: they may include authentication data.
                    return Err(match method {
                        "account/rateLimits/read" => "Could not fetch usage. Check your connection or reconnect this account.",
                        "account/login/start" => "Could not start sign-in. Update Codex and check that Windows Credential Manager is available.",
                        _ => "Codex could not complete the request. Check your connection and retry.",
                    }.to_owned())
                }
                return Ok(message["result"].clone())
            }
        }).await.map_err(|_| "Codex took too long to respond. Retry when your connection is available.".to_owned())?
    }
}

pub fn antigravity_executable() -> PathBuf {
    if let Some(path) = std::env::var_os("YOUSAGE_ANTIGRAVITY_BIN") { return path.into() }
    if let Some(home) = std::env::var_os("USERPROFILE") {
        let home = PathBuf::from(home);
        for path in [
            home.join("AppData/Local/agy/bin/agy.exe"),
            home.join("AppData/Local/Programs/Antigravity/bin/agy.exe"),
        ] {
            if path.is_file() { return path }
        }
    }
    PathBuf::from(if cfg!(windows) { "agy.exe" } else { "agy" })
}

pub fn antigravity_user_root() -> PathBuf {
    std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from).unwrap_or_default()
}

pub fn antigravity_home() -> PathBuf {
    std::env::var_os("GEMINI_CLI_HOME").map(PathBuf::from).unwrap_or_else(|| antigravity_user_root().join(".gemini"))
}

pub fn antigravity_email_in(user_root: &Path) -> Option<String> {
    let bytes = std::fs::read(user_root.join(".gemini/google_accounts.json")).ok()?;
    let value: Value = serde_json::from_slice(&bytes).ok()?;
    value["active"].as_str().filter(|s| !s.is_empty()).map(str::to_owned)
}

pub fn antigravity_email() -> Option<String> {
    let bytes = std::fs::read(antigravity_home().join("google_accounts.json")).ok()?;
    let value: Value = serde_json::from_slice(&bytes).ok()?;
    value["active"].as_str().filter(|s| !s.is_empty()).map(str::to_owned)
}

const ANTIGRAVITY_AUTH_FILES: [&str; 4] = [
    "google_accounts.json",
    "google_account_id",
    "oauth_creds.json",
    "antigravity-cli/jetski_state.pbtxt",
];

pub fn copy_antigravity_auth(from_root: &Path, to_root: &Path) -> Result<(), String> {
    let src_gemini = from_root.join(".gemini");
    if !src_gemini.join("oauth_creds.json").is_file() && !src_gemini.join("antigravity-cli/jetski_state.pbtxt").is_file() {
        return Err("No active Antigravity sign-in was found to save. Sign in with 'agy' first.".into());
    }
    sync_antigravity_auth(&src_gemini, &to_root.join(".gemini"))
}

// Synchronize the complete auth set, including absence. Keeping an old token
// file when the incoming account lacks it can select the outgoing account.
// Empty sources are allowed for restoring a previously signed-out state.
pub fn sync_antigravity_auth(source: &Path, destination: &Path) -> Result<(), String> {
    for name in ANTIGRAVITY_AUTH_FILES {
        let target = destination.join(name);
        match std::fs::read(source.join(name)) {
            Ok(bytes) => {
                let bytes = zeroize::Zeroizing::new(bytes);
                std::fs::create_dir_all(target.parent().unwrap()).map_err(|_| "Could not prepare Antigravity credentials.")?;
                let mut file = tempfile::NamedTempFile::new_in(target.parent().unwrap()).map_err(|_| "Could not prepare Antigravity credentials.")?;
                std::io::Write::write_all(&mut file, &bytes).map_err(|_| "Could not copy Antigravity credentials.")?;
                file.persist(&target).map_err(|_| "Could not replace Antigravity credentials.")?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                match std::fs::remove_file(&target) {
                    Ok(()) => {},
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
                    Err(_) => return Err("Could not clear outgoing Antigravity credentials.".into()),
                }
            }
            Err(_) => return Err("Could not read Antigravity credentials.".into()),
        }
    }
    Ok(())
}

pub async fn read_antigravity_in(user_root: Option<&Path>) -> Result<(Option<String>, Vec<crate::model::AntigravityGroup>, Option<String>), String> {
    let source = user_root.map(|root| root.join(".gemini")).unwrap_or_else(antigravity_home);
    let usage_home = UsageHome::new(&source)?;
    let mut command = Command::new(antigravity_executable());
    command.args(["-p", "/usage", "--output-format", "json"])
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
    // agy starts configured MCP servers even for /usage. Give quota checks an
    // auth-only home and working directory, with no user/project MCP settings.
    let root = usage_home.directory.path();
    command.current_dir(root).env("USERPROFILE", root).env("HOME", root)
        .env("GEMINI_CLI_HOME", root.join(".gemini"));
    #[cfg(windows)]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW: never flash a console.
    let output = timeout(Duration::from_secs(25), command.output()).await
        .map_err(|_| "Antigravity took too long to respond. Retry when your connection is available.".to_owned())?
        .map_err(|_| "Antigravity CLI (agy) could not be started. Install Antigravity or check your PATH.".to_owned())?;
    if !output.status.success() {
        return Err("Could not fetch Antigravity usage. Sign in with 'agy' or check your connection.".to_owned())
    }
    let response: Value = serde_json::from_slice(&output.stdout)
        .map_err(|_| "Could not read the Antigravity usage response.".to_owned())?;
    if response["status"].as_str() != Some("SUCCESS") {
        return Err("Antigravity could not complete the usage check. Sign in with 'agy' and retry.".to_owned())
    }
    usage_home.save_refreshed_auth()?;
    let groups = crate::model::parse_antigravity_usage(&response);
    let error = groups.is_empty().then(|| "Antigravity did not return model quota groups for this account.".to_owned());
    let email = user_root.and_then(antigravity_email_in).or_else(antigravity_email);
    Ok((email, groups, error))
}

struct UsageHome {
    directory: tempfile::TempDir,
    source: PathBuf,
    original: Vec<Option<zeroize::Zeroizing<Vec<u8>>>>,
}

pub fn temporary_auth_home() -> Result<tempfile::TempDir, String> {
    let mut builder = tempfile::Builder::new();
    builder.prefix("yousage-signin-");
    // A custom Windows TEMP can be shared/readable by other local users.
    // Keep temporary credentials under the current user's local app data.
    #[cfg(windows)]
    let directory = builder.tempdir_in(std::env::var_os("LOCALAPPDATA")
        .ok_or("Windows local application data is unavailable.")?);
    #[cfg(not(windows))]
    let directory = builder.tempdir();
    directory.map_err(|_| "Could not prepare a private sign-in directory.".into())
}

impl UsageHome {
    fn new(source: &Path) -> Result<Self, String> {
        let directory = temporary_auth_home()?;
        let mut original = Vec::new();
        for name in ANTIGRAVITY_AUTH_FILES {
            let bytes = match std::fs::read(source.join(name)) {
                Ok(bytes) => Some(zeroize::Zeroizing::new(bytes)),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
                Err(_) => return Err("Could not read the Antigravity sign-in.".into()),
            };
            if let Some(bytes) = &bytes {
                let target = directory.path().join(".gemini").join(name);
                std::fs::create_dir_all(target.parent().unwrap()).and_then(|_| std::fs::write(target, bytes))
                    .map_err(|_| "Could not prepare the Antigravity sign-in for usage.".to_owned())?;
            }
            original.push(bytes);
        }
        Ok(Self { directory, source: source.to_owned(), original })
    }

    fn save_refreshed_auth(&self) -> Result<(), String> {
        // Another CLI may have refreshed or switched accounts while we queried.
        // Never replace credentials that changed since the check started.
        for (name, original) in ANTIGRAVITY_AUTH_FILES.iter().zip(&self.original) {
            let current = std::fs::read(self.source.join(name)).ok().map(zeroize::Zeroizing::new);
            if current != *original { return Err("Antigravity sign-in changed during usage checking. Refresh again.".into()) }
        }
        for (name, original) in ANTIGRAVITY_AUTH_FILES.iter().zip(&self.original) {
            let refreshed = std::fs::read(self.directory.path().join(".gemini").join(name)).ok().map(zeroize::Zeroizing::new);
            if let Some(bytes) = refreshed.filter(|bytes| original.as_ref() != Some(bytes)) {
                let target = self.source.join(name);
                std::fs::create_dir_all(target.parent().unwrap()).map_err(|_| "Could not save the refreshed Antigravity sign-in.")?;
                let mut file = tempfile::NamedTempFile::new_in(target.parent().unwrap()).map_err(|_| "Could not save the refreshed Antigravity sign-in.")?;
                std::io::Write::write_all(&mut file, &bytes).map_err(|_| "Could not save the refreshed Antigravity sign-in.")?;
                file.persist(&target).map_err(|_| "Could not save the refreshed Antigravity sign-in.")?;
            }
        }
        Ok(())
    }
}

pub async fn read_antigravity() -> Result<crate::model::AntigravityStatus, String> {
    let (email, groups, error) = read_antigravity_in(None).await?;
    Ok(crate::model::AntigravityStatus {
        email,
        groups,
        accounts: vec![],
        updated_at: Some(crate::state::now()),
        error,
    })
}

pub async fn fetch_latest_release(current_version: &str) -> Result<crate::model::UpdateStatus, String> {
    let mut command = Command::new(if cfg!(windows) { "curl.exe" } else { "curl" });
    command.args([
        "-sSL",
        "--max-time", "15",
        "-H", "Accept: application/vnd.github+json",
        "-H", "User-Agent: YouSage-Desktop",
        "https://api.github.com/repos/yabswannalearn/yousage/releases/latest",
    ]).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let output = timeout(Duration::from_secs(16), command.output()).await
        .map_err(|_| "Update check timed out. Check your internet connection.".to_owned())?
        .map_err(|_| "Could not run curl to check GitHub Releases.".to_owned())?;
    if !output.status.success() {
        return Err("Could not reach GitHub Releases to check for updates.".to_owned())
    }
    let value: Value = serde_json::from_slice(&output.stdout)
        .map_err(|_| "Could not parse the GitHub release response.".to_owned())?;
    if value.get("tag_name").is_none() {
        return Err("No published release was found on GitHub.".to_owned())
    }
    Ok(crate::model::parse_github_release(&value, current_version))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(windows)]
    fn temporary_credentials_use_private_local_app_data_instead_of_shared_temp() {
        let directory = temporary_auth_home().unwrap();
        assert_eq!(directory.path().parent(), Some(Path::new(&std::env::var_os("LOCALAPPDATA").unwrap())));
    }

    #[test]
    fn quota_home_excludes_mcp_and_preserves_refreshed_credentials() {
        let source = tempfile::tempdir().unwrap();
        std::fs::write(source.path().join("oauth_creds.json"), b"old").unwrap();
        std::fs::write(source.path().join("settings.json"), b"user settings").unwrap();
        std::fs::create_dir(source.path().join("antigravity")).unwrap();
        std::fs::write(source.path().join("antigravity/mcp_config.json"), b"MCP commands").unwrap();
        let home = UsageHome::new(source.path()).unwrap();
        let temporary = home.directory.path().to_owned();
        assert!(!temporary.join(".gemini/settings.json").exists());
        assert!(!temporary.join(".gemini/antigravity/mcp_config.json").exists());
        let credential = temporary.join(".gemini/oauth_creds.json");
        assert_eq!(std::fs::read(&credential).unwrap(), b"old");
        std::fs::write(credential, b"refreshed").unwrap();
        home.save_refreshed_auth().unwrap();
        assert_eq!(std::fs::read(source.path().join("oauth_creds.json")).unwrap(), b"refreshed");
        assert_eq!(std::fs::read(source.path().join("settings.json")).unwrap(), b"user settings");
        drop(home);
        assert!(!temporary.exists());
    }

    #[test]
    fn quota_check_never_overwrites_a_concurrent_sign_in() {
        let source = tempfile::tempdir().unwrap();
        let credential = source.path().join("oauth_creds.json");
        std::fs::write(&credential, b"old").unwrap();
        let home = UsageHome::new(source.path()).unwrap();
        std::fs::write(home.directory.path().join(".gemini/oauth_creds.json"), b"refreshed").unwrap();
        std::fs::write(&credential, b"another account").unwrap();
        assert!(home.save_refreshed_auth().is_err());
        assert_eq!(std::fs::read(credential).unwrap(), b"another account");
    }

    #[test]
    fn switching_antigravity_removes_stale_auth_and_can_restore_signed_out_state() {
        let source = tempfile::tempdir().unwrap();
        let destination = tempfile::tempdir().unwrap();
        std::fs::write(source.path().join("oauth_creds.json"), b"new account").unwrap();
        std::fs::create_dir(destination.path().join("antigravity-cli")).unwrap();
        std::fs::write(destination.path().join("antigravity-cli/jetski_state.pbtxt"), b"old account").unwrap();
        std::fs::write(destination.path().join("settings.json"), b"settings").unwrap();
        sync_antigravity_auth(source.path(), destination.path()).unwrap();
        assert!(!destination.path().join("antigravity-cli/jetski_state.pbtxt").exists());
        assert_eq!(std::fs::read(destination.path().join("oauth_creds.json")).unwrap(), b"new account");
        let signed_out = tempfile::tempdir().unwrap();
        sync_antigravity_auth(signed_out.path(), destination.path()).unwrap();
        assert!(!destination.path().join("oauth_creds.json").exists());
        assert_eq!(std::fs::read(destination.path().join("settings.json")).unwrap(), b"settings");
    }
}
