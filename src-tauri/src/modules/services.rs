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

        // Skip empty lines
        if line.is_empty() {
            continue;
        }

        // Skip header line
        if line.starts_with("UNIT") && line.contains("LOAD") && line.contains("ACTIVE") {
            continue;
        }

        // Skip legend and footer lines
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

            // Only process lines where first part ends with .service
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

            // Skip if load_state doesn't look valid
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

#[tauri::command]
pub fn list_services() -> Result<serde_json::Value, String> {
    let mut all_services: Vec<ServiceInfo> = Vec::new();

    // Get enabled services first (batch query - much faster)
    let system_enabled = get_enabled_services(false);
    let user_enabled = get_enabled_services(true);

    // Get system services
    if let Ok(output) = Command::new("systemctl")
        .args(["list-units", "--type=service", "--all", "--no-pager", "--plain", "--no-legend"])
        .output()
    {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            all_services.extend(parse_services_output(&stdout, false, &system_enabled));
        }
    }

    // Get user services
    if let Ok(output) = Command::new("systemctl")
        .args(["--user", "list-units", "--type=service", "--all", "--no-pager", "--plain", "--no-legend"])
        .output()
    {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            all_services.extend(parse_services_output(&stdout, true, &user_enabled));
        }
    }

    // Sort by name
    all_services.sort_by(|a, b| a.name.cmp(&b.name));

    Ok(json!(all_services))
}

#[tauri::command]
pub fn start_service(name: String, is_user: bool) -> Result<serde_json::Value, String> {
    let output = if is_user {
        Command::new("systemctl")
            .args(["--user", "start", &format!("{}.service", name)])
            .output()
    } else {
        Command::new("pkexec")
            .args(["systemctl", "start", &format!("{}.service", name)])
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
pub fn stop_service(name: String, is_user: bool) -> Result<serde_json::Value, String> {
    let output = if is_user {
        Command::new("systemctl")
            .args(["--user", "stop", &format!("{}.service", name)])
            .output()
    } else {
        Command::new("pkexec")
            .args(["systemctl", "stop", &format!("{}.service", name)])
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
pub fn restart_service(name: String, is_user: bool) -> Result<serde_json::Value, String> {
    let output = if is_user {
        Command::new("systemctl")
            .args(["--user", "restart", &format!("{}.service", name)])
            .output()
    } else {
        Command::new("pkexec")
            .args(["systemctl", "restart", &format!("{}.service", name)])
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
pub fn enable_service(name: String, is_user: bool) -> Result<serde_json::Value, String> {
    let output = if is_user {
        Command::new("systemctl")
            .args(["--user", "enable", &format!("{}.service", name)])
            .output()
    } else {
        Command::new("pkexec")
            .args(["systemctl", "enable", &format!("{}.service", name)])
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
pub fn disable_service(name: String, is_user: bool) -> Result<serde_json::Value, String> {
    let output = if is_user {
        Command::new("systemctl")
            .args(["--user", "disable", &format!("{}.service", name)])
            .output()
    } else {
        Command::new("pkexec")
            .args(["systemctl", "disable", &format!("{}.service", name)])
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
