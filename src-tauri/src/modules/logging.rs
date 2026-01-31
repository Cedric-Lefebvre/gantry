use std::fs;
use std::io::Write;

#[tauri::command]
pub fn write_log(message: String) -> Result<String, String> {
  use chrono::Local;

  let log_dir = dirs::home_dir()
    .map(|h| h.join(".gantry"))
    .ok_or("Could not find home directory")?;

  // Create .gantry directory if it doesn't exist
  fs::create_dir_all(&log_dir).map_err(|e| format!("Failed to create log dir: {}", e))?;

  let log_file = log_dir.join("app.log");
  let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
  let log_entry = format!("[{}] {}\n", timestamp, message);

  let mut file = fs::OpenOptions::new()
    .create(true)
    .append(true)
    .open(&log_file)
    .map_err(|e| format!("Failed to open log file: {}", e))?;

  file.write_all(log_entry.as_bytes())
    .map_err(|e| format!("Failed to write log: {}", e))?;

  Ok(format!("Logged to: {:?}", log_file))
}

#[tauri::command]
pub fn read_log_file() -> Result<String, String> {
  let log_dir = dirs::home_dir()
    .map(|h| h.join(".gantry"))
    .ok_or("Could not find home directory")?;

  let log_file = log_dir.join("app.log");

  fs::read_to_string(&log_file)
    .map_err(|e| format!("Failed to read log file: {}", e))
}

#[tauri::command]
pub fn clear_log_file() -> Result<String, String> {
  let log_dir = dirs::home_dir()
    .map(|h| h.join(".gantry"))
    .ok_or("Could not find home directory")?;

  let log_file = log_dir.join("app.log");

  fs::write(&log_file, "")
    .map_err(|e| format!("Failed to clear log file: {}", e))?;

  Ok(format!("Cleared: {:?}", log_file))
}
