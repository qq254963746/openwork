use tauri::{AppHandle, Manager, State};

use crate::config::{read_aiwork_config, write_aiwork_config};
use crate::engine::doctor::{aiwork_serve_help, aiwork_version, resolve_engine_path};
use crate::engine::manager::EngineManager;
use crate::aiwork_server::{manager::AiWorkServerManager, start_aiwork_server};
use crate::types::{EngineDoctorResult, EngineInfo, EngineRuntime};
use crate::utils::truncate_output;
use serde::Deserialize;
use serde_json::json;

struct EnvVarGuard {
    key: &'static str,
    original: Option<std::ffi::OsString>,
}

impl EnvVarGuard {
    fn apply(key: &'static str, value: Option<&str>) -> Self {
        let original = std::env::var_os(key);
        match value {
            Some(next) if !next.trim().is_empty() => {
                std::env::set_var(key, next.trim());
            }
            _ => {
                std::env::remove_var(key);
            }
        }
        Self { key, original }
    }
}

impl Drop for EnvVarGuard {
    fn drop(&mut self) {
        match &self.original {
            Some(value) => std::env::set_var(self.key, value),
            None => std::env::remove_var(self.key),
        }
    }
}

#[derive(Debug, Deserialize)]
struct AiWorkWorkspaceListResponse {
    #[serde(default)]
    items: Vec<AiWorkWorkspaceEntry>,
}

#[derive(Debug, Deserialize)]
struct AiWorkWorkspaceEntry {
    opencode: Option<AiWorkWorkspaceAiWorkEngine>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiWorkWorkspaceAiWorkEngine {
    base_url: String,
    directory: Option<String>,
    username: Option<String>,
    password: Option<String>,
}

fn parse_base_url_host(base_url: &str) -> Option<String> {
    let without_scheme = base_url
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(base_url);
    let host_port = without_scheme.split('/').next()?.trim();
    let host = host_port
        .rsplit_once(':')
        .map(|(host, _)| host)
        .unwrap_or(host_port);
    if host.is_empty() {
        None
    } else {
        Some(host.trim_matches(['[', ']']).to_string())
    }
}

fn parse_base_url_port(base_url: &str) -> Option<u16> {
    let without_scheme = base_url
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(base_url);
    let host_port = without_scheme.split('/').next()?.trim();
    host_port
        .rsplit_once(':')
        .and_then(|(_, port)| port.parse::<u16>().ok())
}

fn aiwork_bin_source(notes: &[String], in_path: bool) -> Option<String> {
    if notes
        .iter()
        .any(|note| note.contains("Using AIWORK_ENGINE_BIN_PATH"))
    {
        return Some("custom".to_string());
    }
    if notes
        .iter()
        .any(|note| note.contains("Using bundled sidecar"))
    {
        return Some("bundled".to_string());
    }
    if in_path {
        return Some("path".to_string());
    }
    if notes.iter().any(|note| note.starts_with("Found at ")) {
        return Some("known-location".to_string());
    }

    None
}

fn probe_aiwork_managed_aiwork(
    server_base_url: &str,
    owner_token: &str,
) -> Result<Option<AiWorkWorkspaceAiWorkEngine>, String> {
    let response = ureq::get(&format!(
        "{}/workspaces",
        server_base_url.trim_end_matches('/')
    ))
    .set("Authorization", &format!("Bearer {owner_token}"))
    .call()
    .map_err(|error| error.to_string())?;
    let payload: AiWorkWorkspaceListResponse = response
        .into_json()
        .map_err(|error| format!("Failed to parse AiWork workspaces response: {error}"))?;

    Ok(payload.items.into_iter().find_map(|entry| {
        entry
            .opencode
            .filter(|opencode| !opencode.base_url.trim().is_empty())
    }))
}

#[tauri::command]
pub fn engine_info(manager: State<EngineManager>) -> EngineInfo {
    let mut state = manager.inner.lock().expect("engine mutex poisoned");
    EngineManager::snapshot_locked(&mut state)
}

#[tauri::command]
pub fn engine_stop(
    manager: State<EngineManager>,
    aiwork_manager: State<AiWorkServerManager>,
) -> EngineInfo {
    let mut state = manager.inner.lock().expect("engine mutex poisoned");
    EngineManager::stop_locked(&mut state);
    if let Ok(mut aiwork_state) = aiwork_manager.inner.lock() {
        AiWorkServerManager::stop_locked(&mut aiwork_state);
    }
    EngineManager::snapshot_locked(&mut state)
}

#[tauri::command]
pub fn engine_restart(
    app: AppHandle,
    manager: State<EngineManager>,
    aiwork_manager: State<AiWorkServerManager>,
    aiwork_enable_exa: Option<bool>,
) -> Result<EngineInfo, String> {
    let project_dir = {
        let state = manager.inner.lock().expect("engine mutex poisoned");
        state
            .project_dir
            .clone()
            .ok_or_else(|| "AiWorkEngine is not configured for a local workspace".to_string())?
    };

    let workspace_paths = vec![project_dir.clone()];
    engine_start(
        app,
        manager,
        aiwork_manager,
        project_dir,
        None,
        None,
        aiwork_enable_exa,
        None,
        Some(workspace_paths),
    )
}

#[tauri::command]
pub fn engine_doctor(
    app: AppHandle,
    prefer_sidecar: Option<bool>,
    aiwork_bin_path: Option<String>,
) -> EngineDoctorResult {
    let prefer_sidecar = prefer_sidecar.unwrap_or(true);
    let resource_dir = app.path().resource_dir().ok();

    let current_bin_dir = tauri::process::current_binary(&app.env())
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.to_path_buf()));

    let _guard = EnvVarGuard::apply("AIWORK_ENGINE_BIN_PATH", aiwork_bin_path.as_deref());

    let (resolved, in_path, notes) = resolve_engine_path(
        prefer_sidecar,
        resource_dir.as_deref(),
        current_bin_dir.as_deref(),
    );
    let resolved_source = aiwork_bin_source(&notes, in_path);

    let (version, supports_serve, serve_help_status, serve_help_stdout, serve_help_stderr) =
        match resolved.as_ref() {
            Some(path) => {
                let (ok, status, stdout, stderr) = aiwork_serve_help(path.as_os_str());
                (
                    aiwork_version(path.as_os_str()),
                    ok,
                    status,
                    stdout,
                    stderr,
                )
            }
            None => (None, false, None, None, None),
        };

    EngineDoctorResult {
        found: resolved.is_some(),
        in_path,
        resolved_path: resolved.map(|path| path.to_string_lossy().to_string()),
        resolved_source,
        version,
        supports_serve,
        notes,
        serve_help_status,
        serve_help_stdout,
        serve_help_stderr,
    }
}

#[tauri::command]
pub fn engine_start(
    app: AppHandle,
    manager: State<EngineManager>,
    aiwork_manager: State<AiWorkServerManager>,
    project_dir: String,
    prefer_sidecar: Option<bool>,
    aiwork_bin_path: Option<String>,
    _aiwork_enable_exa: Option<bool>,
    _runtime: Option<EngineRuntime>,
    workspace_paths: Option<Vec<String>>,
) -> Result<EngineInfo, String> {
    let project_dir = project_dir.trim().to_string();
    if project_dir.is_empty() {
        return Err("projectDir is required".to_string());
    }

    // AiWorkEngine is spawned with `current_dir(project_dir)`. If the user selected a
    // workspace path that doesn't exist yet (common during onboarding), spawning
    // fails with `os error 2`.
    std::fs::create_dir_all(&project_dir)
        .map_err(|e| format!("Failed to create projectDir directory: {e}"))?;

    let config = read_aiwork_config("project", &project_dir)?;
    if !config.exists {
        let content = serde_json::to_string_pretty(&json!({
            "$schema": "https://www.aiwork.love/config.json",
        }))
        .map_err(|e| format!("Failed to serialize opencode config: {e}"))?;
        let write_result = write_aiwork_config("project", &project_dir, &format!("{content}\n"))?;
        if !write_result.ok {
            return Err(write_result.stderr);
        }
    }

    let mut workspace_paths = workspace_paths.unwrap_or_default();
    workspace_paths.retain(|path| !path.trim().is_empty());
    workspace_paths.retain(|path| path.trim() != project_dir);
    workspace_paths.insert(0, project_dir.clone());

    let mut state = manager.inner.lock().expect("engine mutex poisoned");
    EngineManager::stop_locked(&mut state);
    state.runtime = EngineRuntime::Direct;

    let resource_dir = app.path().resource_dir().ok();
    let current_bin_dir = tauri::process::current_binary(&app.env())
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.to_path_buf()));
    let prefer_sidecar = prefer_sidecar.unwrap_or(true);
    let _guard = EnvVarGuard::apply("AIWORK_ENGINE_BIN_PATH", aiwork_bin_path.as_deref());
    let (program, in_path, notes) = resolve_engine_path(
        prefer_sidecar,
        resource_dir.as_deref(),
        current_bin_dir.as_deref(),
    );
    let aiwork_bin_source = aiwork_bin_source(&notes, in_path);
    let Some(program) = program else {
        let notes_text = notes.join("\n");
        return Err(format!(
            "AiWorkEngine CLI not found.\nNotes:\n{notes_text}"
        ));
    };

    let aiwork_bin = program.to_string_lossy().to_string();
    let aiwork_bin_path = Some(aiwork_bin.clone());
    drop(state);

    if let Ok(mut aiwork_state) = aiwork_manager.inner.lock() {
        AiWorkServerManager::stop_locked(&mut aiwork_state);
    }

    let aiwork_info = start_aiwork_server(
        &app,
        &aiwork_manager,
        &workspace_paths,
        None,
        None,
        None,
        true,
        Some(&aiwork_bin),
        aiwork_bin_source.as_deref(),
    )?;

    let managed_aiwork = match (
        aiwork_info.base_url.as_deref(),
        aiwork_info.owner_token.as_deref(),
    ) {
        (Some(server_base_url), Some(owner_token)) => {
            probe_aiwork_managed_aiwork(server_base_url, owner_token)
        }
        _ => Err("AiWork server did not report a base URL and owner token".to_string()),
    };

    match managed_aiwork {
        Ok(Some(opencode)) => {
            if let Ok(mut state) = manager.inner.lock() {
                state.runtime = EngineRuntime::Direct;
                state.child = None;
                state.child_exited = false;
                state.project_dir = opencode.directory.clone().or(Some(project_dir.clone()));
                state.hostname = parse_base_url_host(&opencode.base_url);
                state.port = parse_base_url_port(&opencode.base_url);
                state.base_url = Some(opencode.base_url.clone());
                state.aiwork_username = opencode.username.clone();
                state.aiwork_password = opencode.password.clone();
                state.aiwork_bin_path = aiwork_bin_path.clone();
                state.aiwork_bin_source = aiwork_bin_source.clone();
                state.last_stdout = None;
                state.last_stderr = None;
            }
        }
        Ok(None) => {
            if let Ok(mut state) = manager.inner.lock() {
                state.runtime = EngineRuntime::Direct;
                state.project_dir = Some(project_dir.clone());
                state.aiwork_bin_path = aiwork_bin_path.clone();
                state.aiwork_bin_source = aiwork_bin_source.clone();
                state.last_stderr = Some(truncate_output(
                    "AiWork server did not report a managed AiWorkEngine workspace",
                    8000,
                ));
            }
        }
        Err(error) => {
            if let Ok(mut state) = manager.inner.lock() {
                state.runtime = EngineRuntime::Direct;
                state.project_dir = Some(project_dir.clone());
                state.aiwork_bin_path = aiwork_bin_path.clone();
                state.aiwork_bin_source = aiwork_bin_source.clone();
                state.last_stderr = Some(truncate_output(
                    &format!("AiWork server workspace probe: {error}"),
                    8000,
                ));
            }
        }
    }

    let mut state = manager.inner.lock().expect("engine mutex poisoned");
    Ok(EngineManager::snapshot_locked(&mut state))
}
