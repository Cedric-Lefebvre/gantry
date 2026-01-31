use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomScript {
    pub id: String,
    pub name: String,
    pub command: String,
    pub requires_sudo: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct ScriptsConfig {
    scripts: Vec<CustomScript>,
}

fn get_config_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".gantry").join("scripts.yaml")
}

fn get_legacy_config_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".gantry").join("scripts.json")
}

fn ensure_config_dir() -> Result<(), String> {
    let config_path = get_config_path();
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn load_config() -> Result<ScriptsConfig, String> {
    let config_path = get_config_path();
    let legacy_path = get_legacy_config_path();

    // If YAML config exists, use it
    if config_path.exists() {
        let content = fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
        return serde_yaml::from_str(&content).map_err(|e| e.to_string());
    }

    // Migrate from legacy JSON if it exists
    if legacy_path.exists() {
        let content = fs::read_to_string(&legacy_path).map_err(|e| e.to_string())?;
        let config: ScriptsConfig = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        // Save as YAML
        save_config(&config)?;
        // Remove legacy file
        let _ = fs::remove_file(&legacy_path);
        return Ok(config);
    }

    Ok(ScriptsConfig::default())
}

fn save_config(config: &ScriptsConfig) -> Result<(), String> {
    ensure_config_dir()?;
    let config_path = get_config_path();
    let content = serde_yaml::to_string(config).map_err(|e| e.to_string())?;
    let mut file = fs::File::create(&config_path).map_err(|e| e.to_string())?;
    file.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_scripts() -> Result<serde_json::Value, String> {
    let config = load_config()?;
    Ok(json!(config.scripts))
}

#[tauri::command]
pub fn add_script(name: String, command: String, requires_sudo: bool) -> Result<serde_json::Value, String> {
    let mut config = load_config()?;

    let id = format!("script_{}", chrono::Utc::now().timestamp_millis());
    let script = CustomScript {
        id: id.clone(),
        name,
        command,
        requires_sudo,
    };

    config.scripts.push(script.clone());
    save_config(&config)?;

    Ok(json!(script))
}

#[tauri::command]
pub fn remove_script(id: String) -> Result<serde_json::Value, String> {
    let mut config = load_config()?;
    config.scripts.retain(|s| s.id != id);
    save_config(&config)?;
    Ok(json!({"success": true}))
}

#[tauri::command]
pub fn update_script(id: String, name: String, command: String, requires_sudo: bool) -> Result<serde_json::Value, String> {
    let mut config = load_config()?;

    if let Some(script) = config.scripts.iter_mut().find(|s| s.id == id) {
        script.name = name;
        script.command = command;
        script.requires_sudo = requires_sudo;
        save_config(&config)?;
        Ok(json!({"success": true}))
    } else {
        Err("Script not found".to_string())
    }
}

#[tauri::command]
pub fn run_script(id: String) -> Result<serde_json::Value, String> {
    let config = load_config()?;
    let script = config.scripts.iter().find(|s| s.id == id)
        .ok_or_else(|| "Script not found".to_string())?;

    let output = if script.requires_sudo {
        // Use pkexec for graphical sudo prompt
        Command::new("pkexec")
            .arg("sh")
            .arg("-c")
            .arg(&script.command)
            .output()
    } else {
        Command::new("sh")
            .arg("-c")
            .arg(&script.command)
            .output()
    };

    match output {
        Ok(result) => {
            let stdout = String::from_utf8_lossy(&result.stdout).to_string();
            let stderr = String::from_utf8_lossy(&result.stderr).to_string();
            let success = result.status.success();

            Ok(json!({
                "success": success,
                "stdout": stdout,
                "stderr": stderr,
                "exit_code": result.status.code()
            }))
        }
        Err(e) => {
            Ok(json!({
                "success": false,
                "stdout": "",
                "stderr": e.to_string(),
                "exit_code": -1
            }))
        }
    }
}
