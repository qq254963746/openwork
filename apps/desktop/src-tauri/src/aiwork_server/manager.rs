use std::sync::{Arc, Mutex};

use tauri_plugin_shell::process::CommandChild;

use crate::types::AiWorkServerInfo;

#[derive(Default)]
pub struct AiWorkServerManager {
    pub inner: Arc<Mutex<AiWorkServerState>>,
}

#[derive(Default)]
pub struct AiWorkServerState {
    pub child: Option<CommandChild>,
    pub child_exited: bool,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub base_url: Option<String>,
    pub connect_url: Option<String>,
    pub mdns_url: Option<String>,
    pub lan_url: Option<String>,
    pub client_token: Option<String>,
    pub owner_token: Option<String>,
    pub host_token: Option<String>,
    pub managed_opencode_bin_path: Option<String>,
    pub managed_opencode_bin_source: Option<String>,
    pub last_stdout: Option<String>,
    pub last_stderr: Option<String>,
}

impl AiWorkServerManager {
    pub fn snapshot_locked(state: &mut AiWorkServerState) -> AiWorkServerInfo {
        let (running, pid) = match state.child.as_ref() {
            None => (false, None),
            Some(_child) if state.child_exited => {
                state.child = None;
                (false, None)
            }
            Some(child) => (true, Some(child.pid())),
        };

        AiWorkServerInfo {
            running,
            host: state.host.clone(),
            port: state.port,
            base_url: state.base_url.clone(),
            connect_url: state.connect_url.clone(),
            mdns_url: state.mdns_url.clone(),
            lan_url: state.lan_url.clone(),
            client_token: state.client_token.clone(),
            owner_token: state.owner_token.clone(),
            host_token: state.host_token.clone(),
            managed_opencode_bin_path: state.managed_opencode_bin_path.clone(),
            managed_opencode_bin_source: state.managed_opencode_bin_source.clone(),
            pid,
            last_stdout: state.last_stdout.clone(),
            last_stderr: state.last_stderr.clone(),
        }
    }

    pub fn stop_locked(state: &mut AiWorkServerState) {
        if let Some(child) = state.child.take() {
            let _ = child.kill();
        }
        state.child_exited = true;
        state.host = None;
        state.port = None;
        state.base_url = None;
        state.connect_url = None;
        state.mdns_url = None;
        state.lan_url = None;
        state.client_token = None;
        state.owner_token = None;
        state.host_token = None;
        state.managed_opencode_bin_path = None;
        state.managed_opencode_bin_source = None;
        state.last_stdout = None;
        state.last_stderr = None;
    }
}
