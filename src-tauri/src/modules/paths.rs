use std::path::{Path, PathBuf};

/// Moves the pre-0.3 `~/.gantry` directory to its new location. Returns the
/// directory to use, which stays the legacy one if the move is not possible.
fn migrate_legacy_dir(legacy: &Path, target: &Path) -> PathBuf {
    if target.exists() || !legacy.is_dir() {
        return target.to_path_buf();
    }

    let moved = target
        .parent()
        .map_or(Ok(()), std::fs::create_dir_all)
        .and_then(|_| std::fs::rename(legacy, target));

    match moved {
        Ok(()) => target.to_path_buf(),
        Err(_) => legacy.to_path_buf(),
    }
}

/// Directory holding Gantry's own files (scripts, settings, log):
/// `$XDG_CONFIG_HOME/gantry` on Linux, `~/Library/Application Support/gantry` on macOS.
#[cfg(not(test))]
pub fn app_dir() -> PathBuf {
    static APP_DIR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
    APP_DIR
        .get_or_init(|| {
            let legacy = dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")).join(".gantry");
            match dirs::config_dir() {
                Some(config) => migrate_legacy_dir(&legacy, &config.join("gantry")),
                None => legacy,
            }
        })
        .clone()
}

/// Tests get a throwaway directory so they never touch the user's real files.
#[cfg(test)]
pub fn app_dir() -> PathBuf {
    std::env::temp_dir().join(format!("gantry-test-{}", std::process::id()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn scratch(name: &str) -> PathBuf {
        let dir = app_dir().join("paths").join(name);
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn test_migrates_legacy_dir() {
        let root = scratch("migrate");
        let legacy = root.join(".gantry");
        let target = root.join("config").join("gantry");
        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join("scripts.yaml"), "scripts: []\n").unwrap();

        assert_eq!(migrate_legacy_dir(&legacy, &target), target);
        assert!(!legacy.exists(), "legacy directory should be moved away");
        assert_eq!(fs::read_to_string(target.join("scripts.yaml")).unwrap(), "scripts: []\n");
    }

    #[test]
    fn test_existing_target_is_left_alone() {
        let root = scratch("existing");
        let legacy = root.join(".gantry");
        let target = root.join("config").join("gantry");
        fs::create_dir_all(&legacy).unwrap();
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("settings.yaml"), "theme: dark\n").unwrap();

        assert_eq!(migrate_legacy_dir(&legacy, &target), target);
        assert!(legacy.exists(), "legacy directory must not be merged into an existing one");
        assert_eq!(fs::read_to_string(target.join("settings.yaml")).unwrap(), "theme: dark\n");
    }

    #[test]
    fn test_fresh_install_uses_target() {
        let root = scratch("fresh");
        let target = root.join("config").join("gantry");
        assert_eq!(migrate_legacy_dir(&root.join(".gantry"), &target), target);
    }
}
