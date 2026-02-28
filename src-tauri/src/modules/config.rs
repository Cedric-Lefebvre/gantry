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

#[cfg(target_os = "linux")]
fn parse_sources_file(path: &PathBuf) -> Vec<AptRepository> {
    let mut repos = Vec::new();
    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return repos,
    };

    let file_path = path.to_string_lossy().to_string();

    if path.extension().map_or(false, |ext| ext == "sources") {
        let mut current_enabled = true;
        let mut current_types = String::new();
        let mut current_uris = String::new();
        let mut current_suites = String::new();
        let mut current_components = String::new();
        let mut start_line = 0;

        for (idx, line) in content.lines().enumerate() {
            let line_trimmed = line.trim();

            if line_trimmed.is_empty() {
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
                        original_line: format!(
                            "{} {} {} {}",
                            current_types, current_uris, current_suites, current_components
                        ),
                    });
                }
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
        for (idx, line) in content.lines().enumerate() {
            let line_trimmed = line.trim();

            if line_trimmed.is_empty() {
                continue;
            }

            let (is_enabled, effective_line) = if line_trimmed.starts_with('#') {
                let uncommented = line_trimmed.trim_start_matches('#').trim();
                if uncommented.starts_with("deb") {
                    (false, uncommented.to_string())
                } else {
                    continue;
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

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn list_apt_repos() -> Result<serde_json::Value, String> {
    let mut all_repos: Vec<AptRepository> = Vec::new();

    let base = PathBuf::from("/etc/apt/sources.list");
    if base.exists() {
        all_repos.extend(parse_sources_file(&base));
    }

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

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn toggle_apt_repo(id: String, enabled: bool) -> Result<serde_json::Value, String> {
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

    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let lines: Vec<&str> = content.lines().collect();
    let is_deb822 = path.extension().map_or(false, |ext| ext == "sources");

    let new_content = if is_deb822 {
        let mut result_lines: Vec<String> = Vec::new();
        let mut in_target_stanza = false;
        let mut found_enabled_field = false;
        let mut stanza_start = 0;

        for (idx, line) in lines.iter().enumerate() {
            let line_trimmed = line.trim();

            if line_trimmed.is_empty() {
                if in_target_stanza && !found_enabled_field {
                    result_lines.insert(
                        stanza_start,
                        format!("Enabled: {}", if enabled { "yes" } else { "no" }),
                    );
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

        if in_target_stanza && !found_enabled_field {
            result_lines.insert(
                stanza_start,
                format!("Enabled: {}", if enabled { "yes" } else { "no" }),
            );
        }

        result_lines.join("\n")
    } else {
        let mut result_lines: Vec<String> = Vec::new();

        for (idx, line) in lines.iter().enumerate() {
            if idx == line_number {
                let line_trimmed = line.trim();
                if enabled {
                    if line_trimmed.starts_with('#') {
                        let uncommented = line_trimmed.trim_start_matches('#').trim();
                        result_lines.push(uncommented.to_string());
                    } else {
                        result_lines.push(line.to_string());
                    }
                } else if !line_trimmed.starts_with('#') {
                    result_lines.push(format!("# {}", line_trimmed));
                } else {
                    result_lines.push(line.to_string());
                }
            } else {
                result_lines.push(line.to_string());
            }
        }

        result_lines.join("\n")
    };

    let temp_file = std::env::temp_dir().join("apt_repo_temp");
    fs::write(&temp_file, &new_content).map_err(|e| e.to_string())?;

    let output = Command::new("pkexec")
        .args(["cp", &temp_file.to_string_lossy(), file_path])
        .output()
        .map_err(|e| e.to_string())?;

    let _ = fs::remove_file(&temp_file);

    if output.status.success() {
        Ok(json!({"success": true}))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Failed to update repository: {}", stderr))
    }
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn add_apt_repo(repo_line: String) -> Result<serde_json::Value, String> {
    let trimmed = repo_line.trim();
    if !trimmed.starts_with("deb ") && !trimmed.starts_with("deb-src ") {
        return Err("Repository line must start with 'deb' or 'deb-src'".to_string());
    }

    let parts: Vec<&str> = trimmed.split_whitespace().collect();
    if parts.len() < 3 {
        return Err("Invalid repository format. Expected: deb URI suite [components...]".to_string());
    }

    let uri = parts[1];
    let sanitized: String = uri
        .replace("http://", "")
        .replace("https://", "")
        .replace('/', "-")
        .replace('.', "-")
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-')
        .collect();

    let mut filename = format!("{}.list", sanitized);
    let mut target = PathBuf::from("/etc/apt/sources.list.d").join(&filename);

    if target.exists() {
        filename = format!("{}_{}.list", sanitized, chrono::Utc::now().timestamp_millis());
        target = PathBuf::from("/etc/apt/sources.list.d").join(&filename);
    }

    let content = format!("{}\n", trimmed);
    let temp_file = std::env::temp_dir().join("apt_repo_add_temp");
    fs::write(&temp_file, &content).map_err(|e| e.to_string())?;

    let output = Command::new("pkexec")
        .args(["cp", &temp_file.to_string_lossy(), &target.to_string_lossy()])
        .output()
        .map_err(|e| e.to_string())?;

    let _ = fs::remove_file(&temp_file);

    if output.status.success() {
        Ok(json!({"success": true, "file": filename}))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Failed to add repository: {}", stderr))
    }
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn delete_apt_repo(id: String) -> Result<serde_json::Value, String> {
    let parts: Vec<&str> = id.rsplitn(2, ':').collect();
    if parts.len() != 2 {
        return Err("Invalid repository ID".to_string());
    }

    let line_number: usize = parts[0].parse().map_err(|_| "Invalid line number".to_string())?;
    let file_path = parts[1];
    let path = PathBuf::from(file_path);

    if !path.exists() {
        return Err("Repository file not found".to_string());
    }

    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let lines: Vec<&str> = content.lines().collect();
    let is_deb822 = path.extension().map_or(false, |ext| ext == "sources");

    let new_lines: Vec<&str> = if is_deb822 {
        let mut result: Vec<&str> = Vec::new();
        let mut skip = false;
        for (idx, line) in lines.iter().enumerate() {
            if idx == line_number {
                skip = true;
                continue;
            }
            if skip {
                if line.trim().is_empty() {
                    skip = false;
                    continue;
                }
                continue;
            }
            result.push(line);
        }
        result
    } else {
        lines
            .iter()
            .enumerate()
            .filter(|(idx, _)| *idx != line_number)
            .map(|(_, line)| *line)
            .collect()
    };

    let new_content = new_lines.join("\n");

    if new_content.trim().is_empty() {
        let output = Command::new("pkexec")
            .args(["rm", file_path])
            .output()
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Failed to delete repository file: {}", stderr));
        }
    } else {
        let temp_file = std::env::temp_dir().join("apt_repo_del_temp");
        fs::write(&temp_file, format!("{}\n", new_content)).map_err(|e| e.to_string())?;

        let output = Command::new("pkexec")
            .args(["cp", &temp_file.to_string_lossy(), file_path])
            .output()
            .map_err(|e| e.to_string())?;

        let _ = fs::remove_file(&temp_file);

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Failed to update repository file: {}", stderr));
        }
    }

    Ok(json!({"success": true}))
}

#[cfg(target_os = "macos")]
fn find_brew() -> Option<PathBuf> {
    for path in &["/opt/homebrew/bin/brew", "/usr/local/bin/brew"] {
        if std::path::Path::new(path).exists() {
            return Some(PathBuf::from(path));
        }
    }
    None
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn list_apt_repos() -> Result<serde_json::Value, String> {
    let brew = find_brew().ok_or_else(|| {
        "Homebrew not found. Install it from https://brew.sh".to_string()
    })?;

    let output = Command::new(&brew)
        .args(["tap-info", "--json=v2", "--installed"])
        .output()
        .map_err(|e| format!("Failed to run brew: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("brew tap-info failed: {}", stderr));
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let parsed: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("Failed to parse brew output: {}", e))?;

    let taps = parsed["taps"].as_array().map(|arr| {
        arr.iter().map(|tap| {
            let name = tap["name"].as_str().unwrap_or("").to_string();
            let remote = tap["remote"].as_str().unwrap_or("").to_string();
            let tap_path = tap["path"].as_str().unwrap_or("").to_string();
            let formula_count = tap["formula_names"]
                .as_array()
                .map(|a| a.len())
                .unwrap_or(0);
            let cask_count = tap["cask_tokens"]
                .as_array()
                .map(|a| a.len())
                .unwrap_or(0);

            json!({
                "id": name,
                "file_path": tap_path,
                "line_number": 0,
                "types": "tap",
                "uris": remote,
                "suites": formula_count.to_string(),
                "components": cask_count.to_string(),
                "enabled": true,
                "original_line": name,
            })
        }).collect::<Vec<_>>()
    }).unwrap_or_default();

    Ok(json!(taps))
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn toggle_apt_repo(_id: String, _enabled: bool) -> Result<serde_json::Value, String> {
    Err("Homebrew taps cannot be toggled. Use Remove to delete a tap.".to_string())
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn add_apt_repo(repo_line: String) -> Result<serde_json::Value, String> {
    let tap_name = repo_line.trim();
    if tap_name.is_empty() {
        return Err("Tap name cannot be empty".to_string());
    }

    let brew = find_brew().ok_or_else(|| "Homebrew not found".to_string())?;

    let output = Command::new(&brew)
        .args(["tap", tap_name])
        .output()
        .map_err(|e| format!("Failed to run brew tap: {}", e))?;

    if output.status.success() {
        Ok(json!({"success": true}))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("brew tap failed: {}", stderr))
    }
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn delete_apt_repo(id: String) -> Result<serde_json::Value, String> {
    let brew = find_brew().ok_or_else(|| "Homebrew not found".to_string())?;

    let output = Command::new(&brew)
        .args(["untap", &id])
        .output()
        .map_err(|e| format!("Failed to run brew untap: {}", e))?;

    if output.status.success() {
        Ok(json!({"success": true}))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("brew untap failed: {}", stderr))
    }
}

#[cfg(target_os = "linux")]
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
                        let mut hidden = false;
                        for line in s.lines() {
                            if line.starts_with("Name=") {
                                name = Some(line.trim_start_matches("Name=").to_string());
                            }
                            if line.starts_with("Exec=") {
                                exec = Some(line.trim_start_matches("Exec=").to_string());
                            }
                            if line.starts_with("Hidden=") {
                                hidden = line
                                    .trim_start_matches("Hidden=")
                                    .trim()
                                    .eq_ignore_ascii_case("true");
                            }
                        }
                        apps.push(json!({
                            "file": e.path().file_name().map(|n| n.to_string_lossy().to_string()),
                            "name": name,
                            "exec": exec,
                            "enabled": !hidden,
                            "file_path": e.path().to_string_lossy().to_string()
                        }));
                    }
                }
            }
        }
    }
    Ok(json!(apps))
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn add_startup_app(name: String, exec: String) -> Result<serde_json::Value, String> {
    let home = dirs::home_dir()
        .ok_or_else(|| "Cannot determine home directory".to_string())?;
    let autostart = home.join(".config").join("autostart");
    fs::create_dir_all(&autostart).map_err(|e| e.to_string())?;

    let sanitized: String = name
        .to_lowercase()
        .replace(' ', "-")
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-')
        .collect();
    let mut filename = format!("{}.desktop", sanitized);
    let mut filepath = autostart.join(&filename);

    if filepath.exists() {
        filename = format!("{}_{}.desktop", sanitized, chrono::Utc::now().timestamp_millis());
        filepath = autostart.join(&filename);
    }

    let content = format!(
        "[Desktop Entry]\nType=Application\nName={}\nExec={}\nHidden=false\n",
        name, exec
    );
    fs::write(&filepath, content).map_err(|e| e.to_string())?;

    Ok(json!({"success": true, "file": filename}))
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn edit_startup_app(file: String, name: String, exec: String) -> Result<serde_json::Value, String> {
    let home = dirs::home_dir()
        .ok_or_else(|| "Cannot determine home directory".to_string())?;
    let filepath = home.join(".config").join("autostart").join(&file);

    if !filepath.exists() {
        return Err("Desktop file not found".to_string());
    }

    let content = fs::read_to_string(&filepath).map_err(|e| e.to_string())?;
    let new_content: String = content
        .lines()
        .map(|line| {
            if line.starts_with("Name=") {
                format!("Name={}", name)
            } else if line.starts_with("Exec=") {
                format!("Exec={}", exec)
            } else {
                line.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\n");

    fs::write(&filepath, format!("{}\n", new_content)).map_err(|e| e.to_string())?;
    Ok(json!({"success": true}))
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn delete_startup_app(file: String) -> Result<serde_json::Value, String> {
    let home = dirs::home_dir()
        .ok_or_else(|| "Cannot determine home directory".to_string())?;
    let filepath = home.join(".config").join("autostart").join(&file);

    if !filepath.exists() {
        return Err("Desktop file not found".to_string());
    }

    fs::remove_file(&filepath).map_err(|e| e.to_string())?;
    Ok(json!({"success": true}))
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn toggle_startup_app(file: String, enabled: bool) -> Result<serde_json::Value, String> {
    let home = dirs::home_dir()
        .ok_or_else(|| "Cannot determine home directory".to_string())?;
    let filepath = home.join(".config").join("autostart").join(&file);

    if !filepath.exists() {
        return Err("Desktop file not found".to_string());
    }

    let content = fs::read_to_string(&filepath).map_err(|e| e.to_string())?;
    let hidden_value = if enabled { "false" } else { "true" };
    let mut found_hidden = false;

    let new_lines: Vec<String> = content
        .lines()
        .map(|line| {
            if line.starts_with("Hidden=") {
                found_hidden = true;
                format!("Hidden={}", hidden_value)
            } else {
                line.to_string()
            }
        })
        .collect();

    let mut new_content = new_lines.join("\n");
    if !found_hidden {
        new_content.push_str(&format!("\nHidden={}", hidden_value));
    }

    fs::write(&filepath, format!("{}\n", new_content)).map_err(|e| e.to_string())?;
    Ok(json!({"success": true}))
}

#[cfg(target_os = "macos")]
fn launch_agents_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join("Library/LaunchAgents"))
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn list_startup_apps() -> Result<serde_json::Value, String> {
    let dir = launch_agents_dir()
        .ok_or_else(|| "Cannot determine home directory".to_string())?;

    let mut apps: Vec<serde_json::Value> = Vec::new();

    if !dir.exists() {
        return Ok(json!(apps));
    }

    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("plist") {
                continue;
            }

            let Ok(val) = plist::from_file::<plist::Value, _>(&path) else {
                continue;
            };
            let Some(dict) = val.into_dictionary() else { continue };

            let label = dict.get("Label")
                .and_then(|v| v.as_string())
                .map(|s| s.to_string());

            let exec = dict.get("ProgramArguments")
                .and_then(|v| v.as_array())
                .and_then(|a| a.first())
                .and_then(|v| v.as_string())
                .map(|s| s.to_string());

            let disabled = dict.get("Disabled")
                .and_then(|v| v.as_boolean())
                .unwrap_or(false);

            let filename = path.file_name()
                .map(|n| n.to_string_lossy().to_string());

            apps.push(json!({
                "file": filename,
                "name": label,
                "exec": exec,
                "enabled": !disabled,
                "file_path": path.to_string_lossy().to_string(),
            }));
        }
    }

    Ok(json!(apps))
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn add_startup_app(name: String, exec: String) -> Result<serde_json::Value, String> {
    let dir = launch_agents_dir()
        .ok_or_else(|| "Cannot determine home directory".to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let sanitized: String = name
        .to_lowercase()
        .replace(' ', "-")
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-')
        .collect();
    let label = format!("com.user.{}", sanitized);
    let mut filename = format!("{}.plist", label);
    let mut filepath = dir.join(&filename);

    if filepath.exists() {
        filename = format!("{}-{}.plist", label, chrono::Utc::now().timestamp_millis());
        filepath = dir.join(&filename);
    }

    let mut dict = plist::Dictionary::new();
    dict.insert("Label".into(), plist::Value::String(label));
    dict.insert(
        "ProgramArguments".into(),
        plist::Value::Array(vec![plist::Value::String(exec)]),
    );
    dict.insert("RunAtLoad".into(), plist::Value::Boolean(true));

    plist::to_file_xml(&filepath, &plist::Value::Dictionary(dict))
        .map_err(|e| format!("Failed to write plist: {}", e))?;

    let _ = Command::new("launchctl").args(["load", &filepath.to_string_lossy()]).output();

    Ok(json!({"success": true, "file": filename}))
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn edit_startup_app(file: String, name: String, exec: String) -> Result<serde_json::Value, String> {
    let dir = launch_agents_dir()
        .ok_or_else(|| "Cannot determine home directory".to_string())?;
    let filepath = dir.join(&file);

    if !filepath.exists() {
        return Err("Plist file not found".to_string());
    }

    let _ = Command::new("launchctl").args(["unload", &filepath.to_string_lossy()]).output();

    let val = plist::from_file::<plist::Value, _>(&filepath)
        .map_err(|e| format!("Failed to read plist: {}", e))?;
    let mut dict = val
        .into_dictionary()
        .ok_or_else(|| "Unexpected plist format".to_string())?;

    let sanitized: String = name
        .to_lowercase()
        .replace(' ', "-")
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-')
        .collect();
    let label = format!("com.user.{}", sanitized);

    dict.insert("Label".into(), plist::Value::String(label));
    dict.insert(
        "ProgramArguments".into(),
        plist::Value::Array(vec![plist::Value::String(exec)]),
    );

    plist::to_file_xml(&filepath, &plist::Value::Dictionary(dict))
        .map_err(|e| format!("Failed to write plist: {}", e))?;

    let _ = Command::new("launchctl").args(["load", &filepath.to_string_lossy()]).output();

    Ok(json!({"success": true}))
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn delete_startup_app(file: String) -> Result<serde_json::Value, String> {
    let dir = launch_agents_dir()
        .ok_or_else(|| "Cannot determine home directory".to_string())?;
    let filepath = dir.join(&file);

    if !filepath.exists() {
        return Err("Plist file not found".to_string());
    }

    let _ = Command::new("launchctl").args(["unload", &filepath.to_string_lossy()]).output();
    fs::remove_file(&filepath).map_err(|e| e.to_string())?;

    Ok(json!({"success": true}))
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn toggle_startup_app(file: String, enabled: bool) -> Result<serde_json::Value, String> {
    let dir = launch_agents_dir()
        .ok_or_else(|| "Cannot determine home directory".to_string())?;
    let filepath = dir.join(&file);

    if !filepath.exists() {
        return Err("Plist file not found".to_string());
    }

    let path_str = filepath.to_string_lossy().to_string();

    let output = if enabled {
        Command::new("launchctl").args(["load", "-w", &path_str]).output()
    } else {
        Command::new("launchctl").args(["unload", "-w", &path_str]).output()
    };

    let output = output.map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(json!({"success": true}))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("launchctl failed: {}", stderr))
    }
}
