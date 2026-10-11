use serde::Serialize;
use serde_json::json;
use std::collections::HashMap;
#[cfg(target_os = "linux")]
use std::fs;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

static PROCESS_SYSTEM: OnceLock<Mutex<System>> = OnceLock::new();

const TERMINATE_GRACE: Duration = Duration::from_secs(2);
const TERMINATE_POLL: Duration = Duration::from_millis(100);

// Only what the process list shows is refreshed: no command lines, environment
// or per-thread entries.
fn refresh_processes(sys: &mut System) {
    let kind = ProcessRefreshKind::nothing()
        .with_cpu()
        .with_memory()
        .with_exe(UpdateKind::OnlyIfNotSet)
        .without_tasks();
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, kind);
}

// CPU usage is the delta between two refreshes of the same System, so the
// instance is kept around and primed with a first pair of refreshes.
fn get_process_system() -> &'static Mutex<System> {
    PROCESS_SYSTEM.get_or_init(|| {
        let mut sys = System::new();
        refresh_processes(&mut sys);
        std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
        Mutex::new(sys)
    })
}

#[cfg(target_os = "linux")]
fn page_size() -> u64 {
    static PAGE_SIZE: OnceLock<u64> = OnceLock::new();
    *PAGE_SIZE.get_or_init(|| {
        let size = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
        if size > 0 { size as u64 } else { 4096 }
    })
}

#[cfg(target_os = "linux")]
fn get_process_private_mem(pid: u32) -> Option<u64> {
    let content = fs::read_to_string(format!("/proc/{}/statm", pid)).ok()?;
    let parts: Vec<&str> = content.split_whitespace().collect();
    if parts.len() >= 3 {
        let resident: u64 = parts[1].parse().ok()?;
        let shared: u64 = parts[2].parse().ok()?;
        let private_pages = resident.saturating_sub(shared);
        return Some(private_pages * page_size());
    }
    None
}

#[cfg(target_os = "macos")]
fn get_process_private_mem(_pid: u32) -> Option<u64> {
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

#[tauri::command(async)]
pub fn list_processes() -> Result<serde_json::Value, String> {
    let mut sys = get_process_system().lock().unwrap_or_else(|e| e.into_inner());
    refresh_processes(&mut sys);

    let mut entries: Vec<ProcessEntry> = Vec::new();

    for (pid, process) in sys.processes() {
        let pid_u32 = pid.as_u32();

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
            procs.sort_by_key(|p| std::cmp::Reverse(p.memory));
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

    result.sort_by_key(|g| std::cmp::Reverse(g.total_memory));

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

    #[cfg(target_os = "linux")]
    #[test]
    fn test_get_process_private_mem_pid1() {
        let result = get_process_private_mem(1);
        if let Some(mem) = result {
            assert!(mem > 0, "private memory for PID 1 should be > 0");
        }
    }

    #[test]
    fn test_terminate_stops_a_child_process() {
        let mut child = std::process::Command::new("sleep").arg("60").spawn().expect("spawn sleep");
        let pid = child.id();
        // reap in the background, a zombie would still count as alive
        let reaper = std::thread::spawn(move || child.wait());

        let started = std::time::Instant::now();
        assert!(kill_process(pid).is_ok());
        assert!(started.elapsed() < TERMINATE_GRACE, "SIGTERM should be enough for sleep");

        let status = reaper.join().unwrap().unwrap();
        assert!(!status.success(), "child should have been terminated by a signal");
    }

    #[test]
    fn test_kill_rejects_group_pids() {
        assert!(kill_process(0).is_err(), "PID 0 addresses the whole process group");
        assert!(kill_process(u32::MAX).is_err(), "PID must fit a positive pid_t");
    }

    #[test]
    fn test_kill_missing_process_is_ok() {
        assert!(kill_process_group(vec![i32::MAX as u32 - 1]).is_ok(), "an already gone process is not an error");
    }

    #[test]
    fn test_list_processes_reports_cpu_usage() {
        let mut burner = std::process::Command::new("sh")
            .args(["-c", "while :; do :; done"])
            .spawn()
            .expect("spawn busy loop");
        let pid = burner.id() as u64;

        let _ = list_processes();
        std::thread::sleep(Duration::from_millis(600));
        let groups = list_processes().unwrap();
        let _ = burner.kill();
        let _ = burner.wait();

        let cpu = groups
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|g| g["processes"].as_array().unwrap().iter())
            .find(|p| p["pid"].as_u64() == Some(pid))
            .and_then(|p| p["cpu"].as_f64())
            .expect("busy loop should be listed");
        assert!(cpu > 10.0, "a busy loop should show CPU usage, got {}", cpu);
    }

    #[test]
    fn test_list_processes_has_no_thread_entries() {
        let groups = list_processes().unwrap();
        let pids: Vec<u64> = groups
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|g| g["processes"].as_array().unwrap().iter())
            .filter_map(|p| p["pid"].as_u64())
            .collect();
        let unique: std::collections::HashSet<&u64> = pids.iter().collect();
        assert_eq!(unique.len(), pids.len(), "each process should be listed once");

        #[cfg(target_os = "linux")]
        for pid in &pids {
            // threads have no directory of their own at the top of /proc
            let listed = std::fs::read_dir("/proc").unwrap().flatten().any(|e| e.file_name().to_string_lossy() == pid.to_string());
            let gone = !std::path::Path::new(&format!("/proc/{}", pid)).exists();
            assert!(listed || gone, "PID {} is a thread, not a process", pid);
        }
    }
}

fn signal_target(pid: u32) -> Result<libc::pid_t, String> {
    // 0 and negative values address whole process groups, never pass them on
    libc::pid_t::try_from(pid)
        .ok()
        .filter(|target| *target > 0)
        .ok_or_else(|| format!("Invalid PID {}", pid))
}

fn send_signal(target: libc::pid_t, signal: libc::c_int) -> std::io::Result<()> {
    if unsafe { libc::kill(target, signal) } == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

fn is_gone(target: libc::pid_t) -> bool {
    matches!(send_signal(target, 0), Err(e) if e.raw_os_error() == Some(libc::ESRCH))
}

fn wait_until_gone(targets: &[libc::pid_t]) -> Vec<libc::pid_t> {
    let mut remaining: Vec<libc::pid_t> = targets.to_vec();
    let mut waited = Duration::ZERO;
    loop {
        remaining.retain(|target| !is_gone(*target));
        if remaining.is_empty() || waited >= TERMINATE_GRACE {
            return remaining;
        }
        std::thread::sleep(TERMINATE_POLL);
        waited += TERMINATE_POLL;
    }
}

/// Asks the processes to exit with SIGTERM and only falls back to SIGKILL for
/// the ones still around after the grace period. Returns one error per PID
/// that could not be signalled.
fn terminate(pids: &[u32]) -> Vec<String> {
    let mut errors = Vec::new();
    let mut signalled = Vec::new();

    for pid in pids {
        let outcome = signal_target(*pid).and_then(|target| match send_signal(target, libc::SIGTERM) {
            Ok(()) => Ok(Some(target)),
            Err(e) if e.raw_os_error() == Some(libc::ESRCH) => Ok(None),
            Err(e) => Err(e.to_string()),
        });
        match outcome {
            Ok(Some(target)) => signalled.push(target),
            Ok(None) => {}
            Err(e) => errors.push(format!("PID {}: {}", pid, e)),
        }
    }

    for target in wait_until_gone(&signalled) {
        if let Err(e) = send_signal(target, libc::SIGKILL) {
            if e.raw_os_error() != Some(libc::ESRCH) {
                errors.push(format!("PID {}: {}", target, e));
            }
        }
    }

    errors
}

#[tauri::command(async)]
pub fn kill_process(pid: u32) -> Result<String, String> {
    match terminate(&[pid]).pop() {
        None => Ok(format!("Process {} terminated", pid)),
        Some(error) => Err(format!("Failed to terminate process: {}", error)),
    }
}

#[tauri::command(async)]
pub fn kill_process_group(pids: Vec<u32>) -> Result<String, String> {
    let errors = terminate(&pids);
    if errors.is_empty() {
        Ok(format!("Terminated {} processes", pids.len()))
    } else {
        Err(format!(
            "Terminated {} of {} processes. {}",
            pids.len() - errors.len(),
            pids.len(),
            errors.join("; ")
        ))
    }
}
