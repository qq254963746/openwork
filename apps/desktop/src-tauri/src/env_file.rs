use std::fs;
use std::path::PathBuf;

use serde::Deserialize;

// User-level env file. Matched byte-for-byte by:
//   apps/server/src/env-file.ts             (CRUD + server routes)
// If any of those change their path resolution or reserved-prefix policy,
// update this file in the same PR.

const RESERVED_PREFIXES: &[&str] = &["AIWORK_", "AIWORK_ENGINE_"];

#[derive(Debug, Deserialize)]
struct EnvFile {
    #[serde(default)]
    variables: Vec<EnvRecord>,
}

#[derive(Debug, Deserialize)]
struct EnvRecord {
    key: String,
    value: String,
}

fn resolve_user_env_file_path() -> Option<PathBuf> {
    if let Ok(override_path) = std::env::var("AIWORK_ENV_STORE") {
        let trimmed = override_path.trim();
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed));
        }
    }

    #[cfg(target_os = "windows")]
    {
        let root = std::env::var("APPDATA")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .map(PathBuf::from)
            .or_else(|| dirs::home_dir().map(|home| home.join("AppData").join("Roaming")));
        return root.map(|base| base.join("aiwork").join("env.json"));
    }

    #[cfg(not(target_os = "windows"))]
    {
        dirs::home_dir().map(|home| home.join(".config").join("aiwork").join("env.json"))
    }
}

fn is_valid_env_key(key: &str) -> bool {
    let mut chars = key.chars();
    match chars.next() {
        Some(first) if first.is_ascii_alphabetic() || first == '_' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn is_reserved_env_key(key: &str) -> bool {
    RESERVED_PREFIXES.iter().any(|prefix| key.starts_with(prefix))
}

/// Best-effort load of the user-level env file. Absent, unreadable, or
/// malformed files return an empty vector; reserved-prefix keys are always
/// stripped so a tampered file cannot shadow AiWork / AiWorkEngine internals.
pub fn load_user_env_file() -> Vec<(String, String)> {
    let Some(path) = resolve_user_env_file_path() else {
        return Vec::new();
    };
    let Ok(raw) = fs::read_to_string(&path) else {
        return Vec::new();
    };
    let Ok(parsed) = serde_json::from_str::<EnvFile>(&raw) else {
        return Vec::new();
    };
    parsed
        .variables
        .into_iter()
        .filter(|record| is_valid_env_key(&record.key) && !is_reserved_env_key(&record.key))
        .map(|record| (record.key, record.value))
        .collect()
}
