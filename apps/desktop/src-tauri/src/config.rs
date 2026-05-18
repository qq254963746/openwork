use std::env;
use std::fs;
use std::path::PathBuf;

use crate::types::{ExecResult, EngineConfigFile};

fn aiwork_config_candidates(
    scope: &str,
    project_dir: &str,
) -> Result<Vec<PathBuf>, String> {
    match scope {
        "project" => {
            if project_dir.trim().is_empty() {
                return Err("projectDir is required".to_string());
            }
            let root = PathBuf::from(project_dir);
            Ok(vec![
                root.join("engine.jsonc"),
                root.join("engine.json"),
                root.join(".engine").join("engine.jsonc"),
                root.join(".engine").join("engine.json"),
            ])
        }
        "global" => {
            // Match Engine: ENGINE_CONFIG_DIR is the global config root (AiWork dev isolation).
            if let Ok(dir) = env::var("ENGINE_CONFIG_DIR") {
                let trimmed = dir.trim();
                if !trimmed.is_empty() {
                    let root = PathBuf::from(trimmed);
                    return Ok(vec![root.join("engine.jsonc"), root.join("engine.json")]);
                }
            }

            let base = if let Ok(dir) = env::var("XDG_CONFIG_HOME") {
                PathBuf::from(dir)
            } else if let Ok(home) = env::var("HOME") {
                PathBuf::from(home).join(".config")
            } else {
                return Err("Unable to resolve config directory".to_string());
            };

            let root = base.join("engine");
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
