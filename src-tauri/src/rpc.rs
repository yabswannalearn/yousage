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

pub fn antigravity_home() -> PathBuf {
    std::env::var_os("GEMINI_CLI_HOME").map(PathBuf::from).unwrap_or_else(|| {
        let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).unwrap_or_default();
        PathBuf::from(home).join(".gemini")
    })
}

pub fn antigravity_email() -> Option<String> {
    let bytes = std::fs::read(antigravity_home().join("google_accounts.json")).ok()?;
    let value: Value = serde_json::from_slice(&bytes).ok()?;
    value["active"].as_str().filter(|s| !s.is_empty()).map(str::to_owned)
}

pub async fn read_antigravity() -> Result<crate::model::AntigravityStatus, String> {
    let mut command = Command::new(antigravity_executable());
    command.args(["-p", "/usage", "--output-format", "json"])
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
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
    let groups = crate::model::parse_antigravity_usage(&response);
    let error = groups.is_empty().then(|| "Antigravity did not return model quota groups for this account.".to_owned());
    Ok(crate::model::AntigravityStatus {
        email: antigravity_email(),
        groups,
        updated_at: Some(crate::state::now()),
        error,
    })
}
