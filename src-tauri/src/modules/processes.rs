use serde::Serialize;
use serde_json::json;
use std::collections::HashMap;
use std::fs;
use std::process::Command;
use sysinfo::System;

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
        let page_size = 4096u64;
        let private_pages = resident.saturating_sub(shared);
        return Some(private_pages * page_size);
    }
    None
}

#[derive(Serialize, Clone)]
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
    let mut sys = System::new_all();
    sys.refresh_all();

    let mut entries: Vec<ProcessEntry> = Vec::new();

    for (pid, process) in sys.processes() {
        let cpu_usage = process.cpu_usage() as f64;
        let cpu_value = if cpu_usage.is_finite() { cpu_usage } else { 0.0 };
        let name = process.name().to_string_lossy().to_string();
        let exe = process.exe().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
        let parent_pid = process.parent().map(|p| p.as_u32());

        let pid_u32 = pid.as_u32();

        // Skip threads - only count thread group leaders (actual processes)
        if !is_thread_group_leader(pid_u32) {
            continue;
        }

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

    let mut groups: HashMap<String, Vec<ProcessEntry>> = HashMap::new();
    for entry in &entries {
        let (app_name, _) = detect_app_name(&entry.name, &entry.exe);
        groups.entry(app_name).or_default().push(entry.clone());
    }

    let mut result: Vec<ProcessGroup> = groups
        .into_iter()
        .map(|(name, mut procs)| {
            procs.sort_by(|a, b| b.memory.cmp(&a.memory));
            let total_cpu: f64 = procs.iter().map(|p| p.cpu).sum();
            let total_memory: u64 = procs.iter().map(|p| p.memory).sum();
            let count = procs.len();
            let main_pid = procs[0].pid;
            let (_, icon) = detect_app_name(&procs[0].name, &procs[0].exe);

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
