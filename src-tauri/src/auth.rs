//! Codex credentials stay in Rust. Only the Codex auth secret is transferred;
//! configuration, conversation history and other secrets are never copied.
use age::secrecy::SecretString;
use base64::{engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD}, Engine};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{fs, io::{Read, Write}, path::Path};
use zeroize::Zeroizing;

#[derive(Clone, Copy, PartialEq)]
pub enum Store { File, Keyring }

impl Store {
    pub fn resolve(mode: &str, home: &Path) -> Result<Self, String> {
        match mode {
            "file" => Ok(Self::File),
            "keyring" => Ok(Self::Keyring),
            "auto" => {
                if read_payload(home, Self::Keyring)?.is_some() { Ok(Self::Keyring) }
                else if home.join("auth.json").is_file() { Ok(Self::File) }
                else { Ok(Self::Keyring) }
            }
            _ => Err("Codex uses temporary or unsupported sign-in storage. Choose file or keyring storage in Codex before switching.".into()),
        }
    }
}

// Deliberately not Debug or Serialize: this type contains credentials.
pub struct Auth {
    bytes: Zeroizing<Vec<u8>>,
    pub account_id: String,
    pub email: Option<String>,
}

pub fn token_account_id(token: &str) -> Option<String> {
    let claims = URL_SAFE_NO_PAD.decode(token.split('.').nth(1)?.trim_end_matches('=')).ok()?;
    let data: Value = serde_json::from_slice(&claims).ok()?;
    data.pointer("/https:~1~1api.openai.com~1auth/chatgpt_account_id")?.as_str().map(str::to_owned)
}

impl Auth {
    fn parse(bytes: Vec<u8>) -> Result<Self, String> {
        let bytes = Zeroizing::new(bytes);
        let data: Value = serde_json::from_slice(&bytes).map_err(|_| "Codex sign-in data is unreadable. Sign in again.")?;
        let tokens = &data["tokens"];
        let account_id = tokens["account_id"].as_str().filter(|s| !s.is_empty()).ok_or("Switching requires a saved ChatGPT sign-in. Connect the account again.")?.to_owned();
        for field in ["access_token", "refresh_token"] {
            if tokens[field].as_str().is_none_or(str::is_empty) { return Err("This account needs a fresh ChatGPT sign-in before it can be switched.".into()) }
        }
        let email = tokens["id_token"].as_str().and_then(|jwt| jwt.split('.').nth(1))
            .and_then(|claims| URL_SAFE_NO_PAD.decode(claims.trim_end_matches('=')).ok())
            .and_then(|claims| serde_json::from_slice::<Value>(&claims).ok())
            .and_then(|claims| claims["email"].as_str().map(str::to_owned));
        Ok(Self { bytes, account_id, email })
    }

    pub fn same_account(&self, other: &Self) -> bool {
        self.account_id == other.account_id && self.email.as_deref().map(str::to_lowercase) == other.email.as_deref().map(str::to_lowercase)
    }

    pub fn read(home: &Path, store: Store) -> Result<Option<Self>, String> {
        read_payload(home, store)?.map(|bytes| Self::parse(bytes.to_vec())).transpose()
    }

    pub fn write(&self, home: &Path, store: Store) -> Result<(), String> { write_payload(home, store, &self.bytes) }
}

fn read_payload(home: &Path, store: Store) -> Result<Option<Zeroizing<Vec<u8>>>, String> {
    if store == Store::Keyring {
        let Some(vault) = read_vault(home)? else { return Ok(None) };
        let Some(secret) = vault["secrets"].get("global/CODEX_AUTH") else { return Ok(None) };
        return secret.as_str().map(|s| Some(Zeroizing::new(s.as_bytes().to_vec()))).ok_or_else(|| "The saved Codex auth format is unsupported. Update Codex and reconnect this account.".into())
    }
    match fs::read(home.join("auth.json")) {
        Ok(bytes) => Ok(Some(Zeroizing::new(bytes))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("Could not read Codex sign-in storage.".into()),
    }
}

fn read_vault(home: &Path) -> Result<Option<Value>, String> {
    let bytes = match fs::read(home.join("secrets/codex_auth.age")) {
        Ok(bytes) => Zeroizing::new(bytes),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("Could not read Codex sign-in storage.".into()),
    };
    let password = password(home, false)?.ok_or("The Windows credential for this account is missing. Connect it again.")?;
    let mut identity = age::scrypt::Identity::new(password);
    // Debug builds benchmark scrypt much slower than Codex's release build.
    // Accept its usual work factor (19), with a bounded allowance of 20.
    identity.set_max_work_factor(20);
    let decryptor = age::Decryptor::new(&bytes[..]).map_err(|_| "Unrecognized Codex credential format. Update Codex and reconnect this account.")?;
    let mut reader = decryptor.decrypt(std::iter::once(&identity as &dyn age::Identity)).map_err(|_| "Windows could not unlock this Codex account. Connect it again.")?;
    let mut plain = Zeroizing::new(Vec::new());
    reader.read_to_end(&mut plain).map_err(|_| "Codex credentials could not be decrypted.")?;
    let vault: Value = serde_json::from_slice(&plain).map_err(|_| "The Codex secret store is unreadable.")?;
    if vault["version"] != 1 || !vault["secrets"].is_object() { return Err("The Codex secret store format is unsupported. Update Codex and reconnect this account.".into()) }
    Ok(Some(vault))
}

fn write_payload(home: &Path, store: Store, bytes: &[u8]) -> Result<(), String> {
    fs::create_dir_all(home).map_err(|_| "Could not prepare Codex sign-in storage.")?;
    if store == Store::File { return atomic_write(&home.join("auth.json"), bytes) }
    let mut vault = read_vault(home)?.unwrap_or_else(|| serde_json::json!({"version":1,"secrets":{}}));
    let text = std::str::from_utf8(bytes).map_err(|_| "The Codex auth credential is unreadable.")?;
    // Keep every other entry, including future Codex auth secrets.
    vault["secrets"]["global/CODEX_AUTH"] = Value::String(text.to_owned());
    write_vault(home, &vault)
}

fn write_vault(home: &Path, vault: &Value) -> Result<(), String> {
    fs::create_dir_all(home.join("secrets")).map_err(|_| "Could not prepare encrypted Codex storage.")?;
    let password = password(home, true)?.ok_or("Windows credential storage is unavailable.")?;
    let plain = Zeroizing::new(serde_json::to_vec(vault).map_err(|_| "Could not prepare encrypted Codex storage.")?);
    let mut output = Zeroizing::new(Vec::new());
    let mut writer = age::Encryptor::with_user_passphrase(password).wrap_output(&mut *output).map_err(|_| "Could not encrypt Codex credentials.")?;
    writer.write_all(&plain).and_then(|_| writer.finish()).map_err(|_| "Could not encrypt Codex credentials.")?;
    atomic_write(&home.join("secrets/codex_auth.age"), &output)
}

fn atomic_write(path: &Path, output: &[u8]) -> Result<(), String> {
    let temporary = path.with_file_name(format!(".yousage-auth-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temporary)?;
        file.write_all(output)?; file.sync_all()?; drop(file);
        fs::rename(&temporary, &path)
    })();
    if result.is_err() { let _ = fs::remove_file(&temporary); return Err("Could not save Codex sign-in. Check that its data folder is writable.".into()) }
    Ok(())
}

pub fn remove(home: &Path, store: Store) -> Result<(), String> {
    if store == Store::Keyring {
        let Some(mut vault) = read_vault(home)? else { return Ok(()) };
        let secrets = vault["secrets"].as_object_mut().ok_or("The Codex secret store is unreadable.")?;
        secrets.remove("global/CODEX_AUTH");
        if !secrets.is_empty() { return write_vault(home, &vault) }
    }
    let path = home.join(if store == Store::File { "auth.json" } else { "secrets/codex_auth.age" });
    match fs::remove_file(path) { Ok(()) => Ok(()), Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()), Err(_) => Err("Could not restore the previous Codex sign-in.".into()) }
}

#[cfg(windows)]
fn password(home: &Path, create: bool) -> Result<Option<SecretString>, String> {
    use std::ptr;
    use windows_sys::Win32::{Foundation::{GetLastError, ERROR_NOT_FOUND}, Security::Credentials::{CredReadW, CredWriteW, CredFree, CREDENTIALW, CRED_TYPE_GENERIC, CRED_PERSIST_LOCAL_MACHINE}};
    let canonical = fs::canonicalize(home).map_err(|_| "The account's data folder is unavailable.")?;
    let hash = format!("{:x}", Sha256::digest(canonical.to_string_lossy().as_bytes()));
    let username = format!("secrets|{}", &hash[..16]);
    let target: Vec<u16> = format!("{username}.codex").encode_utf16().chain(Some(0)).collect();
    let mut credential = ptr::null_mut();
    // The target matches Codex 0.160's encrypted secrets store and is scoped to
    // the canonical CODEX_HOME. No other Windows credentials are enumerated.
    if unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) } != 0 {
        let entry = unsafe { &*credential };
        if entry.CredentialBlob.is_null() || entry.CredentialBlobSize == 0 {
            unsafe { CredFree(credential.cast()) };
            return Err("The Codex Windows encryption key is empty. Reconnect this account.".into())
        }
        let blob = unsafe { std::slice::from_raw_parts(entry.CredentialBlob, entry.CredentialBlobSize as usize) };
        // Codex's Windows keyring uses UTF-16 passwords without a terminator.
        // Accept UTF-8 secret blobs as well when they are unambiguous.
        let decoded = match std::str::from_utf8(blob).ok().filter(|s| !s.contains('\0')) {
            Some(text) => Ok(SecretString::from(text.to_owned())),
            None => {
                let words: Zeroizing<Vec<u16>> = Zeroizing::new(blob.chunks_exact(2).map(|b| u16::from_le_bytes([b[0], b[1]])).collect());
                String::from_utf16(&words).map(SecretString::from).map_err(|_| ())
            }
        };
        unsafe { CredFree(credential.cast()) };
        return decoded.map(Some).map_err(|_| "The Codex Windows credential format is unsupported.".into())
    }
    if unsafe { GetLastError() } != ERROR_NOT_FOUND { return Err("Windows credential storage could not be read.".into()) }
    if !create { return Ok(None) }
    let mut random = Zeroizing::new(Vec::with_capacity(32));
    random.extend_from_slice(uuid::Uuid::new_v4().as_bytes()); random.extend_from_slice(uuid::Uuid::new_v4().as_bytes());
    let value = Zeroizing::new(STANDARD.encode(&*random));
    let mut blob = Zeroizing::new(value.encode_utf16().flat_map(u16::to_le_bytes).collect::<Vec<_>>());
    let mut user: Vec<u16> = username.encode_utf16().chain(Some(0)).collect();
    let entry = CREDENTIALW { Type: CRED_TYPE_GENERIC, TargetName: target.as_ptr() as _, CredentialBlobSize: blob.len() as u32, CredentialBlob: blob.as_mut_ptr(), Persist: CRED_PERSIST_LOCAL_MACHINE, UserName: user.as_mut_ptr(), ..unsafe { std::mem::zeroed() } };
    if unsafe { CredWriteW(&entry, 0) } == 0 { return Err("Windows could not save this account's encryption key.".into()) }
    Ok(Some(SecretString::from(value.to_string())))
}

#[cfg(not(windows))]
fn password(_: &Path, _: bool) -> Result<Option<SecretString>, String> { Err("Account switching currently requires Windows.".into()) }

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(id: &str) -> Vec<u8> {
        let claims = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&serde_json::json!({"email":"test@example.com","https://api.openai.com/auth":{"chatgpt_account_id":id,"chatgpt_user_id":"test-user"}})).unwrap());
        serde_json::to_vec(&serde_json::json!({"tokens":{"account_id":id,"access_token":format!("header.{claims}.signature"),"refresh_token":"test-only-refresh","id_token":format!("header.{claims}.signature")}})).unwrap()
    }

    #[test]
    fn switching_requires_refreshable_chatgpt_credentials() {
        assert!(Auth::parse(br#"{"OPENAI_API_KEY":"test-only"}"#.to_vec()).is_err());
        assert!(Auth::parse(br#"{"tokens":{"account_id":"work","access_token":"access"}}"#.to_vec()).is_err());
        let work = Auth::parse(fixture("work")).unwrap();
        assert_eq!(work.email.as_deref(), Some("test@example.com"));
        assert!(!work.same_account(&Auth::parse(fixture("personal")).unwrap()));
        let data: Value = serde_json::from_slice(&fixture("work")).unwrap();
        assert_eq!(token_account_id(data["tokens"]["access_token"].as_str().unwrap()).as_deref(), Some("work"));
        assert_eq!(token_account_id("not-a-token"), None);
    }

    #[test]
    fn file_switch_and_rollback_preserve_unrelated_codex_data() {
        let home = std::env::temp_dir().join(format!("yousage-auth-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&home).unwrap(); fs::write(home.join("config.toml"), "model = 'test'").unwrap();
        let old = Auth::parse(fixture("work")).unwrap(); old.write(&home, Store::File).unwrap();
        let backup = Auth::read(&home, Store::File).unwrap().unwrap();
        Auth::parse(fixture("personal")).unwrap().write(&home, Store::File).unwrap();
        assert_eq!(Auth::read(&home, Store::File).unwrap().unwrap().account_id, "personal");
        backup.write(&home, Store::File).unwrap();
        assert!(old.same_account(&Auth::read(&home, Store::File).unwrap().unwrap()));
        assert_eq!(fs::read_to_string(home.join("config.toml")).unwrap(), "model = 'test'");
        fs::remove_file(home.join("auth.json")).unwrap(); fs::remove_file(home.join("config.toml")).unwrap(); fs::remove_dir(home).unwrap();
    }

    #[cfg(windows)]
    struct TestHome(std::path::PathBuf);

    #[cfg(windows)]
    impl TestHome {
        fn new() -> Self {
            let home = std::env::temp_dir().join(format!("yousage-keyring-test-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&home).unwrap(); Self(home)
        }
    }

    #[cfg(windows)]
    impl Drop for TestHome {
        fn drop(&mut self) {
            let Ok(canonical) = fs::canonicalize(&self.0) else { return };
            let Ok(temporary) = fs::canonicalize(std::env::temp_dir()) else { return };
            // Validate the absolute target before recursive test cleanup.
            if canonical == temporary || !canonical.starts_with(&temporary) || !canonical.file_name().unwrap().to_string_lossy().starts_with("yousage-keyring-test-") { return }
            let hash = format!("{:x}", Sha256::digest(canonical.to_string_lossy().as_bytes()));
            let target: Vec<u16> = format!("secrets|{}.codex", &hash[..16]).encode_utf16().chain(Some(0)).collect();
            unsafe { windows_sys::Win32::Security::Credentials::CredDeleteW(target.as_ptr(), windows_sys::Win32::Security::Credentials::CRED_TYPE_GENERIC, 0); }
            let _ = fs::remove_dir_all(canonical);
        }
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "requires installed Codex; creates and removes a disposable Windows credential"]
    fn isolated_codex_keyring_compatibility() {
        use std::process::{Command, Stdio};
        let folder = TestHome::new(); let home = &folder.0;
        let mut child = Command::new(crate::rpc::executable()).args(["-c", "cli_auth_credentials_store=\"keyring\"", "login", "--with-api-key"]).env("CODEX_HOME", &home).stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().unwrap();
        child.stdin.take().unwrap().write_all(b"sk-yousage-test-not-a-real-key\n").unwrap();
        assert!(child.wait().unwrap().success());
        let payload = read_payload(&home, Store::Keyring).unwrap().unwrap();
        assert_eq!(serde_json::from_slice::<Value>(&payload).unwrap()["OPENAI_API_KEY"], "sk-yousage-test-not-a-real-key");
        let auth = Auth::parse(fixture("test-account")).unwrap(); auth.write(&home, Store::Keyring).unwrap();
        assert!(auth.same_account(&Auth::read(&home, Store::Keyring).unwrap().unwrap()));
        let status = Command::new(crate::rpc::executable()).args(["-c", "cli_auth_credentials_store=\"keyring\"", "login", "status"]).env("CODEX_HOME", &home).output().unwrap();
        assert!(status.status.success());
        assert!(String::from_utf8_lossy(&status.stderr).contains("ChatGPT"));
        let mut vault = read_vault(home).unwrap().unwrap();
        vault["secrets"]["global/YOUSAGE_TEST_UNRELATED"] = Value::String("unrelated-test-value".into());
        write_vault(home, &vault).unwrap();
        auth.write(home, Store::Keyring).unwrap();
        assert_eq!(read_vault(home).unwrap().unwrap()["secrets"]["global/YOUSAGE_TEST_UNRELATED"], "unrelated-test-value");
        remove(home, Store::Keyring).unwrap();
        assert!(read_payload(home, Store::Keyring).unwrap().is_none());
        assert_eq!(read_vault(home).unwrap().unwrap()["secrets"]["global/YOUSAGE_TEST_UNRELATED"], "unrelated-test-value");
        auth.write(home, Store::File).unwrap();
        let status = Command::new(crate::rpc::executable()).args(["-c", "cli_auth_credentials_store=\"auto\"", "login", "status"]).env("CODEX_HOME", &home).output().unwrap();
        assert!(status.status.success());
        assert!(Store::resolve("auto", home).unwrap() == Store::File);
        let created = TestHome::new(); auth.write(&created.0, Store::Keyring).unwrap();
        let status = Command::new(crate::rpc::executable()).args(["-c", "cli_auth_credentials_store=\"keyring\"", "login", "status"]).env("CODEX_HOME", &created.0).output().unwrap();
        assert!(status.status.success());
        assert!(String::from_utf8_lossy(&status.stderr).contains("ChatGPT"));
        assert!(Command::new(crate::rpc::executable()).args(["-c", "cli_auth_credentials_store=\"keyring\"", "logout"]).env("CODEX_HOME", &home).stdout(Stdio::null()).stderr(Stdio::null()).status().unwrap().success());
    }
}
