use crate::config::{read_aiwork_config as read_inner, write_aiwork_config as write_inner};
use crate::types::{ExecResult, EngineAuthJsonFile, EngineConfigFile};
use dirs::home_dir;
use std::env;
use std::fs;
use std::path::PathBuf;

#[tauri::command]
pub fn read_aiwork_config(
    scope: String,
    project_dir: String,
) -> Result<EngineConfigFile, String> {
    read_inner(scope.trim(), &project_dir)
}

#[tauri::command]
pub fn write_aiwork_config(
    scope: String,
    project_dir: String,
    content: String,
) -> Result<ExecResult, String> {
    write_inner(scope.trim(), &project_dir, &content)
}

fn aiwork_auth_json_path_candidates() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Ok(xdg_data) = env::var("XDG_DATA_HOME") {
        let trimmed = xdg_data.trim();
        if !trimmed.is_empty() {
            dirs.push(PathBuf::from(trimmed).join("engine"));
        }
    }
    if let Some(home) = home_dir() {
        dirs.push(home.join(".local").join("share").join("engine"));
        #[cfg(target_os = "macos")]
        dirs.push(
            home
                .join("Library")
                .join("Application Support")
                .join("engine"),
        );
        #[cfg(target_os = "windows")]
        if let Ok(app_data) = env::var("APPDATA") {
            let trimmed = app_data.trim();
            if !trimmed.is_empty() {
                dirs.push(PathBuf::from(trimmed).join("engine"));
            }
        }
    }
    dirs.into_iter().map(|dir| dir.join("auth.json")).collect()
}

/// Reads Engine `auth.json` from known global data dirs
#[tauri::command]
pub fn read_aiwork_auth_json() -> Result<EngineAuthJsonFile, String> {
    for path in aiwork_auth_json_path_candidates() {
        if path.is_file() {
            let content = fs::read_to_string(&path)
                .map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
            return Ok(EngineAuthJsonFile {
                path: Some(path.to_string_lossy().to_string()),
                content: Some(content),
            });
        }
    }
    Ok(EngineAuthJsonFile {
        path: None,
        content: None,
    })
}
