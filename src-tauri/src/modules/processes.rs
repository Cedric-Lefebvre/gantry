use serde::Serialize;
use serde_json::json;
use std::collections::HashMap;
use std::fs;
use std::process::Command;
use sysinfo::{System, RefreshKind, ProcessRefreshKind};

fn is_thread_group_leader(pid: u32) -> bool {
    if let Ok(content) = fs::read_to_string(format!("/proc/{}/status", pid)) {
        for line in content.lines() {
            if line.starts_with("Tgid:") {
                if let Some(tgid) = line.split_whitespace().nth(1).and_then(|s| s.parse::<u32>().ok()) {
                    return tgid == pid;
                }
            }
        }
    }
    true
}

fn get_process_private_mem(pid: u32) -> Option<u64> {
    let content = fs::read_to_string(format!("/proc/{}/statm", pid)).ok()?;
    let parts: Vec<&str> = content.split_whitespace().collect();
    if parts.len() >= 3 {
        let resident: u64 = parts[1].parse().ok()?;
        let shared: u64 = parts[2].parse().ok()?;
        let private_pages = resident.saturating_sub(shared);
        return Some(private_pages * 4096);
    }
    None
}

#[derive(Serialize)]
struct ProcessEntry {
    pid: u32,
    parent_pid: Option<u32>,
    name: String,
    exe: String,
    cpu: f64,
    memory: u64,
    status: String,
}

#[derive(Serialize)]
struct ProcessGroup {
    name: String,
    icon: String,
    total_cpu: f64,
    total_memory: u64,
    count: usize,
    main_pid: u32,
    processes: Vec<ProcessEntry>,
}

fn detect_app_name(name: &str, exe: &str) -> (String, String) {
    let lower_name = name.to_lowercase();
    let lower_exe = exe.to_lowercase();

    let known_apps: &[(&[&str], &str, &str)] = &[
        (&["code", "code-oss"], "Visual Studio Code", "code"),
        (&["firefox", "firefox-esr"], "Firefox", "firefox"),
        (&["chrome", "chromium", "google-chrome"], "Google Chrome", "chrome"),
        (&["brave"], "Brave Browser", "brave"),
        (&["electron"], "Electron App", "electron"),
        (&["slack"], "Slack", "slack"),
        (&["discord"], "Discord", "discord"),
        (&["spotify"], "Spotify", "spotify"),
        (&["telegram", "telegram-desktop"], "Telegram", "telegram"),
        (&["signal"], "Signal", "signal"),
        (&["thunderbird"], "Thunderbird", "thunderbird"),
        (&["gimp"], "GIMP", "gimp"),
        (&["inkscape"], "Inkscape", "inkscape"),
        (&["blender"], "Blender", "blender"),
        (&["obs", "obs-studio"], "OBS Studio", "obs"),
        (&["vlc"], "VLC", "vlc"),
        (&["steam"], "Steam", "steam"),
        (&["lutris"], "Lutris", "lutris"),
        (&["docker", "dockerd", "containerd"], "Docker", "docker"),
        (&["node", "nodejs", "npm", "npx"], "Node.js", "node"),
        (&["python", "python3"], "Python", "python"),
        (&["java"], "Java", "java"),
        (&["rustc", "cargo"], "Rust", "rust"),
        (&["gnome-shell"], "GNOME Shell", "gnome"),
        (&["kwin", "plasmashell"], "KDE Plasma", "kde"),
        (&["nautilus"], "Files", "nautilus"),
        (&["gnome-terminal", "tilix", "alacritty", "kitty", "wezterm", "konsole"], "Terminal", "terminal"),
        (&["pipewire", "pulseaudio", "wireplumber"], "Audio", "audio"),
        (&["xorg", "xwayland", "mutter"], "Display Server", "display"),
    ];

    for (patterns, display_name, icon) in known_apps {
        for pattern in *patterns {
            if lower_name == *pattern || lower_exe.contains(pattern) {
                return (display_name.to_string(), icon.to_string());
            }
        }
    }

    (name.to_string(), "default".to_string())
}

#[tauri::command]
pub fn list_processes() -> Result<serde_json::Value, String> {
    let sys = System::new_with_specifics(
        RefreshKind::new().with_processes(ProcessRefreshKind::everything())
    );

    let mut entries: Vec<ProcessEntry> = Vec::new();

    for (pid, process) in sys.processes() {
        let pid_u32 = pid.as_u32();

        if !is_thread_group_leader(pid_u32) {
            continue;
        }

        let cpu_usage = process.cpu_usage() as f64;
        let cpu_value = if cpu_usage.is_finite() { cpu_usage } else { 0.0 };
        let name = process.name().to_string_lossy().to_string();
        let exe = process.exe().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
        let parent_pid = process.parent().map(|p| p.as_u32());
        let memory = get_process_private_mem(pid_u32).unwrap_or_else(|| process.memory());

        entries.push(ProcessEntry {
            pid: pid_u32,
            parent_pid,
            name,
            exe,
            cpu: cpu_value,
            memory,
            status: format!("{:?}", process.status()),
        });
    }

    let mut groups: HashMap<String, (String, Vec<ProcessEntry>)> = HashMap::new();
    for entry in entries {
        let (app_name, icon) = detect_app_name(&entry.name, &entry.exe);
        let slot = groups.entry(app_name).or_insert_with(|| (icon, Vec::new()));
        slot.1.push(entry);
    }

    let mut result: Vec<ProcessGroup> = groups
        .into_iter()
        .map(|(name, (icon, mut procs))| {
            procs.sort_by(|a, b| b.memory.cmp(&a.memory));
            let total_cpu: f64 = procs.iter().map(|p| p.cpu).sum();
            let total_memory: u64 = procs.iter().map(|p| p.memory).sum();
            let count = procs.len();
            let main_pid = procs[0].pid;

            ProcessGroup {
                name,
                icon,
                total_cpu,
                total_memory,
                count,
                main_pid,
                processes: procs,
            }
        })
        .collect();

    result.sort_by(|a, b| b.total_memory.cmp(&a.total_memory));

    Ok(serde_json::to_value(result).unwrap_or(json!([])))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_list_processes_returns_data() {
        let result = list_processes();
        assert!(result.is_ok(), "list_processes failed: {:?}", result.err());
        let procs = result.unwrap();
        let arr = procs.as_array().expect("processes should be an array");
        assert!(!arr.is_empty(), "should have at least one process group");
    }

    #[test]
    fn test_list_processes_group_structure() {
        let result = list_processes().unwrap();
        let arr = result.as_array().unwrap();
        for group in arr {
            assert!(group["name"].as_str().is_some(), "group should have a name");
            assert!(group["main_pid"].as_u64().is_some(), "group should have main_pid");
            assert!(group["count"].as_u64().unwrap_or(0) > 0, "group count should be > 0");
            assert!(group["total_memory"].as_u64().is_some(), "group should have total_memory");
            assert!(group["total_cpu"].as_f64().is_some(), "group should have total_cpu");
            let processes = group["processes"].as_array().expect("group should have processes array");
            assert!(!processes.is_empty(), "group should have at least one process");
        }
    }

    #[test]
    fn test_list_processes_entry_fields() {
        let result = list_processes().unwrap();
        let arr = result.as_array().unwrap();
        for group in arr {
            for proc in group["processes"].as_array().unwrap() {
                let pid = proc["pid"].as_u64().expect("process should have a pid");
                assert!(pid > 0, "pid should be > 0");
                assert!(proc["name"].as_str().is_some(), "process should have a name");
                let cpu = proc["cpu"].as_f64().expect("process should have cpu field");
                assert!(cpu >= 0.0, "cpu should be >= 0, got {}", cpu);
            }
        }
    }

    #[test]
    fn test_list_processes_sorted_by_memory() {
        let result = list_processes().unwrap();
        let arr = result.as_array().unwrap();
        let memories: Vec<u64> = arr.iter()
            .map(|g| g["total_memory"].as_u64().unwrap_or(0))
            .collect();
        let mut sorted = memories.clone();
        sorted.sort_by(|a, b| b.cmp(a));
        assert_eq!(memories, sorted, "process groups should be sorted by memory descending");
    }

    #[test]
    fn test_get_process_private_mem_pid1() {
        // PID 1 always exists on Linux; may be None if unreadable (permissions OK)
        let result = get_process_private_mem(1);
        if let Some(mem) = result {
            assert!(mem > 0, "private memory for PID 1 should be > 0");
        }
    }

    #[test]
    fn test_is_thread_group_leader_self() {
        let pid = std::process::id();
        assert!(is_thread_group_leader(pid), "current process should be a thread group leader");
    }
}

#[tauri::command]
pub fn kill_process(pid: u32) -> Result<String, String> {
    let output = Command::new("kill")
        .arg("-9")
        .arg(pid.to_string())
        .output()
        .map_err(|e| format!("Failed to kill process: {}", e))?;

    if output.status.success() {
        Ok(format!("Process {} terminated", pid))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Failed to kill process {}: {}", pid, stderr))
    }
}

#[tauri::command]
pub fn kill_process_group(pids: Vec<u32>) -> Result<String, String> {
    let mut killed = 0;
    let mut errors = Vec::new();

    for pid in &pids {
        let output = Command::new("kill")
            .arg("-9")
            .arg(pid.to_string())
            .output();

        match output {
            Ok(o) if o.status.success() => killed += 1,
            Ok(o) => errors.push(format!("PID {}: {}", pid, String::from_utf8_lossy(&o.stderr))),
            Err(e) => errors.push(format!("PID {}: {}", pid, e)),
        }
    }

    if errors.is_empty() {
        Ok(format!("Terminated {} processes", killed))
    } else {
        Ok(format!("Terminated {} processes, {} failed", killed, errors.len()))
    }
}
