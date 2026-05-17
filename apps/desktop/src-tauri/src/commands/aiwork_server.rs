use tauri::{AppHandle, State};

use crate::engine::manager::EngineManager;
use crate::aiwork_server::manager::AiWorkServerManager;
use crate::aiwork_server::start_aiwork_server;
use crate::types::AiWorkServerInfo;
use crate::workspace::state::load_workspace_state;

#[tauri::command]
pub fn aiwork_server_info(manager: State<AiWorkServerManager>) -> AiWorkServerInfo {
    let mut state = manager
        .inner
        .lock()
        .expect("aiwork server mutex poisoned");
    AiWorkServerManager::snapshot_locked(&mut state)
}

#[tauri::command]
pub fn aiwork_server_restart(
    app: AppHandle,
    manager: State<AiWorkServerManager>,
    engine_manager: State<EngineManager>,
) -> Result<AiWorkServerInfo, String> {
    let (workspace_paths, aiwork_url, aiwork_username, aiwork_password) = {
        let engine = engine_manager
            .inner
            .lock()
            .map_err(|_| "engine mutex poisoned".to_string())?;
        let mut workspace_paths = Vec::new();
        if let Some(project_dir) = engine.project_dir.clone() {
            let trimmed = project_dir.trim().to_string();
            if !trimmed.is_empty() {
                workspace_paths.push(trimmed);
            }
        }
        (
            workspace_paths,
            engine.base_url.clone(),
            engine.aiwork_username.clone(),
            engine.aiwork_password.clone(),
        )
    };

    let mut workspace_paths = workspace_paths;
    if workspace_paths.is_empty() {
        let state = load_workspace_state(&app)?;
        for workspace in state.workspaces {
            let trimmed = workspace.path.trim().to_string();
            if trimmed.is_empty() || workspace_paths.iter().any(|path| path == &trimmed) {
                continue;
            }
            workspace_paths.push(trimmed);
        }
    }

    start_aiwork_server(
        &app,
        &manager,
        &workspace_paths,
        aiwork_url.as_deref(),
        aiwork_username.as_deref(),
        aiwork_password.as_deref(),
        false,
        None,
        None,
    )
}
