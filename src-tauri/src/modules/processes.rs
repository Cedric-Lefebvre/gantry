use sysinfo::System;

#[tauri::command]
pub fn list_processes() -> Result<serde_json::Value, String> {
  let mut sys = System::new_all();
  sys.refresh_all();
  
  let mut procs = Vec::new();
  for (_, process) in sys.processes() {
    let cpu_usage = process.cpu_usage() as f64;
    let cpu_value = if cpu_usage.is_finite() {
      serde_json::Number::from_f64(cpu_usage).unwrap_or(serde_json::Number::from(0))
    } else {
      serde_json::Number::from(0)
    };

    let mut obj = serde_json::Map::new();
    obj.insert("pid".to_string(), serde_json::Value::Number(process.pid().as_u32().into()));
    obj.insert("name".to_string(), serde_json::Value::String(process.name().to_string_lossy().to_string()));
    obj.insert("cpu".to_string(), serde_json::Value::Number(cpu_value));
    obj.insert("memory".to_string(), serde_json::Value::Number(process.memory().into()));
    obj.insert("status".to_string(), serde_json::Value::String(format!("{:?}", process.status())));

    procs.push(serde_json::Value::Object(obj));
  }
  
  Ok(serde_json::Value::Array(procs))
}

#[tauri::command]
pub fn kill_process(pid: u32) -> Result<String, String> {
  use std::process::Command;
  let output = Command::new("kill")
    .arg("-9")
    .arg(pid.to_string())
    .output()
    .map_err(|e| format!("Failed to kill process: {}", e))?;
  
  if output.status.success() {
    Ok(format!("Process {} terminated", pid))
  } else {
    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(format!("Failed to kill process {}: {}", pid, stderr))
  }
}
