//! Desktop integrations that must work under strict Release IPC / WebView policies:
//! - detached log viewer window (avoid relying on `window.open`)
//! - open / reveal paths via OS tooling (avoid frontend opener edge cases)

use std::path::Path;
use std::process::Command;

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const APP_LOG_WINDOW_LABEL: &str = "app-log";
const APP_LOG_VIEWER_QUERY_KEY: &str = "aiworkLogViewer";

fn run_command_ok(cmd: &mut Command, label: &'static str) -> Result<(), String> {
    let status = cmd.status().map_err(|e| format!("{label}: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("{label} exited with {status}"))
    }
}

#[tauri::command]
pub fn open_app_log_window(app: AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(APP_LOG_WINDOW_LABEL) {
        let _ = existing.show();
        let _ = existing.unminimize();
        return existing.set_focus().map_err(|e| e.to_string());
    }

    let Some(main) = app.get_webview_window("main") else {
        return Err("main window missing".into());
    };

    let mut url = main.url().map_err(|e| e.to_string())?;
    url.set_query(Some(&format!("{APP_LOG_VIEWER_QUERY_KEY}=1")));
    url.set_fragment(Some("/devtools/app-log"));

    WebviewWindowBuilder::new(&app, APP_LOG_WINDOW_LABEL, WebviewUrl::External(url))
        .title("AiWork — Logs")
        .inner_size(980.0, 760.0)
        .min_inner_size(520.0, 380.0)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn ensure_dir_exist(path: String) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("empty path".into());
    }

    let p = Path::new(trimmed);
    if !p.exists() {
        std::fs::create_dir_all(p).map_err(|e| format!("Failed to create directory: {e}"))?;
    }

    Ok(())
}

#[tauri::command]
pub fn host_open_path_native(path: String) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("empty path".into());
    }

    let p = Path::new(trimmed);
    if !p.exists() {
        return Err(format!("path does not exist: {trimmed}"));
    }

    #[cfg(target_os = "macos")]
    {
        let mut cmd = Command::new("open");
        cmd.arg(trimmed);
        run_command_ok(&mut cmd, "open")
    }

    #[cfg(target_os = "windows")]
    {
        if p.is_dir() {
            let mut cmd = Command::new("explorer");
            cmd.arg(trimmed);
            run_command_ok(&mut cmd, "explorer")
        } else {
            let mut cmd = Command::new("cmd");
            cmd.args(["/C", "start", "", trimmed]);
            run_command_ok(&mut cmd, "start")
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let mut cmd = Command::new("xdg-open");
        cmd.arg(trimmed);
        run_command_ok(&mut cmd, "xdg-open")
    }
}

#[tauri::command]
pub fn host_reveal_path_native(path: String) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("empty path".into());
    }

    let p = Path::new(trimmed);
    if !p.exists() {
        return Err(format!("path does not exist: {trimmed}"));
    }

    #[cfg(target_os = "macos")]
    {
        let mut cmd = Command::new("open");
        if p.is_dir() {
            cmd.arg(trimmed);
            run_command_ok(&mut cmd, "open")
        } else {
            cmd.args(["-R", trimmed]);
            run_command_ok(&mut cmd, "open -R")
        }
    }

    #[cfg(target_os = "windows")]
    {
        if p.is_dir() {
            let mut cmd = Command::new("explorer");
            cmd.arg(trimmed);
            run_command_ok(&mut cmd, "explorer")
        } else {
            let abs = std::fs::canonicalize(p).map_err(|e| e.to_string())?;
            let abs_str = abs.to_string_lossy();
            let mut cmd = Command::new("explorer");
            cmd.arg(format!("/select,{abs_str}"));
            run_command_ok(&mut cmd, "explorer /select")
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let parent = p
            .parent()
            .filter(|d| !d.as_os_str().is_empty())
            .unwrap_or(p);
        let mut cmd = Command::new("xdg-open");
        cmd.arg(parent.as_os_str());
        run_command_ok(&mut cmd, "xdg-open")
    }
}
