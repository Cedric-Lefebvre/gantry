use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScriptPrompt {
    pub variable: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomScript {
    pub id: String,
    pub name: String,
    pub command: String,
    pub requires_sudo: bool,
    #[serde(default)]
    pub prompts: Vec<ScriptPrompt>,
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

    if config_path.exists() {
        let content = fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
        return serde_yaml::from_str(&content).map_err(|e| e.to_string());
    }

    if legacy_path.exists() {
        let content = fs::read_to_string(&legacy_path).map_err(|e| e.to_string())?;
        let config: ScriptsConfig = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        save_config(&config)?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_list_scripts_returns_array() {
        let result = list_scripts();
        assert!(result.is_ok(), "list_scripts failed: {:?}", result.err());
        assert!(result.unwrap().is_array(), "scripts should be an array");
    }

    #[test]
    fn test_add_and_remove_script() {
        let result = add_script("Test Script".to_string(), "echo hello".to_string(), false, None);
        assert!(result.is_ok(), "add_script failed: {:?}", result.err());
        let script = result.unwrap();
        let id = script["id"].as_str().expect("script should have an id").to_string();

        let scripts = list_scripts().unwrap();
        let found = scripts.as_array().unwrap().iter().any(|s| s["id"] == id);
        assert!(found, "newly added script should appear in list");

        let remove = remove_script(id);
        assert!(remove.is_ok(), "remove_script failed: {:?}", remove.err());
    }

    #[test]
    fn test_run_script_echo() {
        let script = add_script("Run Test".to_string(), "echo gantry_test_output".to_string(), false, None).unwrap();
        let id = script["id"].as_str().unwrap().to_string();

        let run = run_script(id.clone(), None);
        assert!(run.is_ok(), "run_script failed: {:?}", run.err());
        let result = run.unwrap();
        assert_eq!(result["success"].as_bool(), Some(true));
        assert!(
            result["stdout"].as_str().unwrap_or("").contains("gantry_test_output"),
            "stdout should contain expected output, got: {}",
            result["stdout"]
        );

        let _ = remove_script(id);
    }

    #[test]
    fn test_run_script_failure() {
        let script = add_script("Failing Script".to_string(), "exit 1".to_string(), false, None).unwrap();
        let id = script["id"].as_str().unwrap().to_string();

        let run = run_script(id.clone(), None);
        assert!(run.is_ok(), "run_script should not error even on failure");
        let result = run.unwrap();
        assert_eq!(result["success"].as_bool(), Some(false), "script with exit 1 should not succeed");
        assert_ne!(result["exit_code"].as_i64(), Some(0));

        let _ = remove_script(id);
    }

    #[test]
    fn test_run_script_with_prompt_args() {
        let script = add_script(
            "Args Test".to_string(),
            "echo {greeting} {name}".to_string(),
            false,
            Some(vec![
                ScriptPrompt { variable: "greeting".to_string(), label: "Greeting".to_string() },
                ScriptPrompt { variable: "name".to_string(), label: "Name".to_string() },
            ]),
        ).unwrap();
        let id = script["id"].as_str().unwrap().to_string();

        let mut args = HashMap::new();
        args.insert("greeting".to_string(), "hello".to_string());
        args.insert("name".to_string(), "world".to_string());

        let run = run_script(id.clone(), Some(args));
        assert!(run.is_ok());
        let result = run.unwrap();
        assert_eq!(result["success"].as_bool(), Some(true));
        assert!(result["stdout"].as_str().unwrap_or("").contains("hello world"));
        assert_eq!(result["resolved_command"].as_str(), Some("echo hello world"));

        let _ = remove_script(id);
    }

    #[test]
    fn test_update_script() {
        let script = add_script("Original".to_string(), "echo original".to_string(), false, None).unwrap();
        let id = script["id"].as_str().unwrap().to_string();

        let update = update_script(id.clone(), "Updated".to_string(), "echo updated".to_string(), false, None);
        assert!(update.is_ok(), "update_script failed: {:?}", update.err());

        let scripts = list_scripts().unwrap();
        let updated = scripts.as_array().unwrap().iter()
            .find(|s| s["id"] == id)
            .expect("updated script should still exist");
        assert_eq!(updated["name"].as_str(), Some("Updated"));
        assert_eq!(updated["command"].as_str(), Some("echo updated"));

        let _ = remove_script(id);
    }

    #[test]
    fn test_run_nonexistent_script() {
        let result = run_script("nonexistent_id_xyz".to_string(), None);
        assert!(result.is_err(), "running nonexistent script should return error");
    }

    #[test]
    fn test_remove_nonexistent_script_is_ok() {
        // retain() silently no-ops when the id isn't found
        let result = remove_script("nonexistent_id_xyz".to_string());
        assert!(result.is_ok(), "remove_script on nonexistent id should not error");
    }
}

#[tauri::command]
pub fn list_scripts() -> Result<serde_json::Value, String> {
    let config = load_config()?;
    Ok(json!(config.scripts))
}

#[tauri::command]
pub fn add_script(name: String, command: String, requires_sudo: bool, prompts: Option<Vec<ScriptPrompt>>) -> Result<serde_json::Value, String> {
    let mut config = load_config()?;

    let id = format!("script_{}", chrono::Utc::now().timestamp_millis());
    let script = CustomScript {
        id: id.clone(),
        name,
        command,
        requires_sudo,
        prompts: prompts.unwrap_or_default(),
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
pub fn update_script(id: String, name: String, command: String, requires_sudo: bool, prompts: Option<Vec<ScriptPrompt>>) -> Result<serde_json::Value, String> {
    let mut config = load_config()?;

    if let Some(script) = config.scripts.iter_mut().find(|s| s.id == id) {
        script.name = name;
        script.command = command;
        script.requires_sudo = requires_sudo;
        script.prompts = prompts.unwrap_or_default();
        save_config(&config)?;
        Ok(json!({"success": true}))
    } else {
        Err("Script not found".to_string())
    }
}

#[tauri::command]
pub fn run_script(id: String, args: Option<HashMap<String, String>>) -> Result<serde_json::Value, String> {
    let config = load_config()?;
    let script = config.scripts.iter().find(|s| s.id == id)
        .ok_or_else(|| "Script not found".to_string())?;

    let mut command = script.command.clone();
    if let Some(ref args) = args {
        for (key, value) in args {
            command = command.replace(&format!("{{{}}}", key), value);
        }
    }

    let output = if script.requires_sudo {
        Command::new("pkexec")
            .arg("sh")
            .arg("-c")
            .arg(&command)
            .output()
    } else {
        Command::new("sh")
            .arg("-c")
            .arg(&command)
            .output()
    };

    match output {
        Ok(result) => Ok(json!({
            "success": result.status.success(),
            "stdout": String::from_utf8_lossy(&result.stdout).to_string(),
            "stderr": String::from_utf8_lossy(&result.stderr).to_string(),
            "exit_code": result.status.code(),
            "resolved_command": command,
        })),
        Err(e) => Ok(json!({
            "success": false,
            "stdout": "",
            "stderr": e.to_string(),
            "exit_code": -1,
            "resolved_command": command,
        })),
    }
}
