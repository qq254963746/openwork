use crate::config::{read_aiwork_config as read_inner, resolve_aiwork_app_local_data_dir, write_aiwork_config as write_inner};
use crate::types::{ExecResult, EngineAuthJsonFile, EngineConfigFile};
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
    let base = resolve_aiwork_app_local_data_dir();
    vec![base.join("engine").join("data").join("auth.json")]
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
