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

            let is_running = active_state == "active" && (sub_state == "running" || sub_state == "waiting" || sub_state == "exited");
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

    #[test]
    fn test_parse_services_output_enabled_set() {
        let sample = "sshd.service loaded active running OpenSSH Daemon";
        let mut enabled = HashSet::new();
        enabled.insert("sshd".to_string());
        let result = parse_services_output(sample, false, &enabled);
        assert_eq!(result.len(), 1);
        assert!(result[0].is_enabled, "service in enabled set should be marked enabled");
    }

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

    #[test]
    fn test_parse_services_output_user_flag() {
        let sample = "myapp.service loaded active running My App";
        let enabled = HashSet::new();
        let result = parse_services_output(sample, true, &enabled);
        assert_eq!(result.len(), 1);
        assert!(result[0].is_user_service, "should be marked as user service");
    }
}

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

#[tauri::command]
pub fn start_service(name: String, is_user: bool) -> Result<serde_json::Value, String> {
    run_systemctl("start", &name, is_user)
}

#[tauri::command]
pub fn stop_service(name: String, is_user: bool) -> Result<serde_json::Value, String> {
    run_systemctl("stop", &name, is_user)
}

#[tauri::command]
pub fn restart_service(name: String, is_user: bool) -> Result<serde_json::Value, String> {
    run_systemctl("restart", &name, is_user)
}

#[tauri::command]
pub fn enable_service(name: String, is_user: bool) -> Result<serde_json::Value, String> {
    run_systemctl("enable", &name, is_user)
}

#[tauri::command]
pub fn disable_service(name: String, is_user: bool) -> Result<serde_json::Value, String> {
    run_systemctl("disable", &name, is_user)
}
