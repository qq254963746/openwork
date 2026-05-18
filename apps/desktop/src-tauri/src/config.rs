use std::env;
use std::fs;
use std::path::PathBuf;

use crate::paths::home_dir;
use crate::types::{ExecResult, EngineConfigFile};
use crate::workspace::files::project_config_dir_for_path;

fn app_bundle_suffix() -> &'static str {
    if std::env::var("AIWORK_DEV_MODE").ok().as_deref() == Some("1") {
        ".dev"
    } else {
        ""
    }
}

/// Resolve the root data directory for all AiWork components (mirrors platform-paths.ts).
/// Priority: AIWORK_APP_LOCAL_DATA_DIR env → platform default.
/// In dev mode (AIWORK_DEV_MODE=1), uses `com.aiworklove.aiwork.dev` to isolate data.
pub fn resolve_aiwork_app_local_data_dir() -> PathBuf {
    if let Ok(override_dir) = env::var("AIWORK_APP_LOCAL_DATA_DIR") {
        let trimmed = override_dir.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    let home = home_dir().unwrap_or_default();
    let bundle_id = format!("com.aiworklove.aiwork{}", app_bundle_suffix());

    #[cfg(target_os = "macos")]
    {
        return home
            .join("Library")
            .join("Application Support")
            .join(bundle_id);
    }

    #[cfg(target_os = "windows")]
    {
        let app_data = env::var("APPDATA")
            .ok()
            .map(|v| PathBuf::from(v.trim()))
            .unwrap_or_else(|| home.join("AppData").join("Roaming"));
        return app_data.join(bundle_id);
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let xdg = env::var("XDG_DATA_HOME")
            .ok()
            .map(|v| PathBuf::from(v.trim()))
            .unwrap_or_else(|| home.join(".local").join("share"));
        return xdg.join(bundle_id);
    }
}

fn aiwork_config_candidates(
    scope: &str,
    project_dir: &str,
) -> Result<Vec<PathBuf>, String> {
    match scope {
        "project" => {
            if project_dir.trim().is_empty() {
                return Err("projectDir is required".to_string());
            }
            let proj = project_config_dir_for_path(project_dir.trim());
            Ok(vec![proj.join("engine.jsonc"), proj.join("engine.json")])
        }
        "global" => {
            // Global config lives under AIWORK_APP_LOCAL_DATA_DIR/engine/config/
            // with ENGINE_CONFIG_DIR override support for dev isolation.
            if let Ok(dir) = env::var("ENGINE_CONFIG_DIR") {
                let trimmed = dir.trim();
                if !trimmed.is_empty() {
                    let root = PathBuf::from(trimmed);
                    return Ok(vec![root.join("engine.jsonc"), root.join("engine.json")]);
                }
            }

            let base = resolve_aiwork_app_local_data_dir();
            let root = base.join("engine").join("config");
            Ok(vec![root.join("engine.jsonc"), root.join("engine.json")])
        }
        _ => Err("scope must be 'project' or 'global'".to_string()),
    }
}

pub fn resolve_aiwork_config_path(scope: &str, project_dir: &str) -> Result<PathBuf, String> {
    let candidates = aiwork_config_candidates(scope, project_dir)?;

    for path in &candidates {
        if path.exists() {
            return Ok(path.clone());
        }
    }

    candidates
        .into_iter()
        .next()
        .ok_or_else(|| "No config path candidates available".to_string())
}

pub fn read_aiwork_config(scope: &str, project_dir: &str) -> Result<EngineConfigFile, String> {
    let path = resolve_aiwork_config_path(scope.trim(), project_dir)?;
    let exists = path.exists();

    let content = if exists {
        Some(
            fs::read_to_string(&path)
                .map_err(|e| format!("Failed to read {}: {e}", path.display()))?,
        )
    } else {
        None
    };

    Ok(EngineConfigFile {
        path: path.to_string_lossy().to_string(),
        exists,
        content,
    })
}

pub fn write_aiwork_config(
    scope: &str,
    project_dir: &str,
    content: &str,
) -> Result<ExecResult, String> {
    let path = resolve_aiwork_config_path(scope.trim(), project_dir)?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config dir {}: {e}", parent.display()))?;
    }

    fs::write(&path, content).map_err(|e| format!("Failed to write {}: {e}", path.display()))?;

    Ok(ExecResult {
        ok: true,
        status: 0,
        stdout: format!("Wrote {}", path.display()),
        stderr: String::new(),
    })
}
