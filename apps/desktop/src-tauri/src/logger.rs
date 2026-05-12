use std::env;
use std::fmt::Display;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[allow(dead_code)]
pub enum LogLevel {
    Error = 0,
    Warn = 1,
    Info = 2,
    Debug = 3,
}

impl LogLevel {
    fn label(&self) -> &'static str {
        match self {
            LogLevel::Error => "ERROR",
            LogLevel::Warn => "WARN",
            LogLevel::Info => "INFO",
            LogLevel::Debug => "DEBUG",
        }
    }
}

fn is_dev_mode() -> bool {
    env::var("AIWORK_DEV_MODE").ok().as_deref() == Some("1")
}

fn effective_max_level() -> LogLevel {
    if is_dev_mode() {
        LogLevel::Debug
    } else {
        LogLevel::Info
    }
}

fn format_message(level: LogLevel, target: &str, msg: &str) -> String {
    use std::fmt::Write;
    let now = chrono_or_system();
    let mut out = String::new();
    let _ = write!(&mut out, "[{now}] [{label}] [{target}] {msg}", label = level.label());
    out
}

fn chrono_or_system() -> String {
    // Prefer chrono-style readable timestamp, fall back to ms since epoch.
    if let Ok(now) = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) {
        let secs = now.as_secs();
        // Simple readable format: HH:MM:SS
        let hours = (secs % 86400) / 3600;
        let minutes = (secs % 3600) / 60;
        let seconds = secs % 60;
        let millis = now.subsec_millis();
        return format!("{hours:02}:{minutes:02}:{seconds:02}.{millis:03}");
    }
    "??:??:??.???".to_string()
}

pub fn log(level: LogLevel, target: &str, args: impl Display) {
    if level <= effective_max_level() {
        let msg = format_message(level, target, &args.to_string());
        eprintln!("{msg}");
    }
}

/// Log an error message. Always printed regardless of log level.
#[macro_export]
macro_rules! log_error {
    ($target:expr, $($arg:tt)*) => {
        $crate::logger::log($crate::logger::LogLevel::Error, $target, format_args!($($arg)*))
    };
}

/// Log a warning message. Printed at WARN level and above.
#[macro_export]
macro_rules! log_warn {
    ($target:expr, $($arg:tt)*) => {
        $crate::logger::log($crate::logger::LogLevel::Warn, $target, format_args!($($arg)*))
    };
}

/// Log an info message. Printed at INFO level and above (default).
#[macro_export]
macro_rules! log_info {
    ($target:expr, $($arg:tt)*) => {
        $crate::logger::log($crate::logger::LogLevel::Info, $target, format_args!($($arg)*))
    };
}

/// Log a debug message. Only printed when AIWORK_DEV_MODE=1
/// (i.e. `pnpm --filter @aiwork/desktop dev:tauri`).
#[macro_export]
macro_rules! log_debug {
    ($target:expr, $($arg:tt)*) => {
        $crate::logger::log($crate::logger::LogLevel::Debug, $target, format_args!($($arg)*))
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_log_level_ordering() {
        assert!(LogLevel::Error < LogLevel::Warn);
        assert!(LogLevel::Warn < LogLevel::Info);
        assert!(LogLevel::Info < LogLevel::Debug);
    }
}