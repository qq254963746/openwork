//! Bridge shell inspector events from the `main` webview to the detached `app-log` webview.
//! The log window does not share JS heap / `window.opener` with the main shell (see `open_app_log_window`).
//!
//! Commands must be **async** with `tokio::time::timeout` — sync `mpsc::recv_timeout` blocked the runtime
//! and prevented the main webview from handling `emit_to`, causing a deadlock (white screen / hang).

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State, WebviewWindow};
use tokio::sync::oneshot;

pub struct ShellEventsBridge {
    pull_tx: Mutex<Option<oneshot::Sender<String>>>,
    clear_tx: Mutex<Option<oneshot::Sender<()>>>,
}

impl Default for ShellEventsBridge {
    fn default() -> Self {
        Self {
            pull_tx: Mutex::new(None),
            clear_tx: Mutex::new(None),
        }
    }
}

const EVENT_SHELL_EVENTS_REQUEST: &str = "openwork-shell-events-request";
const EVENT_SHELL_CLEAR_REQUEST: &str = "openwork-shell-clear-request";

#[derive(Clone, Serialize)]
struct ShellEventsRequestPayload {
    limit: u32,
}

#[tauri::command]
pub async fn pull_shell_events_from_main(
    app: AppHandle,
    state: State<'_, ShellEventsBridge>,
    limit: u32,
) -> Result<String, String> {
    let (tx, rx) = oneshot::channel::<String>();
    {
        let mut g = state.pull_tx.lock().map_err(|e| e.to_string())?;
        if g.is_some() {
            return Err("shell_events_pull_busy".into());
        }
        *g = Some(tx);
    }

    app.emit_to(
        "main",
        EVENT_SHELL_EVENTS_REQUEST,
        ShellEventsRequestPayload { limit },
    )
    .map_err(|e| e.to_string())?;

    match tokio::time::timeout(Duration::from_secs(3), rx).await {
        Ok(Ok(json)) => Ok(json),
        Ok(Err(_)) => {
            let mut g = state.pull_tx.lock().map_err(|e| e.to_string())?;
            *g = None;
            Err("shell_events_reply_dropped".into())
        }
        Err(_) => {
            let mut g = state.pull_tx.lock().map_err(|e| e.to_string())?;
            *g = None;
            Err("shell_events_pull_timeout".into())
        }
    }
}

#[tauri::command]
pub fn shell_events_bridge_reply(
    window: WebviewWindow,
    state: State<'_, ShellEventsBridge>,
    events_json: String,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("shell_events_reply_wrong_window".into());
    }
    let mut g = state.pull_tx.lock().map_err(|e| e.to_string())?;
    if let Some(tx) = g.take() {
        let _ = tx.send(events_json);
    }
    Ok(())
}

#[tauri::command]
pub async fn request_clear_main_shell_events(
    app: AppHandle,
    state: State<'_, ShellEventsBridge>,
) -> Result<(), String> {
    let (tx, rx) = oneshot::channel::<()>();
    {
        let mut g = state.clear_tx.lock().map_err(|e| e.to_string())?;
        if g.is_some() {
            return Err("shell_events_clear_busy".into());
        }
        *g = Some(tx);
    }

    app.emit_to("main", EVENT_SHELL_CLEAR_REQUEST, ())
        .map_err(|e| e.to_string())?;

    match tokio::time::timeout(Duration::from_secs(3), rx).await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(_)) => {
            let mut g = state.clear_tx.lock().map_err(|e| e.to_string())?;
            *g = None;
            Err("shell_events_clear_ack_dropped".into())
        }
        Err(_) => {
            let mut g = state.clear_tx.lock().map_err(|e| e.to_string())?;
            *g = None;
            Err("shell_events_clear_timeout".into())
        }
    }
}

#[tauri::command]
pub fn shell_events_clear_bridge_ack(
    window: WebviewWindow,
    state: State<'_, ShellEventsBridge>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("shell_events_clear_ack_wrong_window".into());
    }
    let mut g = state.clear_tx.lock().map_err(|e| e.to_string())?;
    if let Some(tx) = g.take() {
        let _ = tx.send(());
    }
    Ok(())
}
