use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AptRepository {
  pub id: String,
  pub file_path: String,
  pub line_number: usize,
  pub types: String,
  pub uris: String,
  pub suites: String,
  pub components: String,
  pub enabled: bool,
  pub original_line: String,
}

fn parse_sources_file(path: &PathBuf) -> Vec<AptRepository> {
  let mut repos = Vec::new();
  let content = match fs::read_to_string(path) {
    Ok(c) => c,
    Err(_) => return repos,
  };

  let file_path = path.to_string_lossy().to_string();

  // Check if this is a DEB822 format file (.sources)
  if path.extension().map_or(false, |ext| ext == "sources") {
    // Parse DEB822 format
    let mut current_enabled = true;
    let mut current_types = String::new();
    let mut current_uris = String::new();
    let mut current_suites = String::new();
    let mut current_components = String::new();
    let mut start_line = 0;

    for (idx, line) in content.lines().enumerate() {
      let line_trimmed = line.trim();

      if line_trimmed.is_empty() {
        // End of a stanza - save if we have data
        if !current_uris.is_empty() {
          repos.push(AptRepository {
            id: format!("{}:{}", file_path, start_line),
            file_path: file_path.clone(),
            line_number: start_line,
            types: current_types.clone(),
            uris: current_uris.clone(),
            suites: current_suites.clone(),
            components: current_components.clone(),
            enabled: current_enabled,
            original_line: format!("{} {} {} {}", current_types, current_uris, current_suites, current_components),
          });
        }
        // Reset for next stanza
        current_enabled = true;
        current_types = String::new();
        current_uris = String::new();
        current_suites = String::new();
        current_components = String::new();
        start_line = idx + 1;
        continue;
      }

      if line_trimmed.starts_with("Enabled:") {
        let value = line_trimmed.trim_start_matches("Enabled:").trim().to_lowercase();
        current_enabled = value == "yes" || value == "true";
      } else if line_trimmed.starts_with("Types:") {
        current_types = line_trimmed.trim_start_matches("Types:").trim().to_string();
        if start_line == 0 || current_uris.is_empty() {
          start_line = idx;
        }
      } else if line_trimmed.starts_with("URIs:") {
        current_uris = line_trimmed.trim_start_matches("URIs:").trim().to_string();
      } else if line_trimmed.starts_with("Suites:") {
        current_suites = line_trimmed.trim_start_matches("Suites:").trim().to_string();
      } else if line_trimmed.starts_with("Components:") {
        current_components = line_trimmed.trim_start_matches("Components:").trim().to_string();
      }
    }

    // Don't forget the last stanza
    if !current_uris.is_empty() {
      repos.push(AptRepository {
        id: format!("{}:{}", file_path, start_line),
        file_path: file_path.clone(),
        line_number: start_line,
        types: current_types,
        uris: current_uris,
        suites: current_suites,
        components: current_components,
        enabled: current_enabled,
        original_line: String::new(),
      });
    }
  } else {
    // Parse traditional sources.list format
    for (idx, line) in content.lines().enumerate() {
      let line_trimmed = line.trim();

      // Skip empty lines
      if line_trimmed.is_empty() {
        continue;
      }

      // Check if line is commented (disabled)
      let (is_enabled, effective_line) = if line_trimmed.starts_with('#') {
        let uncommented = line_trimmed.trim_start_matches('#').trim();
        if uncommented.starts_with("deb") {
          (false, uncommented.to_string())
        } else {
          continue; // Not a repo line, just a comment
        }
      } else if line_trimmed.starts_with("deb") {
        (true, line_trimmed.to_string())
      } else {
        continue;
      };

      let parts: Vec<&str> = effective_line.split_whitespace().collect();
      if parts.len() >= 3 {
        let types = parts[0].to_string();
        let uris = parts[1].to_string();
        let suites = parts[2].to_string();
        let components = if parts.len() > 3 {
          parts[3..].join(" ")
        } else {
          String::new()
        };

        repos.push(AptRepository {
          id: format!("{}:{}", file_path, idx),
          file_path: file_path.clone(),
          line_number: idx,
          types,
          uris,
          suites,
          components,
          enabled: is_enabled,
          original_line: line.to_string(),
        });
      }
    }
  }

  repos
}

#[tauri::command]
pub fn list_apt_repos() -> Result<serde_json::Value, String> {
  let mut all_repos: Vec<AptRepository> = Vec::new();

  // Parse /etc/apt/sources.list
  let base = PathBuf::from("/etc/apt/sources.list");
  if base.exists() {
    all_repos.extend(parse_sources_file(&base));
  }

  // Parse /etc/apt/sources.list.d/*
  if let Ok(dir) = fs::read_dir("/etc/apt/sources.list.d") {
    for entry in dir.flatten() {
      let path = entry.path();
      if path.is_file() {
        let ext = path.extension().and_then(|e| e.to_str());
        if ext == Some("list") || ext == Some("sources") {
          all_repos.extend(parse_sources_file(&path));
        }
      }
    }
  }

  Ok(json!(all_repos))
}

#[tauri::command]
pub fn toggle_apt_repo(id: String, enabled: bool) -> Result<serde_json::Value, String> {
  // Parse the id to get file path and line number
  let parts: Vec<&str> = id.rsplitn(2, ':').collect();
  if parts.len() != 2 {
    return Err("Invalid repository ID".to_string());
  }

  let line_number: usize = parts[0].parse().map_err(|_| "Invalid line number")?;
  let file_path = parts[1];

  let path = PathBuf::from(file_path);
  if !path.exists() {
    return Err("Repository file not found".to_string());
  }

  // Read current content
  let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
  let lines: Vec<&str> = content.lines().collect();

  // Determine file format
  let is_deb822 = path.extension().map_or(false, |ext| ext == "sources");

  let new_content = if is_deb822 {
    // Handle DEB822 format - need to add or modify Enabled: field
    let mut result_lines: Vec<String> = Vec::new();
    let mut in_target_stanza = false;
    let mut found_enabled_field = false;
    let mut stanza_start = 0;

    for (idx, line) in lines.iter().enumerate() {
      let line_trimmed = line.trim();

      if line_trimmed.is_empty() {
        // End of stanza
        if in_target_stanza && !found_enabled_field {
          // Insert Enabled field at the start of the stanza
          result_lines.insert(stanza_start, format!("Enabled: {}", if enabled { "yes" } else { "no" }));
        }
        in_target_stanza = false;
        found_enabled_field = false;
        result_lines.push(line.to_string());
        continue;
      }

      if idx == line_number || (in_target_stanza && idx > line_number) {
        in_target_stanza = true;
        if idx == line_number {
          stanza_start = result_lines.len();
        }
      }

      if in_target_stanza && line_trimmed.starts_with("Enabled:") {
        found_enabled_field = true;
        result_lines.push(format!("Enabled: {}", if enabled { "yes" } else { "no" }));
      } else {
        result_lines.push(line.to_string());
      }
    }

    // Handle last stanza if file doesn't end with empty line
    if in_target_stanza && !found_enabled_field {
      result_lines.insert(stanza_start, format!("Enabled: {}", if enabled { "yes" } else { "no" }));
    }

    result_lines.join("\n")
  } else {
    // Handle traditional sources.list format
    let mut result_lines: Vec<String> = Vec::new();

    for (idx, line) in lines.iter().enumerate() {
      if idx == line_number {
        let line_trimmed = line.trim();
        if enabled {
          // Enable: remove leading # if present
          if line_trimmed.starts_with('#') {
            let uncommented = line_trimmed.trim_start_matches('#').trim();
            result_lines.push(uncommented.to_string());
          } else {
            result_lines.push(line.to_string());
          }
        } else {
          // Disable: add # if not present
          if !line_trimmed.starts_with('#') {
            result_lines.push(format!("# {}", line_trimmed));
          } else {
            result_lines.push(line.to_string());
          }
        }
      } else {
        result_lines.push(line.to_string());
      }
    }

    result_lines.join("\n")
  };

  // Write using pkexec for root privileges
  let temp_file = std::env::temp_dir().join("apt_repo_temp");
  fs::write(&temp_file, &new_content).map_err(|e| e.to_string())?;

  let output = Command::new("pkexec")
    .args(["cp", &temp_file.to_string_lossy(), file_path])
    .output()
    .map_err(|e| e.to_string())?;

  // Clean up temp file
  let _ = fs::remove_file(&temp_file);

  if output.status.success() {
    Ok(json!({"success": true}))
  } else {
    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(format!("Failed to update repository: {}", stderr))
  }
}

#[tauri::command]
pub fn list_startup_apps() -> Result<serde_json::Value, String> {
  let mut apps: Vec<serde_json::Value> = Vec::new();
  if let Some(home) = dirs::home_dir() {
    let autostart = home.join(".config").join("autostart");
    if autostart.exists() {
      if let Ok(entries) = fs::read_dir(&autostart) {
        for e in entries.flatten() {
          if let Ok(s) = fs::read_to_string(e.path()) {
            let mut name = None;
            let mut exec = None;
            for line in s.lines() {
              if line.starts_with("Name=") {
                name = Some(line.trim_start_matches("Name=").to_string());
              }
              if line.starts_with("Exec=") {
                exec = Some(line.trim_start_matches("Exec=").to_string());
              }
            }
            apps.push(json!({"file": e.path().file_name().map(|n| n.to_string_lossy().to_string()), "name": name, "exec": exec}));
          }
        }
      }
    }
  }
  Ok(json!(apps))
}
