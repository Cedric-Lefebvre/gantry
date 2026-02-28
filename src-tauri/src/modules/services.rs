use serde::{Deserialize, Serialize};
use serde_json::json;
use std::process::Command;
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceInfo {
    pub name: String,
    pub description: String,
    pub load_state: String,
    pub active_state: String,
    pub sub_state: String,
    pub is_running: bool,
    pub is_enabled: bool,
    pub is_user_service: bool,
}

#[cfg(target_os = "linux")]
fn get_enabled_services(is_user: bool) -> HashSet<String> {
    let mut enabled = HashSet::new();

    let output = if is_user {
        Command::new("systemctl")
            .args(["--user", "list-unit-files", "--type=service", "--state=enabled", "--no-pager", "--plain"])
            .output()
    } else {
        Command::new("systemctl")
            .args(["list-unit-files", "--type=service", "--state=enabled", "--no-pager", "--plain"])
            .output()
    };

    if let Ok(output) = output {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if !parts.is_empty() && parts[0].ends_with(".service") {
                    let name = parts[0].trim_end_matches(".service").to_string();
                    enabled.insert(name);
                }
            }
        }
    }

    enabled
}

#[cfg(target_os = "linux")]
fn parse_services_output(stdout: &str, is_user: bool, enabled_services: &HashSet<String>) -> Vec<ServiceInfo> {
    let mut services = Vec::new();

    for line in stdout.lines() {
        let line = line.trim();

        if line.is_empty() {
            continue;
        }

        if line.starts_with("UNIT") && line.contains("LOAD") && line.contains("ACTIVE") {
            continue;
        }

        if line.starts_with("Legend:")
            || line.starts_with("LOAD")
            || line.starts_with("ACTIVE")
            || line.starts_with("SUB")
            || line.starts_with("To show")
            || line.contains("loaded units listed")
            || line.contains("unit files use")
        {
            continue;
        }

        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 4 {
            let first_part = parts[0];

            if !first_part.ends_with(".service") {
                continue;
            }

            let name = first_part.trim_end_matches(".service").to_string();
            let load_state = parts[1].to_string();
            let active_state = parts[2].to_string();
            let sub_state = parts[3].to_string();
            let description = if parts.len() > 4 {
                parts[4..].join(" ")
            } else {
                String::new()
            };

            if !["loaded", "not-found", "masked", "error"].contains(&load_state.as_str()) {
                continue;
            }

            let is_running = active_state == "active"
                && (sub_state == "running" || sub_state == "waiting" || sub_state == "exited");
            let is_enabled = enabled_services.contains(&name);

            services.push(ServiceInfo {
                name,
                description,
                load_state,
                active_state,
                sub_state,
                is_running,
                is_enabled,
                is_user_service: is_user,
            });
        }
    }

    services
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn list_services() -> Result<serde_json::Value, String> {
    let mut all_services: Vec<ServiceInfo> = Vec::new();

    let system_enabled = get_enabled_services(false);
    let user_enabled = get_enabled_services(true);

    if let Ok(output) = Command::new("systemctl")
        .args(["list-units", "--type=service", "--all", "--no-pager", "--plain", "--no-legend"])
        .output()
    {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            all_services.extend(parse_services_output(&stdout, false, &system_enabled));
        }
    }

    if let Ok(output) = Command::new("systemctl")
        .args(["--user", "list-units", "--type=service", "--all", "--no-pager", "--plain", "--no-legend"])
        .output()
    {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            all_services.extend(parse_services_output(&stdout, true, &user_enabled));
        }
    }

    all_services.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(json!(all_services))
}

#[cfg(target_os = "linux")]
fn run_systemctl(action: &str, name: &str, is_user: bool) -> Result<serde_json::Value, String> {
    let service = format!("{}.service", name);
    let output = if is_user {
        Command::new("systemctl")
            .args(["--user", action, &service])
            .output()
    } else {
        Command::new("pkexec")
            .args(["systemctl", action, &service])
            .output()
    };

    let output = output.map_err(|e| e.to_string())?;
    let success = output.status.success();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    Ok(json!({
        "success": success,
        "error": if success { "" } else { &stderr }
    }))
}

#[cfg(target_os = "macos")]
fn launchagent_dirs() -> Vec<std::path::PathBuf> {
    let mut dirs = vec![
        std::path::PathBuf::from("/Library/LaunchAgents"),
        std::path::PathBuf::from("/Library/LaunchDaemons"),
    ];
    if let Some(home) = dirs::home_dir() {
        dirs.insert(0, home.join("Library/LaunchAgents"));
    }
    dirs
}

#[cfg(target_os = "macos")]
fn plist_run_at_load(path: &std::path::Path) -> bool {
    plist::from_file::<plist::Value, _>(path)
        .ok()
        .and_then(|v| v.into_dictionary())
        .and_then(|d| d.get("RunAtLoad").and_then(|v| v.as_boolean()))
        .unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn plist_is_disabled(path: &std::path::Path) -> bool {
    plist::from_file::<plist::Value, _>(path)
        .ok()
        .and_then(|v| v.into_dictionary())
        .and_then(|d| d.get("Disabled").and_then(|v| v.as_boolean()))
        .unwrap_or(false)
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn list_services() -> Result<serde_json::Value, String> {
    let mut label_to_path: std::collections::HashMap<String, (std::path::PathBuf, bool)> =
        std::collections::HashMap::new();

    let home_agents = dirs::home_dir().map(|h| h.join("Library/LaunchAgents"));

    for dir in launchagent_dirs() {
        let is_user = home_agents.as_ref().map_or(false, |h| dir == *h);
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) != Some("plist") {
                    continue;
                }
                if let Ok(val) = plist::from_file::<plist::Value, _>(&path) {
                    if let Some(dict) = val.into_dictionary() {
                        if let Some(label) = dict.get("Label").and_then(|v| v.as_string()) {
                            label_to_path.insert(label.to_string(), (path, is_user));
                        }
                    }
                }
            }
        }
    }

    let output = Command::new("launchctl")
        .arg("list")
        .output()
        .map_err(|e| format!("Failed to run launchctl: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);

    let mut running: std::collections::HashMap<String, bool> = std::collections::HashMap::new();
    for line in stdout.lines().skip(1) {
        let parts: Vec<&str> = line.splitn(3, '\t').collect();
        if parts.len() == 3 {
            let pid_str = parts[0].trim();
            let label = parts[2].trim().to_string();
            running.insert(label, pid_str != "-");
        }
    }

    let mut services: Vec<ServiceInfo> = label_to_path
        .iter()
        .map(|(label, (path, is_user))| {
            let is_running = running.get(label).copied().unwrap_or(false);
            let is_enabled = plist_run_at_load(path) && !plist_is_disabled(path);

            ServiceInfo {
                name: label.clone(),
                description: label.clone(),
                load_state: if running.contains_key(label) { "loaded".to_string() } else { "not-found".to_string() },
                active_state: if is_running { "active".to_string() } else { "inactive".to_string() },
                sub_state: if is_running { "running".to_string() } else { "dead".to_string() },
                is_running,
                is_enabled,
                is_user_service: *is_user,
            }
        })
        .collect();

    services.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(json!(services))
}

#[cfg(target_os = "macos")]
fn run_launchctl(action: &str, name: &str, is_user: bool) -> Result<serde_json::Value, String> {
    let uid = unsafe { libc::getuid() };
    let domain = if is_user {
        format!("gui/{}", uid)
    } else {
        "system".to_string()
    };

    let args: Vec<String> = match action {
        "start" => vec!["kickstart".into(), format!("{}/{}", domain, name)],
        "stop" => vec!["kill".into(), "SIGTERM".into(), format!("{}/{}", domain, name)],
        "restart" => vec!["kickstart".into(), "-k".into(), format!("{}/{}", domain, name)],
        "enable" => vec!["enable".into(), format!("{}/{}", domain, name)],
        "disable" => vec!["disable".into(), format!("{}/{}", domain, name)],
        _ => return Err(format!("Unknown launchctl action: {}", action)),
    };

    let run_privileged = !is_user && action != "enable" && action != "disable";

    let output = if run_privileged {
        let cmd = format!("launchctl {}", args.join(" "));
        Command::new("osascript")
            .args(["-e", &format!("do shell script \"{}\" with administrator privileges", cmd)])
            .output()
    } else {
        Command::new("launchctl")
            .args(&args)
            .output()
    };

    let output = output.map_err(|e| e.to_string())?;
    let success = output.status.success();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    Ok(json!({
        "success": success,
        "error": if success { "" } else { &stderr }
    }))
}

#[tauri::command]
pub fn start_service(name: String, is_user: bool) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "linux")]
    { run_systemctl("start", &name, is_user) }
    #[cfg(target_os = "macos")]
    { run_launchctl("start", &name, is_user) }
}

#[tauri::command]
pub fn stop_service(name: String, is_user: bool) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "linux")]
    { run_systemctl("stop", &name, is_user) }
    #[cfg(target_os = "macos")]
    { run_launchctl("stop", &name, is_user) }
}

#[tauri::command]
pub fn restart_service(name: String, is_user: bool) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "linux")]
    { run_systemctl("restart", &name, is_user) }
    #[cfg(target_os = "macos")]
    { run_launchctl("restart", &name, is_user) }
}

#[tauri::command]
pub fn enable_service(name: String, is_user: bool) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "linux")]
    { run_systemctl("enable", &name, is_user) }
    #[cfg(target_os = "macos")]
    { run_launchctl("enable", &name, is_user) }
}

#[tauri::command]
pub fn disable_service(name: String, is_user: bool) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "linux")]
    { run_systemctl("disable", &name, is_user) }
    #[cfg(target_os = "macos")]
    { run_launchctl("disable", &name, is_user) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_list_services_returns_array() {
        let result = list_services();
        assert!(result.is_ok(), "list_services failed: {:?}", result.err());
        assert!(result.unwrap().is_array(), "services should be an array");
    }

    #[test]
    fn test_list_services_have_valid_fields() {
        let services = list_services().unwrap();
        let arr = services.as_array().unwrap();
        for service in arr {
            assert!(service["name"].as_str().is_some(), "service should have a name");
            assert!(service["load_state"].as_str().is_some(), "service should have load_state");
            assert!(service["active_state"].as_str().is_some(), "service should have active_state");
            assert!(service["sub_state"].as_str().is_some(), "service should have sub_state");
            assert!(service["is_running"].as_bool().is_some(), "service should have is_running bool");
            assert!(service["is_enabled"].as_bool().is_some(), "service should have is_enabled bool");
            assert!(service["is_user_service"].as_bool().is_some(), "service should have is_user_service bool");
        }
    }

    #[test]
    fn test_list_services_sorted_by_name() {
        let services = list_services().unwrap();
        let arr = services.as_array().unwrap();
        let names: Vec<&str> = arr.iter()
            .filter_map(|s| s["name"].as_str())
            .collect();
        let mut sorted = names.clone();
        sorted.sort();
        assert_eq!(names, sorted, "services should be sorted alphabetically by name");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_parse_services_output_basic() {
        let sample = "NetworkManager.service loaded active running Network Manager\n\
                      ssh.service loaded active running OpenBSD Secure Shell server\n\
                      cups.service loaded inactive dead CUPS Scheduler";
        let enabled = HashSet::new();
        let result = parse_services_output(sample, false, &enabled);
        assert_eq!(result.len(), 3, "should parse 3 services");
        assert_eq!(result[0].name, "NetworkManager");
        assert_eq!(result[0].active_state, "active");
        assert!(result[0].is_running, "active/running service should be marked as running");
        assert_eq!(result[2].name, "cups");
        assert!(!result[2].is_running, "inactive service should not be running");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_parse_services_output_enabled_set() {
        let sample = "sshd.service loaded active running OpenSSH Daemon";
        let mut enabled = HashSet::new();
        enabled.insert("sshd".to_string());
        let result = parse_services_output(sample, false, &enabled);
        assert_eq!(result.len(), 1);
        assert!(result[0].is_enabled, "service in enabled set should be marked enabled");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_parse_services_output_skips_headers() {
        let sample = "UNIT LOAD ACTIVE SUB DESCRIPTION\n\
                      sshd.service loaded active running OpenSSH\n\
                      Legend: info\n\
                      1 loaded units listed";
        let enabled = HashSet::new();
        let result = parse_services_output(sample, false, &enabled);
        assert_eq!(result.len(), 1, "should only parse actual service lines");
        assert_eq!(result[0].name, "sshd");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_parse_services_output_user_flag() {
        let sample = "myapp.service loaded active running My App";
        let enabled = HashSet::new();
        let result = parse_services_output(sample, true, &enabled);
        assert_eq!(result.len(), 1);
        assert!(result[0].is_user_service, "should be marked as user service");
    }
}
