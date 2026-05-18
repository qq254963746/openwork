use std::fs;
use std::path::PathBuf;

use sha2::{Digest, Sha256};
use tauri::Manager;

use crate::paths::home_dir;
use crate::types::{WorkspaceState, WORKSPACE_STATE_VERSION};

pub fn stable_workspace_id(path: &str) -> String {
    let digest = Sha256::digest(path.as_bytes());
    let hex = format!("{:x}", digest);
    format!("ws_{}", &hex[..12])
}

pub fn normalize_local_workspace_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let expanded = if trimmed == "~" {
        home_dir().unwrap_or_else(|| PathBuf::from(trimmed))
    } else if trimmed.starts_with("~/") || trimmed.starts_with("~\\") {
        if let Some(home) = home_dir() {
            let suffix = trimmed[2..].trim_start_matches(['/', '\\']);
            home.join(suffix)
        } else {
            PathBuf::from(trimmed)
        }
    } else {
        PathBuf::from(trimmed)
    };

    let normalized = fs::canonicalize(&expanded).unwrap_or(expanded);
    normalized.to_string_lossy().to_string()
}

pub fn normalize_local_workspace_path_fast(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let expanded = if trimmed == "~" {
        home_dir().unwrap_or_else(|| PathBuf::from(trimmed))
    } else if trimmed.starts_with("~/") || trimmed.starts_with("~\\") {
        if let Some(home) = home_dir() {
            let suffix = trimmed[2..].trim_start_matches(['/', '\\']);
            home.join(suffix)
        } else {
            PathBuf::from(trimmed)
        }
    } else {
        PathBuf::from(trimmed)
    };

    expanded.to_string_lossy().to_string()
}

pub fn aiwork_state_paths(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to resolve app local data dir: {e}"))?;
    let file_path = data_dir.join("aiwork-workspaces.json");
    Ok((data_dir, file_path))
}

pub fn repair_workspace_state(state: &mut WorkspaceState) {
    let mut changed_ids = false;
    let old_selected_workspace_id = state.selected_workspace_id.clone();
    let old_watched_workspace_id = state.watched_workspace_id.clone();
    for workspace in state.workspaces.iter_mut() {
        // Canonicalize only currently selected/watched entries. Full canonicalization across
        // every workspace can block startup/switch paths when mounts are slow.
        let canonicalize_for_active_workspace = workspace.id == old_selected_workspace_id
            || workspace.id == old_watched_workspace_id;
        let normalized = if canonicalize_for_active_workspace {
            normalize_local_workspace_path(&workspace.path)
        } else {
            normalize_local_workspace_path_fast(&workspace.path)
        };
        if !normalized.is_empty() {
            workspace.path = normalized;
        }
        let next_id = stable_workspace_id(&workspace.path);

        if workspace.id != next_id {
            if old_selected_workspace_id == workspace.id {
                state.selected_workspace_id = next_id.clone();
            }
            if old_watched_workspace_id == workspace.id {
                state.watched_workspace_id = next_id.clone();
            }
            workspace.id = next_id;
            changed_ids = true;
        }
    }

    if state.version < WORKSPACE_STATE_VERSION {
        state.version = WORKSPACE_STATE_VERSION;
    }

    if changed_ids && state.selected_workspace_id.is_empty() {
        state.selected_workspace_id = state
            .workspaces
            .first()
            .map(|workspace| workspace.id.clone())
            .unwrap_or_default();
    }

    if !state.watched_workspace_id.is_empty()
        && !state
            .workspaces
            .iter()
            .any(|workspace| workspace.id == state.watched_workspace_id)
    {
        state.watched_workspace_id.clear();
    }

    if state.watched_workspace_id.is_empty() {
        state.watched_workspace_id = state.selected_workspace_id.clone();
    }
}

pub fn load_workspace_state(app: &tauri::AppHandle) -> Result<WorkspaceState, String> {
    let (_, path) = aiwork_state_paths(app)?;
    if !path.exists() {
        return Ok(WorkspaceState::default());
    }

    let raw =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
    let mut state: WorkspaceState = serde_json::from_str(&raw)
        .map_err(|e| format!("Failed to parse {}: {e}", path.display()))?;
    repair_workspace_state(&mut state);

    Ok(state)
}

pub fn load_workspace_state_fast(app: &tauri::AppHandle) -> Result<WorkspaceState, String> {
    let (_, path) = aiwork_state_paths(app)?;
    if !path.exists() {
        return Ok(WorkspaceState::default());
    }

    let raw =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
    serde_json::from_str(&raw).map_err(|e| format!("Failed to parse {}: {e}", path.display()))
}

pub fn save_workspace_state(app: &tauri::AppHandle, state: &WorkspaceState) -> Result<(), String> {
    let (dir, path) = aiwork_state_paths(app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create {}: {e}", dir.display()))?;
    fs::write(
        &path,
        serde_json::to_string_pretty(state).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("Failed to write {}: {e}", path.display()))?;
    Ok(())
}
