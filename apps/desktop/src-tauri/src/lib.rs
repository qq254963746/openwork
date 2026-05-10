mod bun_env;
mod commands;
mod config;
mod desktop_bootstrap;
mod engine;
mod env_file;
mod fs;
mod aiwork_server;
mod orchestrator;
mod paths;
mod platform;
mod types;
mod utils;
mod workspace;

pub use types::*;

use commands::command_files::{
    opencode_command_delete, opencode_command_list, opencode_command_write,
};
use commands::config::{read_opencode_auth_json, read_opencode_config, write_opencode_config};
use commands::desktop_bootstrap::{get_desktop_bootstrap_config, set_desktop_bootstrap_config};
use commands::engine::{
    engine_doctor, engine_info, engine_install, engine_restart, engine_start, engine_stop,
};
use commands::migration::{migrate_to_electron, write_migration_snapshot};
use commands::misc::{
    app_build_info, desktop_app_paths, nuke_aiwork_and_opencode_config_and_exit, opencode_mcp_auth,
    read_opencode_engine_disk_logs, reset_opencode_cache, reset_aiwork_state,
};
use commands::aiwork_server::{aiwork_server_info, aiwork_server_restart};
use commands::orchestrator::{
    orchestrator_start_detached, sandbox_cleanup_aiwork_containers, sandbox_debug_probe,
    sandbox_doctor, sandbox_stop,
};
use commands::skills::{
    import_skill, install_skill_template, list_local_skills, read_local_skill, uninstall_skill,
    write_local_skill,
};
use commands::host_desktop::{host_open_path_native, host_reveal_path_native, open_app_log_window};
use commands::shell_events_bridge::{
    pull_shell_events_from_main, request_clear_main_shell_events, shell_events_bridge_reply,
    shell_events_clear_bridge_ack, ShellEventsBridge,
};
use commands::window::set_window_decorations;
use commands::workspace::{
    workspace_add_authorized_root, workspace_bootstrap, workspace_create, workspace_create_remote,
    workspace_export_config, workspace_forget, workspace_import_config, workspace_aiwork_read,
    workspace_aiwork_write, workspace_reorder, workspace_set_active, workspace_set_runtime_active,
    workspace_set_selected, workspace_update_display_name, workspace_update_remote,
};
use engine::manager::EngineManager;
use aiwork_server::manager::AiWorkServerManager;
use orchestrator::manager::OrchestratorManager;
use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent};
use workspace::watch::WorkspaceWatchState;

const NATIVE_DEEP_LINK_EVENT: &str = "aiwork:deep-link-native";

#[cfg(target_os = "macos")]
fn set_dev_app_name() {
    if std::env::var("AIWORK_DEV_MODE").ok().as_deref() != Some("1") {
        return;
    }

    let Some(_mtm) = objc2::MainThreadMarker::new() else {
        return;
    };

    objc2_foundation::NSProcessInfo::processInfo()
        .setProcessName(&objc2_foundation::NSString::from_str("AiWork - Dev"));
}

#[cfg(not(target_os = "macos"))]
fn set_dev_app_name() {}

fn forwarded_deep_links(args: &[String]) -> Vec<String> {
    args.iter()
        .skip(1)
        .filter_map(|arg| {
            let trimmed = arg.trim();
            if trimmed.starts_with("aiwork://")
                || trimmed.starts_with("aiwork-dev://")
                || trimmed.starts_with("https://")
                || trimmed.starts_with("http://")
            {
                Some(trimmed.to_string())
            } else {
                None
            }
        })
        .collect()
}

fn emit_native_deep_links(app_handle: &AppHandle, urls: Vec<String>) {
    if urls.is_empty() {
        return;
    }

    let _ = app_handle.emit(NATIVE_DEEP_LINK_EVENT, urls);
}

fn emit_forwarded_deep_links(app_handle: &AppHandle, args: &[String]) {
    let urls = forwarded_deep_links(args);
    emit_native_deep_links(app_handle, urls);
}

fn show_main_window(app_handle: &AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn stop_managed_services(app_handle: &tauri::AppHandle) {
    if let Ok(mut engine) = app_handle.state::<EngineManager>().inner.lock() {
        EngineManager::stop_locked(&mut engine);
    }
    if let Ok(mut orchestrator) = app_handle.state::<OrchestratorManager>().inner.lock() {
        OrchestratorManager::stop_locked(&mut orchestrator);
    }
    if let Ok(mut aiwork_server) = app_handle.state::<AiWorkServerManager>().inner.lock() {
        AiWorkServerManager::stop_locked(&mut aiwork_server);
    }
}

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            show_main_window(app);
            emit_forwarded_deep_links(app, &args);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init());

    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init());

    let app = builder
        .setup(|_| {
            set_dev_app_name();
            Ok(())
        })
        .manage(EngineManager::default())
        .manage(OrchestratorManager::default())
        .manage(AiWorkServerManager::default())
        .manage(WorkspaceWatchState::default())
        .manage(ShellEventsBridge::default())
        .invoke_handler(tauri::generate_handler![
            engine_start,
            engine_stop,
            engine_info,
            engine_doctor,
            engine_install,
            engine_restart,
            orchestrator_start_detached,
            sandbox_doctor,
            sandbox_debug_probe,
            sandbox_stop,
            sandbox_cleanup_aiwork_containers,
            aiwork_server_info,
            aiwork_server_restart,
            workspace_bootstrap,
            workspace_reorder,
            workspace_set_selected,
            workspace_set_runtime_active,
            workspace_set_active,
            workspace_create,
            workspace_create_remote,
            workspace_update_display_name,
            workspace_update_remote,
            workspace_forget,
            workspace_add_authorized_root,
            workspace_export_config,
            workspace_import_config,
            opencode_command_list,
            opencode_command_write,
            opencode_command_delete,
            workspace_aiwork_read,
            workspace_aiwork_write,
            import_skill,
            install_skill_template,
            list_local_skills,
            read_local_skill,
            uninstall_skill,
            write_local_skill,
            read_opencode_config,
            read_opencode_auth_json,
            write_opencode_config,
            get_desktop_bootstrap_config,
            set_desktop_bootstrap_config,
            desktop_app_paths,
            migrate_to_electron,
            write_migration_snapshot,
            app_build_info,
            nuke_aiwork_and_opencode_config_and_exit,
            reset_aiwork_state,
            reset_opencode_cache,
            read_opencode_engine_disk_logs,
            opencode_mcp_auth,
            set_window_decorations,
            open_app_log_window,
            host_open_path_native,
            host_reveal_path_native,
            pull_shell_events_from_main,
            shell_events_bridge_reply,
            request_clear_main_shell_events,
            shell_events_clear_bridge_ack
        ])
        .build(tauri::generate_context!())
        .expect("error while building AiWork");

    // Best-effort cleanup on app exit. Without this, background sidecars can keep
    // running after the UI quits (especially during dev), leading to stale ports.
    app.run(|app_handle, event| match event {
        RunEvent::ExitRequested { .. } | RunEvent::Exit => stop_managed_services(&app_handle),
        // On macOS the default behavior is to keep the process alive after the
        // last window closes. We want parity with Windows/Linux: closing the
        // main window quits the app.
        #[cfg(target_os = "macos")]
        RunEvent::WindowEvent {
            label,
            event: WindowEvent::CloseRequested { .. },
            ..
        } if label == "main" => {
            app_handle.exit(0);
        }
        #[cfg(target_os = "macos")]
        RunEvent::Opened { urls } => {
            let urls = urls
                .into_iter()
                .map(|url| url.to_string())
                .collect::<Vec<_>>();
            show_main_window(&app_handle);
            emit_native_deep_links(&app_handle, urls);
        }
        // Always raise/refocus the main window on dock-icon clicks, even if
        // it's already visible but behind other apps or on another Space.
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => {
            show_main_window(&app_handle);
        }
        _ => {}
    });
}
