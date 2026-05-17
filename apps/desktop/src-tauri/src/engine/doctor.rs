use std::ffi::OsStr;
use std::path::Path;

use crate::engine::paths::{
    resolve_aiwork_env_override, resolve_aiwork_executable,
    resolve_aiwork_executable_without_override,
};
use crate::platform::command_for_program;
use crate::utils::truncate_output;

pub fn aiwork_version(program: &OsStr) -> Option<String> {
    let mut command = command_for_program(Path::new(program));
    for (key, value) in crate::bun_env::bun_env_overrides() {
        command.env(key, value);
    }
    let output = command.arg("--version").output().ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !stdout.is_empty() {
        return Some(stdout);
    }
    if !stderr.is_empty() {
        return Some(stderr);
    }

    None
}

pub fn aiwork_serve_help(program: &OsStr) -> (bool, Option<i32>, Option<String>, Option<String>) {
    let mut command = command_for_program(Path::new(program));
    for (key, value) in crate::bun_env::bun_env_overrides() {
        command.env(key, value);
    }

    match command.arg("serve").arg("--help").output() {
        Ok(output) => {
            let status = output.status.code();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let ok = output.status.success();

            let stdout = if stdout.is_empty() {
                None
            } else {
                Some(truncate_output(&stdout, 4000))
            };
            let stderr = if stderr.is_empty() {
                None
            } else {
                Some(truncate_output(&stderr, 4000))
            };

            (ok, status, stdout, stderr)
        }
        Err(_) => (false, None, None, None),
    }
}

pub fn resolve_sidecar_candidate(
    prefer_sidecar: bool,
    resource_dir: Option<&Path>,
    current_bin_dir: Option<&Path>,
) -> (Option<std::path::PathBuf>, Vec<String>) {
    if !prefer_sidecar {
        return (None, Vec::new());
    }

    let mut notes = Vec::new();

    let mut candidates = Vec::new();

    if let Some(current_bin_dir) = current_bin_dir {
        candidates.push(current_bin_dir.join(crate::engine::paths::aiwork_executable_name()));
    }

    if let Some(resource_dir) = resource_dir {
        candidates.push(
            resource_dir
                .join("sidecars")
                .join(crate::engine::paths::aiwork_executable_name()),
        );
        candidates.push(resource_dir.join(crate::engine::paths::aiwork_executable_name()));
    }

    candidates.push(
        std::path::PathBuf::from("src-tauri/sidecars")
            .join(crate::engine::paths::aiwork_executable_name()),
    );

    for candidate in candidates {
        if candidate.is_file() {
            notes.push(format!("Using bundled sidecar: {}", candidate.display()));
            return (Some(candidate), notes);
        }

        notes.push(format!("Sidecar missing: {}", candidate.display()));
    }

    (None, notes)
}

pub fn resolve_engine_path(
    prefer_sidecar: bool,
    resource_dir: Option<&Path>,
    current_bin_dir: Option<&Path>,
) -> (Option<std::path::PathBuf>, bool, Vec<String>) {
    if !prefer_sidecar {
        return resolve_aiwork_executable();
    }

    let (override_path, mut notes) = resolve_aiwork_env_override();
    if let Some(path) = override_path {
        return (Some(path), false, notes);
    }

    let (sidecar, sidecar_notes) =
        resolve_sidecar_candidate(prefer_sidecar, resource_dir, current_bin_dir);
    notes.extend(sidecar_notes);

    let (resolved, in_path, more_notes) = match sidecar {
        Some(path) => (Some(path), false, Vec::new()),
        None => resolve_aiwork_executable_without_override(),
    };

    notes.extend(more_notes);
    (resolved, in_path, notes)
}
