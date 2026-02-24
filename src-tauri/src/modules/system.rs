use serde_json::json;
use sysinfo::{Disks, Networks, System};
use std::sync::Mutex;
use std::sync::OnceLock;
use std::process::Command;
use std::fs;

static SYSTEM: OnceLock<Mutex<System>> = OnceLock::new();
static NETWORKS: OnceLock<Mutex<Networks>> = OnceLock::new();
static DISKS: OnceLock<Mutex<Disks>> = OnceLock::new();
static CPU_MODEL: OnceLock<String> = OnceLock::new();

fn get_system() -> &'static Mutex<System> {
    SYSTEM.get_or_init(|| {
        let mut sys = System::new_all();
        sys.refresh_all();
        Mutex::new(sys)
    })
}

fn get_networks() -> &'static Mutex<Networks> {
    NETWORKS.get_or_init(|| {
        Mutex::new(Networks::new_with_refreshed_list())
    })
}

fn get_disks() -> &'static Mutex<Disks> {
    DISKS.get_or_init(|| {
        Mutex::new(Disks::new_with_refreshed_list())
    })
}

fn get_cpu_model() -> &'static str {
    CPU_MODEL.get_or_init(|| {
        if let Ok(content) = fs::read_to_string("/proc/cpuinfo") {
            for line in content.lines() {
                if line.starts_with("model name") {
                    if let Some(name) = line.split(':').nth(1) {
                        return name.trim().to_string();
                    }
                }
            }
        }
        "Unknown".to_string()
    })
}

#[tauri::command]
pub fn get_system_overview() -> Result<serde_json::Value, String> {
    let mut sys = get_system().lock().unwrap();
    sys.refresh_all();

    let cpus: Vec<_> = sys
        .cpus()
        .iter()
        .map(|p| json!({"name": p.name(), "usage": p.cpu_usage()}))
        .collect();

    let mem = json!({
        "total": sys.total_memory(),
        "used": sys.used_memory(),
        "swap_total": sys.total_swap(),
        "swap_used": sys.used_swap()
    });

    Ok(json!({"cpus": cpus, "memory": mem}))
}

fn get_gpu_name_from_pci(device_path: &std::path::Path) -> String {
    if let Ok(uevent) = fs::read_to_string(device_path.join("uevent")) {
        for line in uevent.lines() {
            if line.starts_with("PCI_SLOT_NAME=") {
                let slot = &line["PCI_SLOT_NAME=".len()..];
                if let Ok(output) = Command::new("lspci").arg("-s").arg(slot).output() {
                    let lspci_line = String::from_utf8_lossy(&output.stdout);
                    if let Some(pos) = lspci_line.find(": ") {
                        return lspci_line[pos + 2..].trim().to_string();
                    }
                }
            }
        }
    }
    "GPU".to_string()
}

fn get_gpu_info() -> serde_json::Value {
    let mut gpus = Vec::new();

    if let Ok(output) = Command::new("nvidia-smi")
        .args(["--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,fan.speed", "--format=csv,noheader,nounits"])
        .output()
    {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let parts: Vec<&str> = line.split(',').map(|s| s.trim()).collect();
                if parts.len() >= 5 {
                    gpus.push(json!({
                        "name": parts[0],
                        "vendor": "NVIDIA",
                        "usage": parts[1].parse::<f32>().ok(),
                        "memory_used": parts[2].parse::<u64>().unwrap_or(0) * 1024 * 1024,
                        "memory_total": parts[3].parse::<u64>().unwrap_or(0) * 1024 * 1024,
                        "temperature": parts[4].parse::<f32>().ok(),
                        "fan_speed": parts.get(5).and_then(|s| s.parse::<f32>().ok()),
                    }));
                }
            }
        }
    }

    if let Ok(entries) = fs::read_dir("/sys/class/drm") {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with("card") || name.contains('-') {
                continue;
            }

            let device_path = entry.path().join("device");
            let vendor_raw = fs::read_to_string(device_path.join("vendor")).unwrap_or_default();
            let vendor = vendor_raw.trim();

            match vendor {
                "0x1002" => {
                    let gpu_busy = fs::read_to_string(device_path.join("gpu_busy_percent"))
                        .ok().and_then(|s| s.trim().parse::<f32>().ok());
                    let vram_used = fs::read_to_string(device_path.join("mem_info_vram_used"))
                        .ok().and_then(|s| s.trim().parse::<u64>().ok());
                    let vram_total = fs::read_to_string(device_path.join("mem_info_vram_total"))
                        .ok().and_then(|s| s.trim().parse::<u64>().ok());

                    let mut temperature: Option<f32> = None;
                    let mut fan_rpm: Option<u32> = None;
                    if let Ok(hwmon_entries) = fs::read_dir(device_path.join("hwmon")) {
                        for hwmon_entry in hwmon_entries.flatten() {
                            let hwmon_dir = hwmon_entry.path();
                            if temperature.is_none() {
                                if let Ok(t) = fs::read_to_string(hwmon_dir.join("temp1_input")) {
                                    temperature = t.trim().parse::<f64>().ok().map(|v| (v / 1000.0) as f32);
                                }
                            }
                            if fan_rpm.is_none() {
                                if let Ok(f) = fs::read_to_string(hwmon_dir.join("fan1_input")) {
                                    fan_rpm = f.trim().parse().ok();
                                }
                            }
                        }
                    }

                    gpus.push(json!({
                        "name": get_gpu_name_from_pci(&device_path),
                        "vendor": "AMD",
                        "usage": gpu_busy,
                        "memory_used": vram_used,
                        "memory_total": vram_total,
                        "temperature": temperature,
                        "fan_speed": fan_rpm.map(|r| r as f32),
                    }));
                }
                "0x8086" => {
                    gpus.push(json!({
                        "name": get_gpu_name_from_pci(&device_path),
                        "vendor": "Intel",
                        "usage": null,
                        "memory_used": null,
                        "memory_total": null,
                        "temperature": null,
                        "fan_speed": null,
                    }));
                }
                _ => continue,
            }
        }
    }

    if gpus.is_empty() {
        json!(null)
    } else {
        json!(gpus)
    }
}

fn resolve_hwmon_device_name(hwmon_path: &std::path::Path, driver_name: &str) -> String {
    if driver_name == "nvme" {
        let path_str = fs::canonicalize(hwmon_path)
            .or_else(|_| fs::canonicalize(hwmon_path.join("device")))
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        for part in path_str.split('/') {
            if part.starts_with("nvme") && part.len() >= 5 {
                let suffix = &part[4..];
                if !suffix.is_empty() && suffix.chars().all(|c| c.is_ascii_digit()) {
                    let model_path = format!("/sys/class/nvme/{}/model", part);
                    if let Ok(model) = fs::read_to_string(model_path) {
                        let m = model.trim();
                        if !m.is_empty() {
                            return m.to_string();
                        }
                    }
                    return part.to_string();
                }
            }
        }
    }
    String::new()
}

fn get_thermal_info() -> (Vec<serde_json::Value>, Vec<serde_json::Value>) {
    let mut temps = Vec::new();
    let mut fans = Vec::new();

    if let Ok(entries) = fs::read_dir("/sys/class/hwmon") {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = fs::read_to_string(path.join("name")).unwrap_or_default().trim().to_string();
            let hwmon_id = path.file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            let device_name = resolve_hwmon_device_name(&path, &name);

            for i in 1..=32 {
                let input_path = path.join(format!("temp{}_input", i));
                if let Ok(raw_temp) = fs::read_to_string(&input_path) {
                    let temp_mc: f64 = raw_temp.trim().parse().unwrap_or(0.0);
                    let temp_c = temp_mc / 1000.0;
                    if temp_c > 0.0 && temp_c < 150.0 {
                        let label_path = path.join(format!("temp{}_label", i));
                        let label = fs::read_to_string(&label_path)
                            .map(|s| s.trim().to_string())
                            .unwrap_or_else(|_| format!("{} Sensor {}", name, i));
                        temps.push(json!({
                            "label": label,
                            "sensor": name,
                            "device_id": hwmon_id,
                            "device_name": device_name,
                            "celsius": (temp_c * 10.0).round() / 10.0,
                        }));
                    }
                }
            }

            for i in 1..=8 {
                let input_path = path.join(format!("fan{}_input", i));
                if let Ok(raw_rpm) = fs::read_to_string(&input_path) {
                    let rpm: u32 = raw_rpm.trim().parse().unwrap_or(0);
                    let label_path = path.join(format!("fan{}_label", i));
                    let label = fs::read_to_string(&label_path)
                        .map(|s| s.trim().to_string())
                        .unwrap_or_else(|_| format!("{} Fan {}", name, i));
                    fans.push(json!({
                        "label": label,
                        "sensor": name,
                        "device_id": hwmon_id,
                        "rpm": rpm,
                    }));
                }
            }
        }
    }

    (temps, fans)
}

fn get_network_stats() -> serde_json::Value {
    let mut nets = get_networks().lock().unwrap();
    nets.refresh();

    let mut stats = Vec::new();
    for (name, data) in nets.iter() {
        stats.push(json!({
            "name": name,
            "rx_bytes": data.total_received(),
            "tx_bytes": data.total_transmitted(),
        }));
    }

    json!(stats)
}

fn get_disk_io() -> Vec<serde_json::Value> {
    let mut io_stats = Vec::new();

    if let Ok(content) = fs::read_to_string("/proc/diskstats") {
        for line in content.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 14 {
                let name = parts[2];
                if name.starts_with("loop") || name.starts_with("ram") || name.starts_with("dm-") {
                    continue;
                }
                if !std::path::Path::new(&format!("/sys/block/{}", name)).exists() {
                    continue;
                }
                let reads: u64 = parts[5].parse().unwrap_or(0);
                let writes: u64 = parts[9].parse().unwrap_or(0);
                let read_bytes = reads * 512;
                let write_bytes = writes * 512;
                let io_ms: u64 = parts[12].parse().unwrap_or(0);

                io_stats.push(json!({
                    "name": name,
                    "read_bytes": read_bytes,
                    "write_bytes": write_bytes,
                    "io_ms": io_ms,
                }));
            }
        }
    }

    io_stats
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_os_info() {
        let result = get_os_info();
        assert!(result.is_ok(), "get_os_info failed: {:?}", result.err());
        let info = result.unwrap();
        assert!(!info["hostname"].as_str().unwrap_or("").is_empty(), "hostname should not be empty");
        assert!(!info["arch"].as_str().unwrap_or("").is_empty(), "arch should not be empty");
        assert!(!info["kernel"].as_str().unwrap_or("").is_empty(), "kernel should not be empty");
        assert!(!info["os_pretty"].as_str().unwrap_or("").is_empty(), "os_pretty should not be empty");
    }

    #[test]
    fn test_get_resources_structure() {
        let result = get_resources();
        assert!(result.is_ok(), "get_resources failed: {:?}", result.err());
        let res = result.unwrap();
        let cpu = res["cpu"].as_f64().expect("cpu field should be a number");
        assert!(cpu >= 0.0 && cpu <= 100.0, "cpu usage should be between 0 and 100, got {}", cpu);
        assert!(res["cpu_count"].as_u64().unwrap_or(0) > 0, "cpu_count should be > 0");
        assert!(!res["cpu_model"].as_str().unwrap_or("").is_empty(), "cpu_model should not be empty");
        assert!(res["memory"]["total"].as_u64().unwrap_or(0) > 0, "memory total should be > 0");
        assert!(res["memory"]["used"].as_u64().is_some(), "memory used should be present");
        assert!(res["per_cpu"].as_array().map_or(0, |v| v.len()) > 0, "per_cpu should have entries");
        assert!(res["load_avg"].as_array().map_or(0, |v| v.len()) == 3, "load_avg should have 3 values");
        assert!(res["uptime"].as_u64().unwrap_or(0) > 0, "uptime should be > 0");
    }

    #[test]
    fn test_get_system_overview() {
        let result = get_system_overview();
        assert!(result.is_ok(), "get_system_overview failed: {:?}", result.err());
        let overview = result.unwrap();
        assert!(overview["cpus"].as_array().map_or(0, |v| v.len()) > 0, "should have at least one CPU");
        assert!(overview["memory"]["total"].as_u64().unwrap_or(0) > 0, "memory total should be > 0");
    }

    #[test]
    fn test_get_resources_disk_info() {
        let result = get_resources().unwrap();
        let disks = result["disks"].as_array().expect("disks should be an array");
        // Most systems have at least one disk with total_space > 0
        for disk in disks {
            assert!(disk["total_space"].as_u64().unwrap_or(0) > 0, "disk total_space should be > 0");
            assert!(disk["mount_point"].as_str().is_some(), "disk mount_point should be present");
        }
    }
}

fn get_load_average() -> (f64, f64, f64) {
    if let Ok(content) = fs::read_to_string("/proc/loadavg") {
        let parts: Vec<&str> = content.split_whitespace().collect();
        if parts.len() >= 3 {
            let l1: f64 = parts[0].parse().unwrap_or(0.0);
            let l5: f64 = parts[1].parse().unwrap_or(0.0);
            let l15: f64 = parts[2].parse().unwrap_or(0.0);
            return (l1, l5, l15);
        }
    }
    (0.0, 0.0, 0.0)
}

fn get_uptime_seconds() -> u64 {
    if let Ok(content) = fs::read_to_string("/proc/uptime") {
        if let Some(secs_str) = content.split_whitespace().next() {
            return secs_str.parse::<f64>().unwrap_or(0.0) as u64;
        }
    }
    0
}

#[tauri::command]
pub fn save_report_file(content: String, filename: String) -> Result<String, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not determine home directory".to_string())?;
    let dir = home.join("Downloads");
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    let path = dir.join(&filename);
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn get_os_info() -> Result<serde_json::Value, String> {
    let mut os_name = String::from("Linux");
    let mut os_version = String::new();
    let mut os_pretty = String::new();
    if let Ok(content) = fs::read_to_string("/etc/os-release") {
        for line in content.lines() {
            if line.starts_with("NAME=") {
                os_name = line["NAME=".len()..].trim_matches('"').to_string();
            } else if line.starts_with("VERSION=") {
                os_version = line["VERSION=".len()..].trim_matches('"').to_string();
            } else if line.starts_with("PRETTY_NAME=") {
                os_pretty = line["PRETTY_NAME=".len()..].trim_matches('"').to_string();
            }
        }
    }

    let mut kernel = String::new();
    if let Ok(content) = fs::read_to_string("/proc/version") {
        if let Some(ver_part) = content.split_whitespace().nth(2) {
            kernel = ver_part.to_string();
        }
    }

    let hostname = fs::read_to_string("/proc/sys/kernel/hostname")
        .unwrap_or_default()
        .trim()
        .to_string();

    let arch = std::env::consts::ARCH.to_string();

    Ok(json!({
        "os_name": os_name,
        "os_version": os_version,
        "os_pretty": if os_pretty.is_empty() { format!("{} {}", os_name, os_version) } else { os_pretty },
        "kernel": kernel,
        "hostname": hostname,
        "arch": arch,
    }))
}

#[tauri::command]
pub fn get_resources() -> Result<serde_json::Value, String> {
    let mut sys = get_system().lock().unwrap();
    sys.refresh_cpu_all();
    sys.refresh_memory();

    let cpu_total: f32 = sys.cpus().iter().map(|p| p.cpu_usage()).sum();
    let cpu_count = sys.cpus().len().max(1) as f32;
    let cpu = cpu_total / cpu_count;

    let per_cpu: Vec<_> = sys.cpus().iter().map(|c| json!({
        "name": c.name(),
        "usage": c.cpu_usage(),
        "frequency": c.frequency(),
    })).collect();

    let (load1, load5, load15) = get_load_average();
    let uptime = get_uptime_seconds();

    let memory = json!({
        "total": sys.total_memory(),
        "used": sys.used_memory(),
        "swap_total": sys.total_swap(),
        "swap_used": sys.used_swap(),
    });

    let mut disks = get_disks().lock().unwrap();
    disks.refresh_list();
    let disk_info: Vec<_> = disks
        .iter()
        .filter(|d| d.total_space() > 0)
        .map(|d| json!({
            "name": d.name().to_string_lossy(),
            "mount_point": d.mount_point().to_string_lossy(),
            "total_space": d.total_space(),
            "available_space": d.available_space(),
        }))
        .collect();

    let gpu = get_gpu_info();
    let (temperatures, fans) = get_thermal_info();
    let network = get_network_stats();
    let disk_io = get_disk_io();

    Ok(json!({
        "cpu": cpu,
        "cpu_count": sys.cpus().len(),
        "cpu_model": get_cpu_model(),
        "per_cpu": per_cpu,
        "load_avg": [load1, load5, load15],
        "uptime": uptime,
        "memory": memory,
        "disks": disk_info,
        "gpu": gpu,
        "temperatures": temperatures,
        "fans": fans,
        "network": network,
        "disk_io": disk_io,
    }))
}
