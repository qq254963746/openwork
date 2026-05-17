use std::collections::HashSet;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use crate::engine::doctor::resolve_engine_path;
use crate::engine::manager::EngineManager;
use crate::aiwork_server::manager::AiWorkServerManager;
use crate::paths::{candidate_xdg_config_dirs, candidate_xdg_data_dirs, home_dir};
use crate::platform::command_for_program;
use crate::types::{DesktopAppPaths, ExecResult, WorkspaceAiWorkConfig};
use crate::workspace::state::load_workspace_state;
use tauri::{AppHandle, Manager, State};

#[derive(serde::Serialize)]
pub struct CacheResetResult {
    pub removed: Vec<String>,
    pub missing: Vec<String>,
    pub errors: Vec<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiWorkEngineEngineDiskLogsSnapshot {
    pub dir: String,
    pub resolved_variant: String,
    pub file_label: Option<String>,
    pub content: String,
    pub error: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppBuildInfo {
    pub version: String,
    pub git_sha: Option<String>,
    pub build_epoch: Option<String>,
    pub aiwork_dev_mode: bool,
    pub os: &'static str,
    pub arch: &'static str,
}

fn env_truthy(key: &str) -> bool {
    matches!(
        std::env::var(key)
            .ok()
            .map(|value| value.trim().to_ascii_lowercase()),
        Some(value) if value == "1" || value == "true" || value == "yes" || value == "on"
    )
}

// #[cfg(target_os = "macos")]
// fn macos_dev_application_support_opencode_log_dir() -> Option<PathBuf> {
//     let home = home_dir()?;
//     Some(
//         home.join("Library/Application Support/com.aiworkgroup3.aiwork.dev/aiwork-engine/xdg/data/opencode/log"),
//     )
// }

fn isolated_opencode_log_dir(app: &AppHandle) -> Option<PathBuf> {
    let root = app.path().app_local_data_dir().ok()?;
    Some(root.join("aiwork-engine/xdg/data/opencode/log"))
}

fn standard_opencode_log_dir() -> PathBuf {
    if let Ok(xdg) = std::env::var("XDG_DATA_HOME") {
        let trimmed = xdg.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed).join("opencode/log");
        }
    }

    #[cfg(windows)]
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let trimmed = local.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed).join("opencode/log");
        }
    }

    home_dir()
        .unwrap_or_default()
        .join(".local/share/opencode/log")
}

fn collect_opencode_disk_log_dir_candidates(app: &AppHandle) -> Vec<(String, PathBuf)> {
    let mut ordered = Vec::new();

    // #[cfg(target_os = "macos")]
    // if let Some(path) = macos_dev_application_support_opencode_log_dir() {
    //     ordered.push(("macos_dev".into(), path));
    // }

    if let Some(path) = isolated_opencode_log_dir(app) {
        ordered.push(("aiwork_isolated".into(), path));
    }

    ordered.push(("standard_data_home".into(), standard_opencode_log_dir()));

    let mut seen = HashSet::new();
    let mut deduped = Vec::new();
    for (label, path) in ordered {
        let key = path.to_string_lossy().to_string();
        if seen.insert(key) {
            deduped.push((label, path));
        }
    }
    deduped
}

fn read_utf8_file_tail(path: &Path, max_bytes: u64) -> std::io::Result<String> {
    let mut file = fs::File::open(path)?;
    let len = file.metadata()?.len();
    let start = len.saturating_sub(max_bytes);
    file.seek(SeekFrom::Start(start))?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf)?;
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

#[tauri::command]
pub fn read_opencode_engine_disk_logs(app: AppHandle) -> AiWorkEngineEngineDiskLogsSnapshot {
    const MAX_BYTES: u64 = 256 * 1024;

    let candidates = collect_opencode_disk_log_dir_candidates(&app);

    for (variant, dir) in &candidates {
        let dir_display = dir.to_string_lossy().to_string();
        if !dir.is_dir() {
            continue;
        }

        let mut newest: Option<(PathBuf, std::time::SystemTime)> = None;
        let Ok(entries) = fs::read_dir(dir) else {
            continue;
        };

        for entry in entries.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if !file_type.is_file() {
                continue;
            }

            let name = entry.file_name().to_string_lossy().to_string();
            if !name.ends_with(".log") {
                continue;
            }

            let Ok(meta) = entry.metadata() else {
                continue;
            };
            let Ok(modified) = meta.modified() else {
                continue;
            };

            let replace = match &newest {
                None => true,
                Some((_, prior)) => modified >= *prior,
            };
            if replace {
                newest = Some((entry.path(), modified));
            }
        }

        let Some((path, _)) = newest else {
            continue;
        };

        let file_label = path
            .file_name()
            .map(|value| value.to_string_lossy().into_owned());

        match read_utf8_file_tail(&path, MAX_BYTES) {
            Ok(content) => {
                return AiWorkEngineEngineDiskLogsSnapshot {
                    dir: dir_display,
                    resolved_variant: variant.clone(),
                    file_label,
                    content,
                    error: None,
                };
            }
            Err(err) => {
                return AiWorkEngineEngineDiskLogsSnapshot {
                    dir: dir_display,
                    resolved_variant: variant.clone(),
                    file_label,
                    content: String::new(),
                    error: Some(format!("read_failed:{err}")),
                };
            }
        }
    }

    let fallback_dir = candidates
        .last()
        .map(|(_, path)| path.to_string_lossy().into_owned())
        .unwrap_or_default();

    AiWorkEngineEngineDiskLogsSnapshot {
        dir: fallback_dir,
        resolved_variant: "none".into(),
        file_label: None,
        content: String::new(),
        error: Some("log_directory_not_found".into()),
    }
}

fn opencode_cache_candidates() -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(value) = std::env::var("XDG_CACHE_HOME") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            candidates.push(PathBuf::from(trimmed).join("opencode"));
        }
    }

    if let Some(home) = home_dir() {
        candidates.push(home.join(".cache").join("opencode"));

        #[cfg(target_os = "macos")]
        {
            candidates.push(home.join("Library").join("Caches").join("opencode"));
        }
    }

    #[cfg(windows)]
    {
        if let Ok(value) = std::env::var("LOCALAPPDATA") {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                candidates.push(PathBuf::from(trimmed).join("opencode"));
            }
        }
        if let Ok(value) = std::env::var("APPDATA") {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                candidates.push(PathBuf::from(trimmed).join("opencode"));
            }
        }
    }

    let mut seen = HashSet::new();
    candidates
        .into_iter()
        .filter(|path| seen.insert(path.to_string_lossy().to_string()))
        .collect()
}

fn push_opencode_env_path(candidates: &mut Vec<PathBuf>, key: &str) {
    let Ok(value) = std::env::var(key) else {
        return;
    };
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return;
    }
    candidates.push(PathBuf::from(trimmed).join("opencode"));
}

fn opencode_standard_state_paths() -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    push_opencode_env_path(&mut candidates, "XDG_CONFIG_HOME");
    push_opencode_env_path(&mut candidates, "XDG_DATA_HOME");
    push_opencode_env_path(&mut candidates, "XDG_STATE_HOME");
    candidates.extend(opencode_cache_candidates());

    for dir in candidate_xdg_config_dirs() {
        candidates.push(dir.join("opencode"));
    }

    for dir in candidate_xdg_data_dirs() {
        candidates.push(dir.join("opencode"));
    }

    if let Some(home) = home_dir() {
        candidates.push(home.join(".local").join("state").join("opencode"));

        #[cfg(target_os = "macos")]
        {
            candidates.push(
                home.join("Library")
                    .join("Application Support")
                    .join("opencode"),
            );
        }
    }

    let mut seen = HashSet::new();
    candidates
        .into_iter()
        .filter(|path| seen.insert(path.to_string_lossy().to_string()))
        .collect()
}

fn current_aiwork_state_paths(app: &AppHandle) -> Result<Vec<PathBuf>, String> {
    let mut paths = vec![
        app.path()
            .app_cache_dir()
            .map_err(|e| format!("Failed to resolve app cache dir: {e}"))?,
        app.path()
            .app_config_dir()
            .map_err(|e| format!("Failed to resolve app config dir: {e}"))?,
        app.path()
            .app_local_data_dir()
            .map_err(|e| format!("Failed to resolve app local data dir: {e}"))?,
        app.path()
            .app_data_dir()
            .map_err(|e| format!("Failed to resolve app data dir: {e}"))?,
    ];

    if let Some(home) = home_dir() {
        paths.push(
            home.join("AiWork")
                .join("Welcome")
                .join(".opencode")
                .join("aiwork.json"),
        );
    }

    Ok(paths)
}

fn stop_host_services(
    engine_manager: &State<EngineManager>,
    aiwork_manager: &State<AiWorkServerManager>,
) {
    if let Ok(mut engine) = engine_manager.inner.lock() {
        EngineManager::stop_locked(&mut engine);
    }
    if let Ok(mut aiwork_state) = aiwork_manager.inner.lock() {
        AiWorkServerManager::stop_locked(&mut aiwork_state);
    }
}

fn remove_path_if_exists(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    if path.is_dir() {
        fs::remove_dir_all(path)
            .map_err(|e| format!("Failed to remove directory {}: {e}", path.display()))
    } else {
        fs::remove_file(path).map_err(|e| format!("Failed to remove file {}: {e}", path.display()))
    }
}

fn validate_server_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("server_name is required".to_string());
    }

    if trimmed.starts_with('-') {
        return Err("server_name must not start with '-'".to_string());
    }

    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("server_name must be alphanumeric with '-' or '_'".to_string());
    }

    Ok(trimmed.to_string())
}

fn read_workspace_aiwork_config(
    workspace_path: &Path,
) -> Result<WorkspaceAiWorkConfig, String> {
    let aiwork_path = workspace_path.join(".opencode").join("aiwork.json");
    if !aiwork_path.exists() {
        let mut cfg = WorkspaceAiWorkConfig::default();
        let workspace_value = workspace_path.to_string_lossy().to_string();
        if !workspace_value.trim().is_empty() {
            cfg.authorized_roots.push(workspace_value);
        }
        return Ok(cfg);
    }

    let raw = fs::read_to_string(&aiwork_path)
        .map_err(|e| format!("Failed to read {}: {e}", aiwork_path.display()))?;

    serde_json::from_str::<WorkspaceAiWorkConfig>(&raw)
        .map_err(|e| format!("Failed to parse {}: {e}", aiwork_path.display()))
}

fn load_authorized_roots(app: &AppHandle) -> Result<Vec<PathBuf>, String> {
    let state = load_workspace_state(app)?;
    let mut roots = Vec::new();

    for workspace in state.workspaces {
        let workspace_path = PathBuf::from(&workspace.path);
        let mut config = read_workspace_aiwork_config(&workspace_path)?;

        if config.authorized_roots.is_empty() {
            config.authorized_roots.push(workspace.path.clone());
        }

        for root in config.authorized_roots {
            let trimmed = root.trim();
            if !trimmed.is_empty() {
                roots.push(PathBuf::from(trimmed));
            }
        }
    }

    if roots.is_empty() {
        return Err("No authorized roots configured".to_string());
    }

    Ok(roots)
}

fn validate_project_dir(app: &AppHandle, project_dir: &str) -> Result<PathBuf, String> {
    let trimmed = project_dir.trim();
    if trimmed.is_empty() {
        return Err("project_dir is required".to_string());
    }

    let project_path = PathBuf::from(trimmed);
    if !project_path.is_absolute() {
        return Err("project_dir must be an absolute path".to_string());
    }

    let canonical = fs::canonicalize(&project_path)
        .map_err(|e| format!("Failed to resolve project_dir: {e}"))?;

    if !canonical.is_dir() {
        return Err("project_dir must be a directory".to_string());
    }

    let roots = load_authorized_roots(app)?;
    let mut allowed = false;
    for root in roots {
        let Ok(root) = fs::canonicalize(&root) else {
            continue;
        };
        if canonical.starts_with(&root) {
            allowed = true;
            break;
        }
    }

    if !allowed {
        return Err("project_dir is not within an authorized root".to_string());
    }

    Ok(canonical)
}

fn resolve_opencode_program(
    app: &AppHandle,
    prefer_sidecar: bool,
    opencode_bin_path: Option<String>,
) -> Result<PathBuf, String> {
    if let Some(custom) = opencode_bin_path {
        let trimmed = custom.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }

    let resource_dir = app.path().resource_dir().ok();
    let current_bin_dir = tauri::process::current_binary(&app.env())
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.to_path_buf()));

    let (program, _in_path, notes) = resolve_engine_path(
        prefer_sidecar,
        resource_dir.as_deref(),
        current_bin_dir.as_deref(),
    );

    program.ok_or_else(|| {
        let notes_text = notes.join("\n");
        format!(
            "AiWorkEngine CLI not found.\nNotes:\n{notes_text}"
        )
    })
}

#[tauri::command]
pub fn reset_opencode_cache() -> Result<CacheResetResult, String> {
    let candidates = opencode_cache_candidates();
    let mut removed = Vec::new();
    let mut missing = Vec::new();
    let mut errors = Vec::new();

    for path in candidates {
        if path.exists() {
            if let Err(err) = std::fs::remove_dir_all(&path) {
                errors.push(format!("Failed to remove {}: {err}", path.display()));
            } else {
                removed.push(path.to_string_lossy().to_string());
            }
        } else {
            missing.push(path.to_string_lossy().to_string());
        }
    }

    Ok(CacheResetResult {
        removed,
        missing,
        errors,
    })
}

#[tauri::command]
pub fn reset_aiwork_state(
    app: tauri::AppHandle,
    mode: String,
    engine_manager: State<EngineManager>,
    aiwork_manager: State<AiWorkServerManager>,
) -> Result<(), String> {
    let mode = mode.trim();
    if mode != "onboarding" && mode != "all" {
        return Err("mode must be 'onboarding' or 'all'".to_string());
    }

    stop_host_services(&engine_manager, &aiwork_manager);

    let mut paths = vec![
        app.path()
            .app_cache_dir()
            .map_err(|e| format!("Failed to resolve app cache dir: {e}"))?,
        app.path()
            .app_config_dir()
            .map_err(|e| format!("Failed to resolve app config dir: {e}"))?,
        app.path()
            .app_local_data_dir()
            .map_err(|e| format!("Failed to resolve app local data dir: {e}"))?,
    ];

    if mode == "all" {
        paths.push(
            app.path()
                .app_data_dir()
                .map_err(|e| format!("Failed to resolve app data dir: {e}"))?,
        );
    }

    let mut seen = HashSet::new();
    for path in paths {
        let key = path.to_string_lossy().to_string();
        if seen.insert(key) {
            remove_path_if_exists(&path)?;
        }
    }

    Ok(())
}

#[tauri::command]
pub fn desktop_app_paths() -> DesktopAppPaths {
    let executable_path = std::env::current_exe().ok();
    let app_bundle_path = executable_path
        .as_ref()
        .and_then(|exe| exe.parent())
        .and_then(|p| p.parent())
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf());

    DesktopAppPaths {
        executable_path: executable_path.map(|p| p.to_string_lossy().to_string()),
        app_bundle_path: app_bundle_path.map(|p| p.to_string_lossy().to_string()),
    }
}

#[tauri::command]
pub fn app_build_info(app: AppHandle) -> AppBuildInfo {
    let version = app.package_info().version.to_string();
    let git_sha = option_env!("AIWORK_GIT_SHA").map(|value| value.to_string());
    let build_epoch = option_env!("AIWORK_BUILD_EPOCH").map(|value| value.to_string());
    AppBuildInfo {
        version,
        git_sha,
        build_epoch,
        aiwork_dev_mode: env_truthy("AIWORK_DEV_MODE"),
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
    }
}

#[tauri::command]
pub fn nuke_aiwork_and_opencode_config_and_exit(
    app: AppHandle,
    engine_manager: State<EngineManager>,
    aiwork_manager: State<AiWorkServerManager>,
) -> Result<(), String> {
    stop_host_services(&engine_manager, &aiwork_manager);

    let dev_mode = env_truthy("AIWORK_DEV_MODE");
    let mut paths = current_aiwork_state_paths(&app)?;
    if dev_mode {
        // In dev mode, the current app  directories are already isolated
        // by the dev app identity and AIWORK_DATA_DIR, so only clear those dev paths.
    } else {
        // In production, clear the normal app paths plus the standard
        // user AiWorkEngine config/data/cache/state locations.
        paths.extend(opencode_standard_state_paths());
    }

    let mut seen = HashSet::new();
    for path in paths {
        let key = path.to_string_lossy().to_string();
        if seen.insert(key) {
            remove_path_if_exists(&path)?;
        }
    }

    app.exit(0);
    Ok(())
}

/// Run `opencode mcp auth <server_name>` in the given project directory.
/// This spawns the process detached so the OAuth flow can open a browser.
#[tauri::command]
pub fn opencode_mcp_auth(
    app: AppHandle,
    project_dir: String,
    server_name: String,
) -> Result<ExecResult, String> {
    let project_dir = validate_project_dir(&app, &project_dir)?;
    let server_name = validate_server_name(&server_name)?;

    let program = resolve_opencode_program(&app, true, None)?;

    let mut command = command_for_program(&program);
    for (key, value) in crate::bun_env::bun_env_overrides() {
        command.env(key, value);
    }

    let output = command
        .arg("mcp")
        .arg("auth")
        .arg(server_name)
        .current_dir(&project_dir)
        .output()
        .map_err(|e| format!("Failed to run opencode mcp auth: {e}"))?;

    let status = output.status.code().unwrap_or(-1);
    Ok(ExecResult {
        ok: output.status.success(),
        status,
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}
