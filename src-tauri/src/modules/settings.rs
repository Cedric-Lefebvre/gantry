use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::io::Write;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppSettings {
    #[serde(default = "default_theme")]
    pub theme: String,
}

fn default_theme() -> String {
    "light".to_string()
}

fn get_settings_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".gantry").join("settings.yaml")
}

fn ensure_config_dir() -> Result<(), String> {
    let settings_path = get_settings_path();
    if let Some(parent) = settings_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn load_settings() -> Result<AppSettings, String> {
    let settings_path = get_settings_path();
    if !settings_path.exists() {
        return Ok(AppSettings::default());
    }
    let content = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
    serde_yaml::from_str(&content).map_err(|e| e.to_string())
}

fn save_settings(settings: &AppSettings) -> Result<(), String> {
    ensure_config_dir()?;
    let settings_path = get_settings_path();
    let content = serde_yaml::to_string(settings).map_err(|e| e.to_string())?;
    let mut file = fs::File::create(&settings_path).map_err(|e| e.to_string())?;
    file.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_settings() -> Result<serde_json::Value, String> {
    let settings = load_settings()?;
    Ok(json!(settings))
}

#[tauri::command]
pub fn set_theme(theme: String) -> Result<serde_json::Value, String> {
    let mut settings = load_settings()?;
    settings.theme = theme;
    save_settings(&settings)?;
    Ok(json!({"success": true}))
}
