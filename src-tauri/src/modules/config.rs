#[cfg(target_os = "linux")]
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

#[cfg(target_os = "linux")]
use super::pacman;

// macOS builds its tap list as JSON directly
#[cfg(target_os = "linux")]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Repository {
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
fn parse_sources_file(path: &PathBuf) -> Vec<Repository> {
    let mut repos = Vec::new();
    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return repos,
    };

    let file_path = path.to_string_lossy().to_string();

    if path.extension().is_some_and(|ext| ext == "sources") {
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
                    repos.push(Repository {
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
            repos.push(Repository {
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

                repos.push(Repository {
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
fn apt_list_repos() -> Result<serde_json::Value, String> {
    let mut all_repos: Vec<Repository> = Vec::new();

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
fn apt_toggle_repo(id: String, enabled: bool) -> Result<serde_json::Value, String> {
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
    let is_deb822 = path.extension().is_some_and(|ext| ext == "sources");

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

    write_as_root(file_path, &new_content)
        .map_err(|e| format!("Failed to update repository: {}", e))?;
    Ok(json!({"success": true}))
}

#[cfg(target_os = "linux")]
fn apt_add_repo(repo_line: String) -> Result<serde_json::Value, String> {
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
        .replace(['/', '.'], "-")
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-')
        .collect();

    let mut filename = format!("{}.list", sanitized);
    let mut target = PathBuf::from("/etc/apt/sources.list.d").join(&filename);

    if target.exists() {
        filename = format!("{}_{}.list", sanitized, chrono::Utc::now().timestamp_millis());
        target = PathBuf::from("/etc/apt/sources.list.d").join(&filename);
    }

    write_as_root(&target.to_string_lossy(), &format!("{}\n", trimmed))
        .map_err(|e| format!("Failed to add repository: {}", e))?;
    Ok(json!({"success": true, "file": filename}))
}

#[cfg(target_os = "linux")]
fn apt_delete_repo(id: String) -> Result<serde_json::Value, String> {
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
    let is_deb822 = path.extension().is_some_and(|ext| ext == "sources");

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
        write_as_root(file_path, &format!("{}\n", new_content))
            .map_err(|e| format!("Failed to update repository file: {}", e))?;
    }

    Ok(json!({"success": true}))
}

#[cfg(target_os = "linux")]
#[derive(Debug, Clone, Copy, PartialEq)]
enum PackageManager {
    Apt,
    Pacman,
}

#[cfg(target_os = "linux")]
fn package_manager_from_os_release(content: &str) -> Option<PackageManager> {
    let ids: Vec<String> = content
        .lines()
        .filter_map(|line| line.strip_prefix("ID=").or_else(|| line.strip_prefix("ID_LIKE=")))
        .flat_map(|value| value.trim().trim_matches('"').split_whitespace().map(str::to_lowercase).collect::<Vec<_>>())
        .collect();

    if ids.iter().any(|id| id == "arch") {
        Some(PackageManager::Pacman)
    } else if ids.iter().any(|id| id == "debian" || id == "ubuntu") {
        Some(PackageManager::Apt)
    } else {
        None
    }
}

#[cfg(target_os = "linux")]
fn detect_package_manager() -> Option<PackageManager> {
    let from_os_release = fs::read_to_string("/etc/os-release")
        .ok()
        .and_then(|content| package_manager_from_os_release(&content));

    from_os_release.or_else(|| {
        if std::path::Path::new("/etc/apt").is_dir() {
            Some(PackageManager::Apt)
        } else if std::path::Path::new(pacman::PACMAN_CONF).is_file() {
            Some(PackageManager::Pacman)
        } else {
            None
        }
    })
}

#[cfg(target_os = "linux")]
#[tauri::command(async)]
pub fn get_package_manager() -> &'static str {
    match detect_package_manager() {
        Some(PackageManager::Apt) => "apt",
        Some(PackageManager::Pacman) => "pacman",
        None => "none",
    }
}

#[cfg(target_os = "macos")]
#[tauri::command(async)]
pub fn get_package_manager() -> &'static str {
    "homebrew"
}

#[cfg(target_os = "linux")]
const NO_PACKAGE_MANAGER: &str = "No supported package manager found (APT or pacman)";

#[cfg(target_os = "linux")]
#[tauri::command(async)]
pub fn list_apt_repos() -> Result<serde_json::Value, String> {
    match detect_package_manager() {
        Some(PackageManager::Apt) => apt_list_repos(),
        Some(PackageManager::Pacman) => Ok(json!(pacman::list_repos())),
        None => Ok(json!([])),
    }
}

#[cfg(target_os = "linux")]
#[tauri::command(async)]
pub fn toggle_apt_repo(id: String, enabled: bool) -> Result<serde_json::Value, String> {
    match detect_package_manager() {
        Some(PackageManager::Apt) => apt_toggle_repo(id, enabled),
        Some(PackageManager::Pacman) => {
            let (path, line_number) = pacman::resolve_id(&id)?;
            let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
            let new_content = pacman::set_enabled(&content, line_number, enabled)?;
            write_as_root(&path, &new_content)
                .map_err(|e| format!("Failed to update repository: {}", e))?;
            Ok(json!({"success": true}))
        }
        None => Err(NO_PACKAGE_MANAGER.to_string()),
    }
}

#[cfg(target_os = "linux")]
#[tauri::command(async)]
pub fn add_apt_repo(repo_line: String) -> Result<serde_json::Value, String> {
    match detect_package_manager() {
        Some(PackageManager::Apt) => apt_add_repo(repo_line),
        Some(PackageManager::Pacman) => {
            let existing: Vec<String> = pacman::list_repos().into_iter().map(|r| r.suites).collect();
            let content = fs::read_to_string(pacman::PACMAN_CONF).map_err(|e| e.to_string())?;
            let new_content = pacman::append_repo(&content, &repo_line, &existing)?;
            write_as_root(pacman::PACMAN_CONF, &new_content)
                .map_err(|e| format!("Failed to add repository: {}", e))?;
            Ok(json!({"success": true, "file": pacman::PACMAN_CONF}))
        }
        None => Err(NO_PACKAGE_MANAGER.to_string()),
    }
}

#[cfg(target_os = "linux")]
#[tauri::command(async)]
pub fn delete_apt_repo(id: String) -> Result<serde_json::Value, String> {
    match detect_package_manager() {
        Some(PackageManager::Apt) => apt_delete_repo(id),
        Some(PackageManager::Pacman) => {
            let (path, line_number) = pacman::resolve_id(&id)?;
            let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
            let new_content = pacman::remove_repo(&content, line_number)?;
            write_as_root(&path, &new_content)
                .map_err(|e| format!("Failed to update repository file: {}", e))?;
            Ok(json!({"success": true}))
        }
        None => Err(NO_PACKAGE_MANAGER.to_string()),
    }
}

#[cfg(target_os = "linux")]
fn write_as_root(target: &str, content: &str) -> Result<(), String> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;

    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let temp_file = dirs::runtime_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join(format!("gantry-{}-{}.tmp", std::process::id(), nanos));

    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o644)
        .open(&temp_file)
        .map_err(|e| e.to_string())?;
    let written = file.write_all(content.as_bytes());
    drop(file);

    let output = written.and_then(|_| {
        Command::new("pkexec")
            .args(["cp", &temp_file.to_string_lossy(), target])
            .output()
    });

    let _ = fs::remove_file(&temp_file);

    let output = output.map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
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
#[tauri::command(async)]
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
#[tauri::command(async)]
pub fn toggle_apt_repo(_id: String, _enabled: bool) -> Result<serde_json::Value, String> {
    Err("Homebrew taps cannot be toggled. Use Remove to delete a tap.".to_string())
}

#[cfg(target_os = "macos")]
#[tauri::command(async)]
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
#[tauri::command(async)]
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
const DESKTOP_ENTRY_GROUP: &str = "[Desktop Entry]";

#[cfg(target_os = "linux")]
struct DesktopEntry {
    name: Option<String>,
    exec: Option<String>,
    hidden: bool,
}

/// Reads the keys of the main group only: desktop files can carry action
/// groups with their own Name and Exec.
#[cfg(target_os = "linux")]
fn parse_desktop_entry(content: &str) -> DesktopEntry {
    let mut entry = DesktopEntry { name: None, exec: None, hidden: false };
    let mut in_main_group = false;

    for line in content.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_main_group = line == DESKTOP_ENTRY_GROUP;
        } else if in_main_group {
            if let Some(value) = line.strip_prefix("Name=") {
                entry.name = Some(value.to_string());
            } else if let Some(value) = line.strip_prefix("Exec=") {
                entry.exec = Some(value.to_string());
            } else if let Some(value) = line.strip_prefix("Hidden=") {
                entry.hidden = value.trim().eq_ignore_ascii_case("true");
            }
        }
    }

    entry
}

/// Sets a key of the main group, replacing its current value or adding it at
/// the end of that group.
#[cfg(target_os = "linux")]
fn set_desktop_key(content: &str, key: &str, value: &str) -> String {
    let prefix = format!("{}=", key);
    let new_line = format!("{}{}", prefix, value);
    let mut lines: Vec<String> = Vec::new();
    let mut in_main_group = false;
    let mut insert_at: Option<usize> = None;
    let mut replaced = false;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            in_main_group = trimmed == DESKTOP_ENTRY_GROUP;
        } else if in_main_group && trimmed.starts_with(&prefix) {
            if !replaced {
                lines.push(new_line.clone());
                replaced = true;
            }
            continue;
        }
        lines.push(line.to_string());
        if in_main_group && !trimmed.is_empty() {
            insert_at = Some(lines.len());
        }
    }

    if !replaced {
        match insert_at {
            Some(index) => lines.insert(index, new_line),
            None => {
                lines.push(DESKTOP_ENTRY_GROUP.to_string());
                lines.push(new_line);
            }
        }
    }

    let mut result = lines.join("\n");
    result.push('\n');
    result
}

#[cfg(target_os = "linux")]
fn user_autostart_dir() -> Result<PathBuf, String> {
    dirs::config_dir()
        .map(|config| config.join("autostart"))
        .ok_or_else(|| "Cannot determine the configuration directory".to_string())
}

#[cfg(target_os = "linux")]
fn system_autostart_dirs() -> Vec<PathBuf> {
    let config_dirs = std::env::var("XDG_CONFIG_DIRS")
        .ok()
        .filter(|dirs| !dirs.is_empty())
        .unwrap_or_else(|| "/etc/xdg".to_string());
    config_dirs.split(':').filter(|dir| !dir.is_empty()).map(|dir| PathBuf::from(dir).join("autostart")).collect()
}

#[cfg(target_os = "linux")]
fn desktop_files(dir: &std::path::Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .map(|entry| entry.path())
                .filter(|path| path.extension().is_some_and(|ext| ext == "desktop"))
                .collect()
        })
        .unwrap_or_default();
    files.sort();
    files
}

#[cfg(target_os = "linux")]
fn autostart_file_name(file: &str) -> Result<&str, String> {
    let is_plain_name = !file.is_empty() && !file.contains('/') && file != "." && file != "..";
    if is_plain_name {
        Ok(file)
    } else {
        Err("Invalid desktop file name".to_string())
    }
}

#[cfg(target_os = "linux")]
fn user_autostart_file(file: &str) -> Result<PathBuf, String> {
    let path = user_autostart_dir()?.join(autostart_file_name(file)?);
    if path.exists() {
        Ok(path)
    } else {
        Err("Desktop file not found".to_string())
    }
}

#[cfg(target_os = "linux")]
fn list_startup_apps_in(user_dir: &std::path::Path, system_dirs: &[PathBuf]) -> Vec<serde_json::Value> {
    let mut apps: Vec<serde_json::Value> = Vec::new();
    let mut seen: std::collections::HashSet<std::ffi::OsString> = std::collections::HashSet::new();

    // A user file takes precedence over the system-wide entry of the same name
    let sources = std::iter::once((user_dir, false)).chain(system_dirs.iter().map(|dir| (dir.as_path(), true)));
    for (dir, system) in sources {
        for path in desktop_files(dir) {
            let Some(file_name) = path.file_name().map(|n| n.to_os_string()) else { continue };
            let Ok(content) = fs::read_to_string(&path) else { continue };
            if !seen.insert(file_name.clone()) {
                continue;
            }
            let entry = parse_desktop_entry(&content);
            apps.push(json!({
                "file": file_name.to_string_lossy(),
                "name": entry.name,
                "exec": entry.exec,
                "enabled": !entry.hidden,
                "file_path": path.to_string_lossy(),
                "system": system,
            }));
        }
    }

    apps
}

#[cfg(target_os = "linux")]
#[tauri::command(async)]
pub fn list_startup_apps() -> Result<serde_json::Value, String> {
    let user_dir = user_autostart_dir()?;
    Ok(json!(list_startup_apps_in(&user_dir, &system_autostart_dirs())))
}

#[cfg(target_os = "linux")]
#[tauri::command(async)]
pub fn add_startup_app(name: String, exec: String) -> Result<serde_json::Value, String> {
    let autostart = user_autostart_dir()?;
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
#[tauri::command(async)]
pub fn edit_startup_app(file: String, name: String, exec: String) -> Result<serde_json::Value, String> {
    let filepath = user_autostart_file(&file)?;

    let content = fs::read_to_string(&filepath).map_err(|e| e.to_string())?;
    let content = set_desktop_key(&content, "Name", &name);
    let content = set_desktop_key(&content, "Exec", &exec);

    fs::write(&filepath, content).map_err(|e| e.to_string())?;
    Ok(json!({"success": true}))
}

#[cfg(target_os = "linux")]
#[tauri::command(async)]
pub fn delete_startup_app(file: String) -> Result<serde_json::Value, String> {
    let filepath = user_autostart_file(&file)?;
    fs::remove_file(&filepath).map_err(|e| e.to_string())?;
    Ok(json!({"success": true}))
}

#[cfg(target_os = "linux")]
fn toggle_startup_app_in(
    user_dir: &std::path::Path,
    system_dirs: &[PathBuf],
    file: &str,
    enabled: bool,
) -> Result<(), String> {
    let file = autostart_file_name(file)?;
    let user_file = user_dir.join(file);

    // System-wide entries are not ours to edit: they are switched off with a
    // user copy that overrides them.
    let source = std::iter::once(user_file.clone())
        .chain(system_dirs.iter().map(|dir| dir.join(file)))
        .find(|path| path.exists())
        .ok_or_else(|| "Desktop file not found".to_string())?;

    let content = fs::read_to_string(&source).map_err(|e| e.to_string())?;
    let content = set_desktop_key(&content, "Hidden", if enabled { "false" } else { "true" });

    fs::create_dir_all(user_dir).map_err(|e| e.to_string())?;
    fs::write(&user_file, content).map_err(|e| e.to_string())
}

#[cfg(target_os = "linux")]
#[tauri::command(async)]
pub fn toggle_startup_app(file: String, enabled: bool) -> Result<serde_json::Value, String> {
    toggle_startup_app_in(&user_autostart_dir()?, &system_autostart_dirs(), &file, enabled)?;
    Ok(json!({"success": true}))
}

#[cfg(target_os = "macos")]
fn launch_agents_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join("Library/LaunchAgents"))
}

#[cfg(target_os = "macos")]
#[tauri::command(async)]
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

            let Ok(val) = plist::from_file::<_, plist::Value>(&path) else {
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
#[tauri::command(async)]
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
#[tauri::command(async)]
pub fn edit_startup_app(file: String, name: String, exec: String) -> Result<serde_json::Value, String> {
    let dir = launch_agents_dir()
        .ok_or_else(|| "Cannot determine home directory".to_string())?;
    let filepath = dir.join(&file);

    if !filepath.exists() {
        return Err("Plist file not found".to_string());
    }

    let _ = Command::new("launchctl").args(["unload", &filepath.to_string_lossy()]).output();

    let val = plist::from_file::<_, plist::Value>(&filepath)
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
#[tauri::command(async)]
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
#[tauri::command(async)]
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

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;

    #[test]
    fn test_package_manager_from_os_release() {
        let cachyos = "NAME=\"CachyOS Linux\"\nID=cachyos\nID_LIKE=arch\n";
        let arch = "NAME=\"Arch Linux\"\nID=arch\n";
        let ubuntu = "NAME=\"Ubuntu\"\nID=ubuntu\nID_LIKE=debian\n";
        let mint = "NAME=\"Linux Mint\"\nID=linuxmint\nID_LIKE=\"ubuntu debian\"\n";
        let fedora = "NAME=\"Fedora Linux\"\nID=fedora\n";

        assert_eq!(package_manager_from_os_release(cachyos), Some(PackageManager::Pacman));
        assert_eq!(package_manager_from_os_release(arch), Some(PackageManager::Pacman));
        assert_eq!(package_manager_from_os_release(ubuntu), Some(PackageManager::Apt));
        assert_eq!(package_manager_from_os_release(mint), Some(PackageManager::Apt));
        assert_eq!(package_manager_from_os_release(fedora), None);
    }

    const DESKTOP_FILE: &str = "[Desktop Entry]\nType=Application\nName=Flameshot\nName[fr]=Flameshot FR\nExec=flameshot\n\n[Desktop Action Capture]\nName=Take screenshot\nExec=flameshot gui\n";

    fn scratch(name: &str) -> PathBuf {
        let dir = super::super::paths::app_dir().join("autostart").join(name);
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn test_parse_desktop_entry_reads_main_group_only() {
        let entry = parse_desktop_entry(DESKTOP_FILE);
        assert_eq!(entry.name.as_deref(), Some("Flameshot"));
        assert_eq!(entry.exec.as_deref(), Some("flameshot"));
        assert!(!entry.hidden);
    }

    #[test]
    fn test_set_desktop_key_stays_in_main_group() {
        let hidden = set_desktop_key(DESKTOP_FILE, "Hidden", "true");
        assert!(hidden.contains("Exec=flameshot\nHidden=true\n\n[Desktop Action Capture]"), "got: {}", hidden);
        assert!(parse_desktop_entry(&hidden).hidden);

        let shown = set_desktop_key(&hidden, "Hidden", "false");
        assert_eq!(shown.matches("Hidden=").count(), 1);
        assert!(!parse_desktop_entry(&shown).hidden);

        let renamed = set_desktop_key(DESKTOP_FILE, "Name", "Screenshots");
        assert!(renamed.contains("Name=Screenshots\nName[fr]=Flameshot FR"));
        assert!(renamed.contains("Name=Take screenshot"), "action names must not be touched");
    }

    #[test]
    fn test_startup_apps_merge_user_and_system_entries() {
        let root = scratch("merge");
        let (user, system) = (root.join("user"), root.join("system"));
        fs::create_dir_all(&user).unwrap();
        fs::create_dir_all(&system).unwrap();
        fs::write(user.join("mine.desktop"), "[Desktop Entry]\nName=Mine\nExec=mine\n").unwrap();
        fs::write(system.join("agent.desktop"), "[Desktop Entry]\nName=Agent\nExec=agent\n").unwrap();
        fs::write(system.join("notes.txt"), "not a desktop file").unwrap();

        let apps = list_startup_apps_in(&user, std::slice::from_ref(&system));
        assert_eq!(apps.len(), 2);
        assert_eq!(apps[0]["name"], "Mine");
        assert_eq!(apps[0]["system"], false);
        assert_eq!(apps[1]["name"], "Agent");
        assert_eq!(apps[1]["system"], true);
        assert_eq!(apps[1]["enabled"], true);

        toggle_startup_app_in(&user, std::slice::from_ref(&system), "agent.desktop", false).unwrap();
        let apps = list_startup_apps_in(&user, std::slice::from_ref(&system));
        let agent = apps.iter().find(|a| a["file"] == "agent.desktop").unwrap();
        assert_eq!(apps.len(), 2, "the override replaces the system entry in the list");
        assert_eq!(agent["enabled"], false);
        assert_eq!(agent["system"], false);
        assert!(!fs::read_to_string(system.join("agent.desktop")).unwrap().contains("Hidden"), "system file is untouched");

        assert!(toggle_startup_app_in(&user, std::slice::from_ref(&system), "../agent.desktop", true).is_err());
        assert!(toggle_startup_app_in(&user, &[system], "missing.desktop", true).is_err());
    }

    #[test]
    fn test_list_repos_returns_array() {
        let result = list_apt_repos();
        assert!(result.is_ok(), "list_apt_repos failed: {:?}", result.err());
        assert!(result.unwrap().is_array(), "repositories should be an array");
    }
}
