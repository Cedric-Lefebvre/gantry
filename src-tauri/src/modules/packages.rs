//! Package maintenance for pacman based distributions: pending updates,
//! orphaned packages, the package cache and unmerged configuration files.

use serde::Serialize;
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const PACMAN_CONF: &str = "/etc/pacman.conf";
const DEFAULT_CACHE_DIR: &str = "/var/cache/pacman/pkg/";
const CACHE_VERSIONS_KEPT: &str = "3";
const CONFIG_SCAN_DEPTH: usize = 6;

#[derive(Debug, PartialEq, Serialize)]
struct PackageUpdate {
    name: String,
    current: String,
    new: String,
}

#[derive(Debug, PartialEq, Serialize)]
struct InstalledPackage {
    name: String,
    version: String,
}

// "name 1.0-1 -> 1.1-1", the format of both checkupdates and pacman -Qu
fn parse_updates(output: &str) -> Vec<PackageUpdate> {
    output
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split_whitespace().collect();
            match parts.as_slice() {
                [name, current, "->", new, ..] => Some(PackageUpdate {
                    name: name.to_string(),
                    current: current.to_string(),
                    new: new.to_string(),
                }),
                _ => None,
            }
        })
        .collect()
}

fn parse_installed(output: &str) -> Vec<InstalledPackage> {
    output
        .lines()
        .filter_map(|line| {
            let (name, version) = line.trim().split_once(' ')?;
            Some(InstalledPackage { name: name.to_string(), version: version.trim().to_string() })
        })
        .collect()
}

fn cache_dir_from_conf(conf: &str) -> String {
    conf.lines()
        .map(str::trim)
        .filter(|line| !line.starts_with('#'))
        .filter_map(|line| line.split_once('='))
        .find(|(key, _)| key.trim() == "CacheDir")
        .map(|(_, value)| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_CACHE_DIR.to_string())
}

fn cache_dir() -> String {
    fs::read_to_string(PACMAN_CONF)
        .map(|conf| cache_dir_from_conf(&conf))
        .unwrap_or_else(|_| DEFAULT_CACHE_DIR.to_string())
}

fn is_package_file(name: &str) -> bool {
    name.contains(".pkg.tar") && !name.ends_with(".sig")
}

fn cache_usage(dir: &Path) -> (u64, usize) {
    let mut size = 0;
    let mut packages = 0;

    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let Ok(metadata) = entry.metadata() else { continue };
            if !metadata.is_file() {
                continue;
            }
            size += metadata.len();
            if is_package_file(&entry.file_name().to_string_lossy()) {
                packages += 1;
            }
        }
    }

    (size, packages)
}

fn is_unmerged_config(path: &Path) -> bool {
    path.extension().is_some_and(|ext| ext == "pacnew" || ext == "pacsave")
}

fn find_unmerged_configs(dir: &Path, depth: usize, found: &mut Vec<PathBuf>) {
    if depth == 0 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else { return };

    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else { continue };
        let path = entry.path();
        if file_type.is_dir() {
            find_unmerged_configs(&path, depth - 1, found);
        } else if file_type.is_file() && is_unmerged_config(&path) {
            found.push(path);
        }
    }
}

fn orphans() -> Vec<InstalledPackage> {
    // pacman exits with 1 when there are no orphans
    Command::new("pacman")
        .args(["-Qdt"])
        .output()
        .map(|out| parse_installed(&String::from_utf8_lossy(&out.stdout)))
        .unwrap_or_default()
}

#[tauri::command(async)]
pub fn get_package_maintenance() -> Result<serde_json::Value, String> {
    let cache_path = cache_dir();
    let (cache_size, cache_packages) = cache_usage(Path::new(&cache_path));

    let mut unmerged = Vec::new();
    find_unmerged_configs(Path::new("/etc"), CONFIG_SCAN_DEPTH, &mut unmerged);
    unmerged.sort();

    Ok(json!({
        "orphans": orphans(),
        "cache": {
            "path": cache_path,
            "size": cache_size,
            "packages": cache_packages,
        },
        "unmerged_configs": unmerged.iter().map(|p| p.to_string_lossy()).collect::<Vec<_>>(),
    }))
}

/// Lists pending updates. `checkupdates` (pacman-contrib) syncs a private copy
/// of the databases, so the result is current without touching the system;
/// without it the answer is only as fresh as the last `pacman -Sy`.
#[tauri::command(async)]
pub fn list_package_updates() -> Result<serde_json::Value, String> {
    match Command::new("checkupdates").output() {
        Ok(out) => match out.status.code() {
            Some(0) | Some(2) => Ok(json!({
                "updates": parse_updates(&String::from_utf8_lossy(&out.stdout)),
                "fresh": true,
            })),
            _ => Err(format!("checkupdates failed: {}", String::from_utf8_lossy(&out.stderr).trim())),
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let out = Command::new("pacman").args(["-Qu"]).output().map_err(|e| e.to_string())?;
            Ok(json!({
                "updates": parse_updates(&String::from_utf8_lossy(&out.stdout)),
                "fresh": false,
            }))
        }
        Err(e) => Err(format!("Failed to run checkupdates: {}", e)),
    }
}

fn run_as_root(program: &str, args: &[&str]) -> Result<serde_json::Value, String> {
    let output = Command::new("pkexec").arg(program).args(args).output().map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

    if output.status.success() {
        Ok(json!({"success": true, "output": stdout}))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if stderr.is_empty() { stdout } else { stderr })
    }
}

#[tauri::command(async)]
pub fn remove_orphan_packages() -> Result<serde_json::Value, String> {
    let names: Vec<String> = orphans().into_iter().map(|pkg| pkg.name).collect();
    if names.is_empty() {
        return Ok(json!({"success": true, "output": "No orphaned packages"}));
    }

    let mut args = vec!["-Rns", "--noconfirm", "--"];
    args.extend(names.iter().map(String::as_str));
    run_as_root("pacman", &args)
}

/// Prunes the package cache, keeping the most recent versions of each package
/// when `paccache` (pacman-contrib) is available.
#[tauri::command(async)]
pub fn clean_package_cache() -> Result<serde_json::Value, String> {
    let has_paccache = Command::new("paccache").arg("--help").output().is_ok();
    if has_paccache {
        run_as_root("paccache", &["-r", "-k", CACHE_VERSIONS_KEPT])
    } else {
        run_as_root("pacman", &["-Sc", "--noconfirm"])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_updates() {
        let output = "linux 6.9.1.arch1-1 -> 6.9.2.arch1-1\nfirefox 126.0-1 -> 127.0-1\n:: some notice\n";
        assert_eq!(
            parse_updates(output),
            vec![
                PackageUpdate { name: "linux".into(), current: "6.9.1.arch1-1".into(), new: "6.9.2.arch1-1".into() },
                PackageUpdate { name: "firefox".into(), current: "126.0-1".into(), new: "127.0-1".into() },
            ]
        );
        assert!(parse_updates("").is_empty());
    }

    #[test]
    fn test_parse_installed() {
        assert_eq!(
            parse_installed("gtk2 2.24.33-5\nlib32-foo 1:1.0-2\n"),
            vec![
                InstalledPackage { name: "gtk2".into(), version: "2.24.33-5".into() },
                InstalledPackage { name: "lib32-foo".into(), version: "1:1.0-2".into() },
            ]
        );
        assert!(parse_installed("").is_empty());
    }

    #[test]
    fn test_cache_dir_from_conf() {
        assert_eq!(cache_dir_from_conf("[options]\n#CacheDir    = /var/cache/pacman/pkg/\n"), DEFAULT_CACHE_DIR);
        assert_eq!(cache_dir_from_conf("[options]\nCacheDir = /mnt/cache/\n"), "/mnt/cache/");
    }

    #[test]
    fn test_cache_usage_and_unmerged_configs() {
        let root = super::super::paths::app_dir().join("packages");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("nested")).unwrap();
        fs::write(root.join("foo-1.0-1-x86_64.pkg.tar.zst"), [0u8; 100]).unwrap();
        fs::write(root.join("foo-1.0-1-x86_64.pkg.tar.zst.sig"), [0u8; 10]).unwrap();
        fs::write(root.join("nested").join("pacman.conf.pacnew"), "x").unwrap();
        fs::write(root.join("nested").join("pacman.conf"), "x").unwrap();

        assert_eq!(cache_usage(&root), (110, 1));

        let mut found = Vec::new();
        find_unmerged_configs(&root, CONFIG_SCAN_DEPTH, &mut found);
        assert_eq!(found, vec![root.join("nested").join("pacman.conf.pacnew")]);

        let mut shallow = Vec::new();
        find_unmerged_configs(&root, 1, &mut shallow);
        assert!(shallow.is_empty(), "depth limit should stop the scan");
    }

    #[test]
    fn test_get_package_maintenance_structure() {
        let result = get_package_maintenance().unwrap();
        assert!(result["orphans"].is_array());
        assert!(result["unmerged_configs"].is_array());
        assert!(result["cache"]["size"].is_u64());
    }
}
