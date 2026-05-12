use std::collections::HashSet;
use std::fs;
use std::net::TcpListener;
use std::path::Path;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::async_runtime::Receiver;
use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

use crate::paths::resolve_process_working_dir;

pub const AIWORK_PORT_RANGE_START: u16 = 48_000;
pub const AIWORK_PORT_RANGE_END: u16 = 51_000;
const PREFERRED_PORT_RETRY_ATTEMPTS: usize = 20;
const PREFERRED_PORT_RETRY_DELAY_MS: u64 = 50;

fn env_truthy_aiwork_dev() -> bool {
    matches!(
        std::env::var("AIWORK_DEV_MODE")
            .ok()
            .map(|v| v.trim().to_ascii_lowercase()),
        Some(ref v) if matches!(v.as_str(), "1" | "true" | "yes" | "on")
    )
}

/// GUI-launched Tauri often inherits no `XDG_*` / `OPENCODE_CONFIG_DIR`; without this,
/// `aiwork-server` resolves global config + managed OpenCode state to `~/.config` while
/// the UI writes credentials under `Application Support/.../aiwork-dev-data/...`.
fn aiwork_dev_isolated_env(app: &AppHandle) -> Result<Option<Vec<(String, String)>>, String> {
    if !env_truthy_aiwork_dev() {
        return Ok(None);
    }

    let app_local = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to resolve app local data dir: {e}"))?;

    let layout_root = app_local.join("aiwork-dev-data");
    let home_dir = layout_root.join("home");
    let xdg_config_home = layout_root.join("xdg").join("config");
    let xdg_data_home = layout_root.join("xdg").join("data");
    let xdg_cache_home = layout_root.join("xdg").join("cache");
    let xdg_state_home = layout_root.join("xdg").join("state");
    let opencode_config_dir = layout_root.join("config").join("opencode");
    let opencode_data_dir = xdg_data_home.join("opencode");

    for dir in [
        &home_dir,
        &xdg_config_home,
        &xdg_data_home,
        &xdg_cache_home,
        &xdg_state_home,
        &opencode_config_dir,
        &opencode_data_dir,
    ] {
        fs::create_dir_all(dir).map_err(|e| format!("Failed to create {}: {e}", dir.display()))?;
    }

    let home = home_dir.to_string_lossy().into_owned();
    Ok(Some(vec![
        ("AIWORK_DEV_MODE".into(), "1".into()),
        ("HOME".into(), home.clone()),
        ("USERPROFILE".into(), home.clone()),
        (
            "XDG_CONFIG_HOME".into(),
            xdg_config_home.to_string_lossy().into_owned(),
        ),
        (
            "XDG_DATA_HOME".into(),
            xdg_data_home.to_string_lossy().into_owned(),
        ),
        (
            "XDG_CACHE_HOME".into(),
            xdg_cache_home.to_string_lossy().into_owned(),
        ),
        (
            "XDG_STATE_HOME".into(),
            xdg_state_home.to_string_lossy().into_owned(),
        ),
        (
            "OPENCODE_CONFIG_DIR".into(),
            opencode_config_dir.to_string_lossy().into_owned(),
        ),
        ("OPENCODE_TEST_HOME".into(), home),
    ]))
}

fn bind_available_port(host: &str, port: u16) -> bool {
    TcpListener::bind((host, port)).is_ok()
}

fn range_port_count() -> usize {
    usize::from(AIWORK_PORT_RANGE_END - AIWORK_PORT_RANGE_START) + 1
}

fn random_range_offset() -> usize {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos();
    usize::try_from(nanos).unwrap_or(0) % range_port_count()
}

fn wait_for_preferred_port(host: &str, port: u16) -> bool {
    for attempt in 0..=PREFERRED_PORT_RETRY_ATTEMPTS {
        if bind_available_port(host, port) {
            return true;
        }
        if attempt < PREFERRED_PORT_RETRY_ATTEMPTS {
            thread::sleep(Duration::from_millis(PREFERRED_PORT_RETRY_DELAY_MS));
        }
    }
    false
}

pub fn resolve_aiwork_port(
    host: &str,
    preferred_port: Option<u16>,
    reserved_ports: &HashSet<u16>,
) -> Result<u16, String> {
    if let Some(port) = preferred_port.filter(|port| *port > 0) {
        if !reserved_ports.contains(&port) && wait_for_preferred_port(host, port) {
            return Ok(port);
        }
    }

    let count = range_port_count();
    let start = random_range_offset();
    for step in 0..count {
        let index = (start + step) % count;
        let port = AIWORK_PORT_RANGE_START + u16::try_from(index).unwrap_or(0);
        if reserved_ports.contains(&port) {
            continue;
        }
        if bind_available_port(host, port) {
            return Ok(port);
        }
    }

    for _ in 0..32 {
        let listener = TcpListener::bind((host, 0)).map_err(|e| e.to_string())?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        if reserved_ports.contains(&port) {
            drop(listener);
            continue;
        }
        drop(listener);
        return Ok(port);
    }

    Err("Failed to find a free AiWork server port".to_string())
}

#[cfg(test)]
mod tests {
    use super::{resolve_aiwork_port, AIWORK_PORT_RANGE_END, AIWORK_PORT_RANGE_START};
    use std::collections::HashSet;
    use std::net::TcpListener;
    use std::time::Duration;

    #[test]
    fn uses_preferred_port_when_available() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind test listener");
        let port = listener.local_addr().expect("listener addr").port();
        drop(listener);

        let resolved = resolve_aiwork_port("127.0.0.1", Some(port), &HashSet::new())
            .expect("resolve preferred port");
        assert_eq!(resolved, port);
    }

    #[test]
    fn falls_back_to_ephemeral_port_when_preferred_port_is_unavailable() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind preferred port");
        let preferred_port = listener.local_addr().expect("listener addr").port();
        let resolved = resolve_aiwork_port("127.0.0.1", Some(preferred_port), &HashSet::new())
            .expect("resolve fallback port");
        assert_ne!(resolved, preferred_port);
        drop(listener);
    }

    #[test]
    fn uses_range_port_when_no_preference_exists() {
        let resolved =
            resolve_aiwork_port("127.0.0.1", None, &HashSet::new()).expect("resolve range port");
        assert!(resolved >= AIWORK_PORT_RANGE_START);
        assert!(resolved <= AIWORK_PORT_RANGE_END);
    }

    #[test]
    fn skips_reserved_ports_from_other_workspaces() {
        let reserved = HashSet::from([AIWORK_PORT_RANGE_START]);
        let resolved =
            resolve_aiwork_port("127.0.0.1", Some(AIWORK_PORT_RANGE_START), &reserved)
                .expect("resolve non-reserved port");
        assert_ne!(resolved, AIWORK_PORT_RANGE_START);
        assert!(resolved >= AIWORK_PORT_RANGE_START);
        assert!(resolved <= AIWORK_PORT_RANGE_END);
    }

    #[test]
    fn waits_briefly_to_reuse_preferred_port_during_restart() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind preferred port");
        let preferred_port = listener.local_addr().expect("listener addr").port();

        let release = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(150));
            drop(listener);
        });

        let resolved = resolve_aiwork_port("127.0.0.1", Some(preferred_port), &HashSet::new())
            .expect("resolve restarted preferred port");

        release.join().expect("join release thread");
        assert_eq!(resolved, preferred_port);
    }
}

pub fn build_aiwork_args(
    host: &str,
    port: u16,
    workspace_paths: &[String],
    opencode_base_url: Option<&str>,
    opencode_directory: Option<&str>,
) -> Vec<String> {
    let mut args = vec![
        "--host".to_string(),
        host.to_string(),
        "--port".to_string(),
        port.to_string(),
        // Always allow all origins since the AiWork server is designed to accept
        // remote connections from client devices (phones, laptops) which may use
        // different origins (localhost dev servers, tauri apps, web browsers).
        "--cors".to_string(),
        "*".to_string(),
        // Auto-approve write operations when running from the desktop app.
        // The user is already authenticated as host and in control of the UI.
        "--approval".to_string(),
        "auto".to_string(),
    ];

    for workspace_path in workspace_paths {
        if !workspace_path.trim().is_empty() {
            args.push("--workspace".to_string());
            args.push(workspace_path.to_string());
        }
    }

    if let Some(base_url) = opencode_base_url {
        if !base_url.trim().is_empty() {
            args.push("--opencode-base-url".to_string());
            args.push(base_url.to_string());
        }
    }

    if let Some(directory) = opencode_directory {
        if !directory.trim().is_empty() {
            args.push("--opencode-directory".to_string());
            args.push(directory.to_string());
        }
    }

    args
}

pub fn spawn_aiwork_server(
    app: &AppHandle,
    host: &str,
    port: u16,
    workspace_paths: &[String],
    token: &str,
    host_token: &str,
    opencode_base_url: Option<&str>,
    opencode_directory: Option<&str>,
    opencode_username: Option<&str>,
    opencode_password: Option<&str>,
    manage_opencode: bool,
    opencode_bin_path: Option<&str>,
) -> Result<(Receiver<CommandEvent>, CommandChild), String> {
    let command = match app.shell().sidecar("aiwork-server") {
        Ok(command) => command,
        Err(err) => {
            // In production builds we must use the bundled sidecar to ensure
            // API compatibility with the renderer. Falling back to a user-installed
            // `aiwork-server` binary can silently downgrade features (e.g.
            // missing workspace file APIs) and manifest as 404s in the UI.
            if cfg!(debug_assertions) {
                app.shell().command("aiwork-server")
            } else {
                return Err(format!(
                    "AiWork server sidecar is missing or failed to load: {err}"
                ));
            }
        }
    };

    let args = build_aiwork_args(
        host,
        port,
        workspace_paths,
        opencode_base_url,
        opencode_directory,
    );
    let cwd = workspace_paths
        .first()
        .map(|path| Path::new(path))
        .unwrap_or_else(|| Path::new("."));
    let cwd = resolve_process_working_dir(app, cwd, "aiwork-server")?;
    let mut command = command.args(args).current_dir(cwd);

    // User env first so it can never override AIWORK_TOKEN / credentials.
    for (key, value) in crate::env_file::load_user_env_file() {
        command = command.env(key, value);
    }

    command = command
        .env("AIWORK_TOKEN", token)
        .env("AIWORK_HOST_TOKEN", host_token);

    if manage_opencode {
        command = command.env("AIWORK_MANAGE_OPENCODE", "1");
        if let Some(path) = opencode_bin_path {
            if !path.trim().is_empty() {
                command = command.env("AIWORK_OPENCODE_BIN", path);
            }
        }
    }

    if let Some(username) = opencode_username {
        if !username.trim().is_empty() {
            command = command.env("AIWORK_OPENCODE_USERNAME", username);
        }
    }

    if let Some(password) = opencode_password {
        if !password.trim().is_empty() {
            command = command.env("AIWORK_OPENCODE_PASSWORD", password);
        }
    }

    for (key, value) in crate::bun_env::bun_env_overrides() {
        command = command.env(key, value);
    }

    if let Some(pairs) = aiwork_dev_isolated_env(app)? {
        for (key, value) in pairs {
            command = command.env(key, value);
        }
    }

    command
        .spawn()
        .map_err(|e| format!("Failed to start AiWork server: {e}"))
}
