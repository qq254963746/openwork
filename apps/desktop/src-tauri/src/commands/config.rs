use crate::config::{read_opencode_config as read_inner, write_opencode_config as write_inner};
use crate::types::{ExecResult, OpencodeAuthJsonFile, OpencodeConfigFile};
use dirs::home_dir;
use std::env;
use std::fs;
use std::path::PathBuf;

#[tauri::command]
pub fn read_opencode_config(
    scope: String,
    project_dir: String,
) -> Result<OpencodeConfigFile, String> {
    read_inner(scope.trim(), &project_dir)
}

#[tauri::command]
pub fn write_opencode_config(
    scope: String,
    project_dir: String,
    content: String,
) -> Result<ExecResult, String> {
    write_inner(scope.trim(), &project_dir, &content)
}

fn opencode_auth_json_path_candidates() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Ok(xdg_data) = env::var("XDG_DATA_HOME") {
        let trimmed = xdg_data.trim();
        if !trimmed.is_empty() {
            dirs.push(PathBuf::from(trimmed).join("opencode"));
        }
    }
    if let Some(home) = home_dir() {
        dirs.push(home.join(".local").join("share").join("opencode"));
        #[cfg(target_os = "macos")]
        dirs.push(
            home
                .join("Library")
                .join("Application Support")
                .join("opencode"),
        );
        #[cfg(target_os = "windows")]
        if let Ok(app_data) = env::var("APPDATA") {
            let trimmed = app_data.trim();
            if !trimmed.is_empty() {
                dirs.push(PathBuf::from(trimmed).join("opencode"));
            }
        }
    }
    dirs.into_iter().map(|dir| dir.join("auth.json")).collect()
}

/// Reads OpenCode `auth.json` from known global data dirs (same locations as the orchestrator sandbox mount).
#[tauri::command]
pub fn read_opencode_auth_json() -> Result<OpencodeAuthJsonFile, String> {
    for path in opencode_auth_json_path_candidates() {
        if path.is_file() {
            let content = fs::read_to_string(&path)
                .map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
            return Ok(OpencodeAuthJsonFile {
                path: Some(path.to_string_lossy().to_string()),
                content: Some(content),
            });
        }
    }
    Ok(OpencodeAuthJsonFile {
        path: None,
        content: None,
    })
}
