//! Desktop integration for spawning a detached local orchestrator worker (host-only).

use serde::Serialize;
use serde_json::{json, Value};
use std::net::TcpListener;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tauri::Emitter;
use tauri_plugin_shell::ShellExt;
use uuid::Uuid;

const DETACHED_PROGRESS_EVENT: &str = "aiwork://orchestrator-detached-progress";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestratorDetachedHost {
    pub aiwork_url: String,
    pub token: String,
    pub owner_token: Option<String>,
    pub host_token: String,
    pub port: u16,
}

fn issue_owner_token(aiwork_url: &str, host_token: &str) -> Result<String, String> {
    let response = ureq::post(&format!("{}/tokens", aiwork_url.trim_end_matches('/')))
        .set("X-AiWork-Host-Token", host_token)
        .set("Content-Type", "application/json")
        .send_string(r#"{"scope":"owner","label":"AiWork detached owner token"}"#)
        .map_err(|err| err.to_string())?;

    let payload: Value = response
        .into_json()
        .map_err(|err| format!("Failed to parse owner token response: {err}"))?;

    payload
        .get("token")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "AiWork server did not return an owner token".to_string())
}

fn allocate_free_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to allocate free port: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to read allocated port: {e}"))?
        .port();
    Ok(port)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn emit_detached_progress(
    app: &AppHandle,
    run_id: &str,
    stage: &str,
    message: &str,
    payload: serde_json::Value,
) {
    let at = now_ms();
    eprintln!(
        "[orchestrator-detached][at={at}][runId={run_id}][stage={stage}] {message}"
    );
    let event_payload = json!({
        "runId": run_id,
        "stage": stage,
        "message": message,
        "at": at,
        "payload": payload,
    });
    let _ = app.emit(DETACHED_PROGRESS_EVENT, event_payload);
}

#[tauri::command]
pub fn orchestrator_start_detached(
    app: AppHandle,
    workspace_path: String,
    run_id: Option<String>,
    aiwork_token: Option<String>,
    aiwork_host_token: Option<String>,
) -> Result<OrchestratorDetachedHost, String> {
    let workspace_path = workspace_path.trim().to_string();
    if workspace_path.is_empty() {
        return Err("workspacePath is required".to_string());
    }

    let run_id = run_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let port = allocate_free_port()?;
    let token = aiwork_token
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let host_token = aiwork_host_token
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let aiwork_url = format!("http://127.0.0.1:{port}");

    emit_detached_progress(
        &app,
        &run_id,
        "init",
        "Starting detached worker...",
        json!({
            "workspacePath": workspace_path,
            "aiworkUrl": aiwork_url,
            "port": port,
        }),
    );

    let (command, command_label) = match app.shell().sidecar("aiwork-orchestrator") {
        Ok(command) => (command, "sidecar:aiwork-orchestrator".to_string()),
        Err(_) => (app.shell().command("aiwork"), "path:aiwork".to_string()),
    };

    let args: Vec<String> = vec![
        "start".to_string(),
        "--workspace".to_string(),
        workspace_path.clone(),
        "--approval".to_string(),
        "auto".to_string(),
        "--detach".to_string(),
        "--aiwork-port".to_string(),
        port.to_string(),
        "--run-id".to_string(),
        run_id.clone(),
    ];

    let str_args: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

    emit_detached_progress(
        &app,
        &run_id,
        "spawn.config",
        "Launching orchestrator...",
        json!({
            "command": command_label,
            "workspacePath": workspace_path,
            "aiworkUrl": aiwork_url,
            "argCount": args.len(),
        }),
    );

    let mut command = command.args(str_args);
    for (key, value) in crate::env_file::load_user_env_file() {
        command = command.env(key, value);
    }
    if let Err(err) = command
        .env("AIWORK_TOKEN", token.clone())
        .env("AIWORK_HOST_TOKEN", host_token.clone())
        .spawn()
    {
        emit_detached_progress(
            &app,
            &run_id,
            "spawn.error",
            "Failed to launch orchestrator.",
            json!({
                "error": err.to_string(),
                "command": command_label,
            }),
        );
        return Err(format!("Failed to start aiwork orchestrator: {err}"));
    }

    emit_detached_progress(
        &app,
        &run_id,
        "spawned",
        "Waiting for AiWork server...",
        json!({ "aiworkUrl": aiwork_url }),
    );

    let health_timeout_ms = 12_000u64;
    let start = Instant::now();
    let mut last_tick = Instant::now() - Duration::from_secs(5);
    let mut last_error: Option<String> = None;

    while start.elapsed() < Duration::from_millis(health_timeout_ms) {
        let elapsed_ms = start.elapsed().as_millis() as u64;

        match ureq::get(&format!("{}/health", aiwork_url.trim_end_matches('/'))).call() {
            Ok(response) if response.status() >= 200 && response.status() < 300 => {
                emit_detached_progress(
                    &app,
                    &run_id,
                    "aiwork.healthy",
                    "AiWork server is ready.",
                    json!({
                        "aiworkUrl": aiwork_url,
                        "elapsedMs": elapsed_ms,
                    }),
                );
                last_error = None;
                break;
            }
            Ok(response) => {
                last_error = Some(format!("HTTP {}", response.status()));
            }
            Err(err) => {
                last_error = Some(err.to_string());
            }
        }

        if last_tick.elapsed() > Duration::from_millis(850) {
            last_tick = Instant::now();
            emit_detached_progress(
                &app,
                &run_id,
                "aiwork.waiting",
                "Waiting for AiWork server...",
                json!({
                    "aiworkUrl": aiwork_url,
                    "elapsedMs": elapsed_ms,
                    "lastError": last_error,
                }),
            );
        }

        std::thread::sleep(Duration::from_millis(200));
    }

    if start.elapsed() >= Duration::from_millis(health_timeout_ms) {
        let elapsed_ms = start.elapsed().as_millis() as u64;
        let message = format!(
            "Timed out waiting for AiWork server (elapsed_ms={elapsed_ms}, url={aiwork_url}, last_error={})",
            last_error.unwrap_or_else(|| "none".to_string())
        );
        emit_detached_progress(
            &app,
            &run_id,
            "error",
            "Detached worker failed to start.",
            json!({
                "error": message,
                "elapsedMs": elapsed_ms,
                "aiworkUrl": aiwork_url,
            }),
        );
        return Err(message);
    }

    let owner_token = issue_owner_token(&aiwork_url, &host_token).ok();

    Ok(OrchestratorDetachedHost {
        aiwork_url,
        token,
        owner_token,
        host_token,
        port,
    })
}
