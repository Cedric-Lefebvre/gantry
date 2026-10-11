use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;
use std::sync::{Mutex, MutexGuard};

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScriptCategory {
    pub id: String,
    pub name: String,
    pub icon: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct ScriptsConfig {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    categories: Vec<ScriptCategory>,
    #[serde(default)]
    scripts: Vec<CustomScript>,
    /// Ids of the collapsed groups, including `uncategorized`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    collapsed: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ScriptPlacement {
    pub id: String,
    pub category: Option<String>,
}

/// Moves the entries named in `order` to the front, in that order. Entries the
/// caller did not mention keep their relative order after them, so a stale
/// frontend can never drop anything.
fn apply_order<T>(items: &mut Vec<T>, order: &[String], id_of: impl Fn(&T) -> &str) {
    let mut remaining: Vec<T> = std::mem::take(items);
    for id in order {
        if let Some(index) = remaining.iter().position(|item| id_of(item) == id) {
            items.push(remaining.remove(index));
        }
    }
    items.append(&mut remaining);
}

// Commands run concurrently, every read-modify-write of the file holds this.
static CONFIG_WRITE: Mutex<()> = Mutex::new(());

fn lock_config_write() -> MutexGuard<'static, ()> {
    CONFIG_WRITE.lock().unwrap_or_else(|e| e.into_inner())
}

fn get_config_path() -> PathBuf {
    super::paths::app_dir().join("scripts.yaml")
}

fn get_legacy_config_path() -> PathBuf {
    super::paths::app_dir().join("scripts.json")
}

fn unique_id(prefix: &str, taken: impl Fn(&str) -> bool) -> String {
    let mut millis = chrono::Utc::now().timestamp_millis();
    loop {
        let id = format!("{}_{}", prefix, millis);
        if !taken(&id) {
            return id;
        }
        millis += 1;
    }
}

fn known_category(config: &ScriptsConfig, category: Option<String>) -> Option<String> {
    category.filter(|id| config.categories.iter().any(|c| &c.id == id))
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
    static CONFIG_LOCK: Mutex<()> = Mutex::new(());

    fn lock_config() -> MutexGuard<'static, ()> {
        CONFIG_LOCK.lock().unwrap_or_else(|e| e.into_inner())
    }

    #[test]
    fn test_list_scripts_returns_array() {
        let _guard = lock_config();
        let result = list_scripts();
        assert!(result.is_ok(), "list_scripts failed: {:?}", result.err());
        assert!(result.unwrap().is_array(), "scripts should be an array");
    }

    #[test]
    fn test_add_and_remove_script() {
        let _guard = lock_config();
        let result = add_script("Test Script".to_string(), "echo hello".to_string(), false, None, None);
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
        let _guard = lock_config();
        let script = add_script("Run Test".to_string(), "echo gantry_test_output".to_string(), false, None, None).unwrap();
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
        let _guard = lock_config();
        let script = add_script("Failing Script".to_string(), "exit 1".to_string(), false, None, None).unwrap();
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
        let _guard = lock_config();
        let script = add_script(
            "Args Test".to_string(),
            "echo {greeting} {name}".to_string(),
            false,
            Some(vec![
                ScriptPrompt { variable: "greeting".to_string(), label: "Greeting".to_string() },
                ScriptPrompt { variable: "name".to_string(), label: "Name".to_string() },
            ]),
            None,
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
        let _guard = lock_config();
        let script = add_script("Original".to_string(), "echo original".to_string(), false, None, None).unwrap();
        let id = script["id"].as_str().unwrap().to_string();

        let update = update_script(id.clone(), "Updated".to_string(), "echo updated".to_string(), false, None, None);
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
    fn test_categories_group_scripts() {
        let _guard = lock_config();
        let category = add_script_category(" DevOps ".to_string(), "container".to_string()).unwrap();
        let category_id = category["id"].as_str().unwrap().to_string();
        assert_eq!(category["name"].as_str(), Some("DevOps"), "name should be trimmed");

        assert!(add_script_category("devops".to_string(), "cloud".to_string()).is_err(), "duplicate names are rejected");
        assert!(add_script_category("  ".to_string(), "cloud".to_string()).is_err(), "empty names are rejected");

        let script = add_script("Deploy".to_string(), "echo deploy".to_string(), false, None, Some(category_id.clone())).unwrap();
        let script_id = script["id"].as_str().unwrap().to_string();
        assert_eq!(script["category"].as_str(), Some(category_id.as_str()));

        let orphan = add_script("Orphan".to_string(), "echo orphan".to_string(), false, None, Some("missing".to_string())).unwrap();
        assert!(orphan["category"].is_null(), "unknown categories are dropped");

        update_script_category(category_id.clone(), "Deployments".to_string(), "rocket".to_string()).unwrap();
        let categories = list_script_categories().unwrap();
        let updated = categories.as_array().unwrap().iter().find(|c| c["id"] == category_id).unwrap();
        assert_eq!(updated["name"].as_str(), Some("Deployments"));
        assert_eq!(updated["icon"].as_str(), Some("rocket"));

        remove_script_category(category_id.clone()).unwrap();
        let scripts = list_scripts().unwrap();
        let kept = scripts.as_array().unwrap().iter().find(|s| s["id"] == script_id).expect("script survives its category");
        assert!(kept["category"].is_null(), "script should become uncategorized");

        let _ = remove_script(script_id);
        let _ = remove_script(orphan["id"].as_str().unwrap().to_string());
    }

    #[test]
    fn test_layout_and_collapsed_state_persist() {
        let _guard = lock_config();
        let ids = |value: serde_json::Value| -> Vec<String> {
            value.as_array().unwrap().iter().map(|v| v["id"].as_str().unwrap().to_string()).collect()
        };
        let first = add_script_category("Layout A".to_string(), "cpu".to_string()).unwrap()["id"].as_str().unwrap().to_string();
        let second = add_script_category("Layout B".to_string(), "wifi".to_string()).unwrap()["id"].as_str().unwrap().to_string();
        let one = add_script("One".to_string(), "echo 1".to_string(), false, None, Some(first.clone())).unwrap()["id"].as_str().unwrap().to_string();
        let two = add_script("Two".to_string(), "echo 2".to_string(), false, None, Some(first.clone())).unwrap()["id"].as_str().unwrap().to_string();
        let three = add_script("Three".to_string(), "echo 3".to_string(), false, None, None).unwrap()["id"].as_str().unwrap().to_string();

        // B before A, "two" first and moved to B, "three" not mentioned at all
        set_script_layout(
            vec![second.clone(), first.clone()],
            vec![
                ScriptPlacement { id: two.clone(), category: Some(second.clone()) },
                ScriptPlacement { id: one.clone(), category: Some(first.clone()) },
            ],
        )
        .unwrap();

        // everything is read back from disk, as after a restart
        let categories = ids(list_script_categories().unwrap());
        let position = |id: &String| categories.iter().position(|c| c == id).unwrap();
        assert!(position(&second) < position(&first), "category order should be stored");

        let scripts = list_scripts().unwrap();
        let script_ids = ids(scripts.clone());
        let script_position = |id: &String| script_ids.iter().position(|s| s == id).unwrap();
        assert!(script_position(&two) < script_position(&one), "script order should be stored");
        assert!(script_ids.contains(&three), "scripts missing from the layout are kept");
        let moved = scripts.as_array().unwrap().iter().find(|s| s["id"] == two.as_str()).unwrap();
        assert_eq!(moved["category"].as_str(), Some(second.as_str()));

        set_script_group_collapsed(second.clone(), true).unwrap();
        set_script_group_collapsed("uncategorized".to_string(), true).unwrap();
        set_script_group_collapsed(second.clone(), true).unwrap();
        let mut collapsed: Vec<String> = serde_json::from_value(get_collapsed_script_groups().unwrap()).unwrap();
        collapsed.sort();
        let mut expected = vec![second.clone(), "uncategorized".to_string()];
        expected.sort();
        assert_eq!(collapsed, expected, "collapsing twice must not duplicate the entry");

        set_script_group_collapsed("uncategorized".to_string(), false).unwrap();
        remove_script_category(second.clone()).unwrap();
        assert_eq!(get_collapsed_script_groups().unwrap(), json!([]), "deleted categories leave no stale state");

        remove_script_category(first).unwrap();
        for id in [one, two, three] {
            let _ = remove_script(id);
        }
    }

    #[test]
    fn test_loads_config_written_before_categories() {
        let config: ScriptsConfig = serde_yaml::from_str(
            "scripts:\n- id: script_1\n  name: Old\n  command: echo old\n  requires_sudo: false\n  prompts: []\n",
        )
        .unwrap();
        assert!(config.categories.is_empty());
        assert_eq!(config.scripts[0].category, None);
        assert!(!serde_yaml::to_string(&config).unwrap().contains("category"), "old files should round-trip unchanged");
    }

    #[test]
    fn test_run_nonexistent_script() {
        let _guard = lock_config();
        let result = run_script("nonexistent_id_xyz".to_string(), None);
        assert!(result.is_err(), "running nonexistent script should return error");
    }

    #[test]
    fn test_remove_nonexistent_script_is_ok() {
        let _guard = lock_config();
        // retain() silently no-ops when the id isn't found
        let result = remove_script("nonexistent_id_xyz".to_string());
        assert!(result.is_ok(), "remove_script on nonexistent id should not error");
    }
}

#[tauri::command(async)]
pub fn list_scripts() -> Result<serde_json::Value, String> {
    let config = load_config()?;
    Ok(json!(config.scripts))
}

#[tauri::command(async)]
pub fn add_script(
    name: String,
    command: String,
    requires_sudo: bool,
    prompts: Option<Vec<ScriptPrompt>>,
    category: Option<String>,
) -> Result<serde_json::Value, String> {
    let _guard = lock_config_write();
    let mut config = load_config()?;

    let script = CustomScript {
        id: unique_id("script", |id| config.scripts.iter().any(|s| s.id == id)),
        name,
        command,
        requires_sudo,
        prompts: prompts.unwrap_or_default(),
        category: known_category(&config, category),
    };

    config.scripts.push(script.clone());
    save_config(&config)?;

    Ok(json!(script))
}

#[tauri::command(async)]
pub fn remove_script(id: String) -> Result<serde_json::Value, String> {
    let _guard = lock_config_write();
    let mut config = load_config()?;
    config.scripts.retain(|s| s.id != id);
    save_config(&config)?;
    Ok(json!({"success": true}))
}

#[tauri::command(async)]
pub fn update_script(
    id: String,
    name: String,
    command: String,
    requires_sudo: bool,
    prompts: Option<Vec<ScriptPrompt>>,
    category: Option<String>,
) -> Result<serde_json::Value, String> {
    let _guard = lock_config_write();
    let mut config = load_config()?;
    let category = known_category(&config, category);

    if let Some(script) = config.scripts.iter_mut().find(|s| s.id == id) {
        script.name = name;
        script.command = command;
        script.requires_sudo = requires_sudo;
        script.prompts = prompts.unwrap_or_default();
        script.category = category;
        save_config(&config)?;
        Ok(json!({"success": true}))
    } else {
        Err("Script not found".to_string())
    }
}

fn validated_category_name(config: &ScriptsConfig, name: &str, own_id: Option<&str>) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Category name cannot be empty".to_string());
    }
    let duplicate = config
        .categories
        .iter()
        .any(|c| Some(c.id.as_str()) != own_id && c.name.eq_ignore_ascii_case(name));
    if duplicate {
        return Err(format!("A category named {} already exists", name));
    }
    Ok(name.to_string())
}

#[tauri::command(async)]
pub fn list_script_categories() -> Result<serde_json::Value, String> {
    let config = load_config()?;
    Ok(json!(config.categories))
}

#[tauri::command(async)]
pub fn add_script_category(name: String, icon: String) -> Result<serde_json::Value, String> {
    let _guard = lock_config_write();
    let mut config = load_config()?;

    let category = ScriptCategory {
        id: unique_id("category", |id| config.categories.iter().any(|c| c.id == id)),
        name: validated_category_name(&config, &name, None)?,
        icon,
    };

    config.categories.push(category.clone());
    save_config(&config)?;

    Ok(json!(category))
}

#[tauri::command(async)]
pub fn update_script_category(id: String, name: String, icon: String) -> Result<serde_json::Value, String> {
    let _guard = lock_config_write();
    let mut config = load_config()?;
    let name = validated_category_name(&config, &name, Some(&id))?;

    let category = config
        .categories
        .iter_mut()
        .find(|c| c.id == id)
        .ok_or_else(|| "Category not found".to_string())?;
    category.name = name;
    category.icon = icon;
    save_config(&config)?;

    Ok(json!({"success": true}))
}

/// Removes a category, its scripts are kept and become uncategorized.
#[tauri::command(async)]
pub fn remove_script_category(id: String) -> Result<serde_json::Value, String> {
    let _guard = lock_config_write();
    let mut config = load_config()?;

    config.categories.retain(|c| c.id != id);
    config.collapsed.retain(|c| c != &id);
    for script in config.scripts.iter_mut().filter(|s| s.category.as_deref() == Some(id.as_str())) {
        script.category = None;
    }
    save_config(&config)?;

    Ok(json!({"success": true}))
}

/// Stores the order of categories and scripts, and which category each script
/// belongs to, after a drag and drop.
#[tauri::command(async)]
pub fn set_script_layout(categories: Vec<String>, scripts: Vec<ScriptPlacement>) -> Result<serde_json::Value, String> {
    let _guard = lock_config_write();
    let mut config = load_config()?;

    apply_order(&mut config.categories, &categories, |c| &c.id);

    for placement in &scripts {
        let category = known_category(&config, placement.category.clone());
        if let Some(script) = config.scripts.iter_mut().find(|s| s.id == placement.id) {
            script.category = category;
        }
    }
    let script_order: Vec<String> = scripts.into_iter().map(|p| p.id).collect();
    apply_order(&mut config.scripts, &script_order, |s| &s.id);

    save_config(&config)?;
    Ok(json!({"success": true}))
}

#[tauri::command(async)]
pub fn get_collapsed_script_groups() -> Result<serde_json::Value, String> {
    let config = load_config()?;
    Ok(json!(config.collapsed))
}

#[tauri::command(async)]
pub fn set_script_group_collapsed(id: String, collapsed: bool) -> Result<serde_json::Value, String> {
    let _guard = lock_config_write();
    let mut config = load_config()?;

    config.collapsed.retain(|c| c != &id);
    if collapsed {
        config.collapsed.push(id);
    }

    save_config(&config)?;
    Ok(json!({"success": true}))
}

#[cfg(target_os = "linux")]
fn run_privileged(command: &str) -> std::io::Result<std::process::Output> {
    Command::new("pkexec")
        .arg("sh")
        .arg("-c")
        .arg(command)
        .output()
}

#[cfg(target_os = "macos")]
fn run_privileged(command: &str) -> std::io::Result<std::process::Output> {
    let escaped = command.replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!(
        "do shell script \"{}\" with administrator privileges",
        escaped
    );
    Command::new("osascript").arg("-e").arg(&script).output()
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn run_privileged(command: &str) -> std::io::Result<std::process::Output> {
    Command::new("sh").arg("-c").arg(command).output()
}

#[tauri::command(async)]
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
        run_privileged(&command)
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
