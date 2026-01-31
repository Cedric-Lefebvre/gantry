use serde_json::json;
use std::process::Command;

#[tauri::command]
pub fn list_devices() -> Result<serde_json::Value, String> {
  // Use lsblk -J for a JSON output when available
  match Command::new("lsblk")
    .args(["-J", "-o", "NAME,SIZE,TYPE,MOUNTPOINT,MODEL,VENDOR"])
    .output()
  {
    Ok(out) => {
      if out.status.success() {
        let output = String::from_utf8_lossy(&out.stdout);
        match serde_json::from_str::<serde_json::Value>(&output) {
          Ok(v) => Ok(v),
          Err(_) => Ok(json!({"raw": output})),
        }
      } else {
        Err(format!("lsblk failed: {}", String::from_utf8_lossy(&out.stderr)))
      }
    }
    Err(e) => Err(format!("failed to run lsblk: {}", e)),
  }
}

#[tauri::command]
pub fn list_usb_devices() -> Result<Vec<serde_json::Value>, String> {
  match Command::new("lsusb").output() {
    Ok(out) => {
      let output = String::from_utf8_lossy(&out.stdout);
      let devices: Vec<_> = output
        .lines()
        .map(|line| json!({"type": "USB", "info": line.to_string()}))
        .collect();
      Ok(devices)
    }
    Err(_) => Ok(vec![]),
  }
}

#[tauri::command]
pub fn list_network_devices() -> Result<Vec<serde_json::Value>, String> {
  match Command::new("ip").args(["link", "show"]).output() {
    Ok(out) => {
      let output = String::from_utf8_lossy(&out.stdout);
      let mut devices = Vec::new();
      
      for line in output.lines() {
        if line.contains(':') && !line.starts_with(' ') {
          let parts: Vec<&str> = line.split(':').collect();
          if parts.len() > 1 {
            let name = parts[1].trim();
            devices.push(json!({
              "type": "Network",
              "name": name,
              "info": line.to_string()
            }));
          }
        }
      }
      Ok(devices)
    }
    Err(_) => Ok(vec![]),
  }
}

#[tauri::command]
pub fn list_pci_devices() -> Result<Vec<serde_json::Value>, String> {
  match Command::new("lspci").output() {
    Ok(out) => {
      let output = String::from_utf8_lossy(&out.stdout);
      let devices: Vec<_> = output
        .lines()
        .filter(|line| {
          line.to_lowercase().contains("bluetooth")
            || line.to_lowercase().contains("network")
            || line.to_lowercase().contains("ethernet")
            || line.to_lowercase().contains("wireless")
        })
        .map(|line| json!({"type": "PCI", "info": line.to_string()}))
        .collect();
      Ok(devices)
    }
    Err(_) => Ok(vec![]),
  }
}
