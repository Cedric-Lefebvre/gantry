use serde_json::json;
use sysinfo::{Disks, System};
use std::sync::Mutex;
use std::sync::OnceLock;
use std::process::Command;

// Keep a persistent System instance for accurate CPU readings
static SYSTEM: OnceLock<Mutex<System>> = OnceLock::new();

fn get_system() -> &'static Mutex<System> {
  SYSTEM.get_or_init(|| {
    let mut sys = System::new_all();
    sys.refresh_all();
    Mutex::new(sys)
  })
}

#[tauri::command]
pub fn get_system_overview() -> Result<serde_json::Value, String> {
  let mut sys = get_system().lock().unwrap();
  sys.refresh_all();

  let cpus: Vec<_> = sys
    .cpus()
    .iter()
    .map(|p| json!({"name": p.name(), "usage": p.cpu_usage()}))
    .collect();

  let mem = json!({
    "total": sys.total_memory(),
    "used": sys.used_memory(),
    "swap_total": sys.total_swap(),
    "swap_used": sys.used_swap()
  });

  Ok(json!({"cpus": cpus, "memory": mem}))
}

fn get_gpu_info() -> serde_json::Value {
  // Try NVIDIA GPU first using nvidia-smi
  if let Ok(output) = Command::new("nvidia-smi")
    .args(["--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu", "--format=csv,noheader,nounits"])
    .output()
  {
    if output.status.success() {
      let stdout = String::from_utf8_lossy(&output.stdout);
      let mut gpus = Vec::new();

      for line in stdout.lines() {
        let parts: Vec<&str> = line.split(',').map(|s| s.trim()).collect();
        if parts.len() >= 5 {
          let name = parts[0].to_string();
          let usage: f32 = parts[1].parse().unwrap_or(0.0);
          let memory_used: u64 = parts[2].parse::<u64>().unwrap_or(0) * 1024 * 1024; // Convert MB to bytes
          let memory_total: u64 = parts[3].parse::<u64>().unwrap_or(0) * 1024 * 1024;
          let temperature: f32 = parts[4].parse().unwrap_or(0.0);

          gpus.push(json!({
            "name": name,
            "vendor": "NVIDIA",
            "usage": usage,
            "memory_used": memory_used,
            "memory_total": memory_total,
            "temperature": temperature,
          }));
        }
      }

      if !gpus.is_empty() {
        return json!(gpus);
      }
    }
  }

  // Try AMD GPU using rocm-smi
  if let Ok(output) = Command::new("rocm-smi")
    .args(["--showuse", "--showmemuse", "--showtemp", "--json"])
    .output()
  {
    if output.status.success() {
      let stdout = String::from_utf8_lossy(&output.stdout);
      if let Ok(data) = serde_json::from_str::<serde_json::Value>(&stdout) {
        if let Some(cards) = data.as_object() {
          let mut gpus = Vec::new();
          for (card_id, info) in cards {
            if card_id.starts_with("card") {
              let name = info.get("Card series").and_then(|v| v.as_str()).unwrap_or("AMD GPU").to_string();
              let usage: f32 = info.get("GPU use (%)").and_then(|v| v.as_str()).and_then(|s| s.parse().ok()).unwrap_or(0.0);
              let temp: f32 = info.get("Temperature (Sensor edge) (C)").and_then(|v| v.as_str()).and_then(|s| s.parse().ok()).unwrap_or(0.0);

              gpus.push(json!({
                "name": name,
                "vendor": "AMD",
                "usage": usage,
                "memory_used": 0,
                "memory_total": 0,
                "temperature": temp,
              }));
            }
          }
          if !gpus.is_empty() {
            return json!(gpus);
          }
        }
      }
    }
  }

  // Try Intel GPU using intel_gpu_top (requires root, so we'll skip actual usage)
  // Just detect if Intel GPU exists
  if let Ok(output) = Command::new("lspci").output() {
    if output.status.success() {
      let stdout = String::from_utf8_lossy(&output.stdout);
      for line in stdout.lines() {
        if line.contains("VGA") || line.contains("3D") || line.contains("Display") {
          if line.to_lowercase().contains("intel") {
            // Extract GPU name
            if let Some(name_start) = line.find(": ") {
              let name = line[name_start + 2..].to_string();
              return json!([{
                "name": name,
                "vendor": "Intel",
                "usage": null,
                "memory_used": null,
                "memory_total": null,
                "temperature": null,
              }]);
            }
          }
        }
      }
    }
  }

  json!(null)
}

#[tauri::command]
pub fn get_resources() -> Result<serde_json::Value, String> {
  let mut sys = get_system().lock().unwrap();
  sys.refresh_cpu_all();
  sys.refresh_memory();

  let cpu_total: f32 = sys.cpus().iter().map(|p| p.cpu_usage()).sum();
  let cpu_count = sys.cpus().len().max(1) as f32;
  let cpu = cpu_total / cpu_count;

  let memory = json!({
    "total": sys.total_memory(),
    "used": sys.used_memory(),
  });

  // Get disk information
  let disks = Disks::new_with_refreshed_list();
  let disk_info: Vec<_> = disks
    .iter()
    .filter(|d| d.total_space() > 0)
    .map(|d| json!({
      "name": d.name().to_string_lossy(),
      "mount_point": d.mount_point().to_string_lossy(),
      "total_space": d.total_space(),
      "available_space": d.available_space(),
    }))
    .collect();

  // Get GPU information
  let gpu = get_gpu_info();

  Ok(json!({"cpu": cpu, "memory": memory, "disks": disk_info, "gpu": gpu}))
}
