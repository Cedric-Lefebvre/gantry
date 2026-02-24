use chrono::Local;
use std::fs;
use std::io::Write;
use std::path::PathBuf;

fn log_file_path() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|h| h.join(".gantry").join("app.log"))
        .ok_or_else(|| "Could not find home directory".to_string())
}

#[tauri::command]
pub fn write_log(message: String) -> Result<String, String> {
    let log_file = log_file_path()?;

    if let Some(parent) = log_file.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create log dir: {}", e))?;
    }

    let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let log_entry = format!("[{}] {}\n", timestamp, message);

    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_file)
        .map_err(|e| format!("Failed to open log file: {}", e))?;

    file.write_all(log_entry.as_bytes())
        .map_err(|e| format!("Failed to write log: {}", e))?;

    Ok(log_file.to_string_lossy().to_string())
}

#[tauri::command]
pub fn read_log_file() -> Result<String, String> {
    let log_file = log_file_path()?;
    fs::read_to_string(&log_file)
        .map_err(|e| format!("Failed to read log file: {}", e))
}

#[tauri::command]
pub fn clear_log_file() -> Result<String, String> {
    let log_file = log_file_path()?;
    fs::write(&log_file, "")
        .map_err(|e| format!("Failed to clear log file: {}", e))?;
    Ok(log_file.to_string_lossy().to_string())
}
