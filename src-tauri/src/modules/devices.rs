use serde_json::json;
use std::process::Command;
use std::fs;

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn get_processor_info() -> Result<serde_json::Value, String> {
    let content = fs::read_to_string("/proc/cpuinfo").map_err(|e| e.to_string())?;

    let mut model_name = String::new();
    let mut vendor = String::new();
    let mut cpu_family = String::new();
    let mut stepping = String::new();
    let mut cache_size = String::new();
    let mut flags_str = String::new();
    let mut physical_ids = std::collections::HashSet::new();
    let mut core_ids = std::collections::HashSet::new();
    let mut thread_count = 0u32;

    for line in content.lines() {
        let parts: Vec<&str> = line.splitn(2, ':').collect();
        if parts.len() != 2 {
            continue;
        }
        let key = parts[0].trim();
        let val = parts[1].trim();

        match key {
            "model name" if model_name.is_empty() => model_name = val.to_string(),
            "vendor_id" if vendor.is_empty() => vendor = val.to_string(),
            "cpu family" if cpu_family.is_empty() => cpu_family = val.to_string(),
            "stepping" if stepping.is_empty() => stepping = val.to_string(),
            "cache size" if cache_size.is_empty() => cache_size = val.to_string(),
            "flags" if flags_str.is_empty() => flags_str = val.to_string(),
            "physical id" => {
                physical_ids.insert(val.to_string());
            }
            "core id" => {
                core_ids.insert(val.to_string());
            }
            "processor" => {
                thread_count += 1;
            }
            _ => {}
        }
    }

    let sockets = physical_ids.len().max(1);
    let cores = core_ids.len().max(1);

    let features: Vec<&str> = flags_str
        .split_whitespace()
        .filter(|f| {
            ["sse4_2", "avx", "avx2", "avx512f", "aes", "svm", "vmx", "rdrand", "sha_ni", "fma"]
                .contains(f)
        })
        .collect();

    Ok(json!({
        "model": model_name,
        "vendor": vendor,
        "sockets": sockets,
        "cores": cores,
        "threads": thread_count,
        "cache": cache_size,
        "family": cpu_family,
        "stepping": stepping,
        "features": features,
    }))
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn get_processor_info() -> Result<serde_json::Value, String> {
    let sysctl = |key: &str| -> String {
        Command::new("sysctl")
            .args(["-n", key])
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
            .unwrap_or_default()
    };

    let model = sysctl("machdep.cpu.brand_string");
    let vendor = sysctl("machdep.cpu.vendor");
    let cpu_family = sysctl("machdep.cpu.family");
    let stepping = sysctl("machdep.cpu.stepping");
    let cores: u32 = sysctl("hw.physicalcpu").parse().unwrap_or(0);
    let threads: u32 = sysctl("hw.logicalcpu").parse().unwrap_or(0);
    let cache_kb: u64 = sysctl("hw.l2cachesize").parse().unwrap_or(0);
    let cache = if cache_kb > 0 {
        format!("{} KB", cache_kb / 1024)
    } else {
        String::new()
    };

    let flags_raw = sysctl("machdep.cpu.features");
    let known_features = ["SSE4.2", "AVX1.0", "AVX2", "AVX512F", "AES", "VMX", "RDRAND", "SHA", "FMA"];
    let features: Vec<&str> = flags_raw
        .split_whitespace()
        .filter(|f| known_features.iter().any(|k| k.eq_ignore_ascii_case(f)))
        .collect();

    Ok(json!({
        "model": model,
        "vendor": vendor,
        "sockets": 1,
        "cores": cores,
        "threads": threads,
        "cache": cache,
        "family": cpu_family,
        "stepping": stepping,
        "features": features,
    }))
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn list_devices() -> Result<serde_json::Value, String> {
    match Command::new("lsblk")
        .args(["-J", "-o", "NAME,SIZE,TYPE,MOUNTPOINT,MODEL,VENDOR,FSTYPE,SERIAL,ROTA,TRAN"])
        .output()
    {
        Ok(out) if out.status.success() => {
            let output = String::from_utf8_lossy(&out.stdout);
            serde_json::from_str::<serde_json::Value>(&output)
                .map_err(|e| format!("Failed to parse lsblk: {}", e))
        }
        Ok(out) => Err(format!("lsblk failed: {}", String::from_utf8_lossy(&out.stderr))),
        Err(e) => Err(format!("failed to run lsblk: {}", e)),
    }
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn list_devices() -> Result<serde_json::Value, String> {
    let out = Command::new("diskutil")
        .args(["list", "-plist"])
        .output()
        .map_err(|e| format!("Failed to run diskutil: {}", e))?;

    if !out.status.success() {
        return Err(format!("diskutil failed: {}", String::from_utf8_lossy(&out.stderr)));
    }

    let val = plist::from_bytes::<plist::Value>(&out.stdout)
        .map_err(|e| format!("Failed to parse diskutil output: {}", e))?;

    let dict = val.into_dictionary().ok_or("Unexpected plist format")?;

    let all_disks = dict
        .get("AllDisksAndPartitions")
        .and_then(|v| v.as_array())
        .ok_or("AllDisksAndPartitions not found")?;

    let mut block_devices: Vec<serde_json::Value> = Vec::new();

    for disk in all_disks {
        let d = match disk.as_dictionary() {
            Some(d) => d,
            None => continue,
        };

        let name = d.get("DeviceIdentifier")
            .and_then(|v| v.as_string())
            .unwrap_or("")
            .to_string();

        let size: u64 = d.get("Size")
            .and_then(|v| v.as_unsigned_integer())
            .unwrap_or(0);

        let size_str = format_bytes(size);

        let mut children: Vec<serde_json::Value> = Vec::new();
        if let Some(parts) = d.get("Partitions").and_then(|v| v.as_array()) {
            for part in parts {
                let p = match part.as_dictionary() {
                    Some(p) => p,
                    None => continue,
                };
                let part_name = p.get("DeviceIdentifier")
                    .and_then(|v| v.as_string())
                    .unwrap_or("")
                    .to_string();
                let part_size: u64 = p.get("Size")
                    .and_then(|v| v.as_unsigned_integer())
                    .unwrap_or(0);
                let mount = p.get("MountPoint")
                    .and_then(|v| v.as_string())
                    .unwrap_or("")
                    .to_string();
                let fstype = p.get("Content")
                    .and_then(|v| v.as_string())
                    .unwrap_or("")
                    .to_string();

                children.push(json!({
                    "name": part_name,
                    "size": format_bytes(part_size),
                    "type": "part",
                    "mountpoint": mount,
                    "model": "",
                    "vendor": "",
                    "fstype": fstype,
                    "serial": "",
                    "rota": false,
                    "tran": "",
                }));
            }
        }

        let mut entry = json!({
            "name": name,
            "size": size_str,
            "type": "disk",
            "mountpoint": "",
            "model": "",
            "vendor": "",
            "fstype": "",
            "serial": "",
            "rota": false,
            "tran": "",
        });

        if !children.is_empty() {
            entry["children"] = json!(children);
        }

        block_devices.push(entry);
    }

    Ok(json!({"blockdevices": block_devices}))
}

#[cfg(target_os = "macos")]
fn format_bytes(bytes: u64) -> String {
    const GB: u64 = 1_073_741_824;
    const MB: u64 = 1_048_576;
    if bytes >= GB {
        format!("{:.1}G", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.0}M", bytes as f64 / MB as f64)
    } else {
        format!("{}B", bytes)
    }
}

fn categorize_usb_device(name: &str) -> String {
    let lower = name.to_lowercase();
    if lower.contains("hub") { return "Hub".to_string(); }
    if lower.contains("keyboard") { return "Keyboard".to_string(); }
    if lower.contains("mouse") || lower.contains("pointing") { return "Mouse".to_string(); }
    if lower.contains("webcam") || lower.contains("camera") || lower.contains("video") { return "Camera".to_string(); }
    if lower.contains("audio") || lower.contains("sound") || lower.contains("headset") || lower.contains("speaker") { return "Audio".to_string(); }
    if lower.contains("storage") || lower.contains("mass storage") || lower.contains("flash") { return "Storage".to_string(); }
    if lower.contains("bluetooth") { return "Bluetooth".to_string(); }
    if lower.contains("wireless") || lower.contains("wifi") || lower.contains("wlan") { return "Wireless".to_string(); }
    if lower.contains("ethernet") || lower.contains("network") { return "Network".to_string(); }
    if lower.contains("printer") { return "Printer".to_string(); }
    if lower.contains("gamepad") || lower.contains("controller") || lower.contains("joystick") { return "Controller".to_string(); }
    "Other".to_string()
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn list_usb_devices() -> Result<Vec<serde_json::Value>, String> {
    let output = match Command::new("lsusb").output() {
        Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout).to_string(),
        _ => return Ok(vec![]),
    };

    let mut devices = Vec::new();
    for line in output.lines() {
        let mut bus = String::new();
        let mut device = String::new();
        let mut vendor_id = String::new();
        let mut product_id = String::new();
        let mut name = line.to_string();

        if let Some(bus_start) = line.find("Bus ") {
            bus = line[bus_start + 4..].chars().take_while(|c| c.is_ascii_digit()).collect();
        }
        if let Some(dev_start) = line.find("Device ") {
            device = line[dev_start + 7..].chars().take_while(|c| c.is_ascii_digit()).collect();
        }
        if let Some(id_start) = line.find("ID ") {
            let id_str = &line[id_start + 3..];
            if let Some(colon_pos) = id_str.find(':') {
                vendor_id = id_str[..colon_pos].to_string();
                let after_colon = &id_str[colon_pos + 1..];
                product_id = after_colon.chars().take_while(|c| c.is_ascii_hexdigit()).collect();
                let name_start = colon_pos + 1 + product_id.len();
                if name_start < id_str.len() {
                    name = id_str[name_start..].trim().to_string();
                }
            }
        }

        let device_type = categorize_usb_device(&name);

        devices.push(json!({
            "bus": bus,
            "device": device,
            "vendor_id": vendor_id,
            "product_id": product_id,
            "name": name,
            "device_type": device_type,
        }));
    }

    Ok(devices)
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn list_usb_devices() -> Result<Vec<serde_json::Value>, String> {
    let out = Command::new("system_profiler")
        .args(["SPUSBDataType", "-json"])
        .output();

    let Ok(out) = out else { return Ok(vec![]) };
    let Ok(text) = String::from_utf8(out.stdout) else { return Ok(vec![]) };
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) else { return Ok(vec![]) };

    let mut devices = Vec::new();
    if let Some(controllers) = parsed["SPUSBDataType"].as_array() {
        for controller in controllers {
            collect_usb_devices(controller, &mut devices);
        }
    }

    Ok(devices)
}

#[cfg(target_os = "macos")]
fn collect_usb_devices(node: &serde_json::Value, devices: &mut Vec<serde_json::Value>) {
    let name = node["_name"].as_str().unwrap_or("").to_string();
    if !name.is_empty() && name != "USB" {
        let vendor_id = node["vendor_id"].as_str().unwrap_or("").to_string();
        let product_id = node["product_id"].as_str().unwrap_or("").to_string();
        let device_type = categorize_usb_device(&name);

        devices.push(json!({
            "bus": "",
            "device": "",
            "vendor_id": vendor_id,
            "product_id": product_id,
            "name": name,
            "device_type": device_type,
        }));
    }

    if let Some(items) = node["_items"].as_array() {
        for item in items {
            collect_usb_devices(item, devices);
        }
    }
}

fn categorize_network_device(name: &str) -> String {
    let lower = name.to_lowercase();
    if lower == "lo" || lower == "lo0" { return "Loopback".to_string(); }
    if lower.starts_with("eth") || lower.starts_with("en") { return "Ethernet".to_string(); }
    if lower.starts_with("wl") { return "WiFi".to_string(); }
    if lower.starts_with("ww") { return "Cellular".to_string(); }
    if lower.starts_with("br") { return "Bridge".to_string(); }
    if lower.starts_with("docker") || lower.starts_with("veth") { return "Docker".to_string(); }
    if lower.starts_with("virbr") || lower.starts_with("vnet") { return "Virtual".to_string(); }
    if lower.starts_with("tun") || lower.starts_with("tap") || lower.starts_with("utun") { return "VPN".to_string(); }
    "Other".to_string()
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn list_network_devices() -> Result<Vec<serde_json::Value>, String> {
    let link_output = match Command::new("ip").args(["-d", "link", "show"]).output() {
        Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout).to_string(),
        _ => return Ok(vec![]),
    };

    let addr_output = Command::new("ip")
        .args(["addr", "show"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();

    let mut devices: Vec<serde_json::Value> = Vec::new();
    let mut current_name = String::new();
    let mut current_state = String::new();
    let mut current_mac = String::new();
    let mut current_mtu = String::new();

    for line in link_output.lines() {
        if !line.starts_with(' ') && line.contains(':') {
            if !current_name.is_empty() {
                let ips = extract_ip_addresses_linux(&addr_output, &current_name);
                let dev_type = categorize_network_device(&current_name);
                devices.push(json!({
                    "name": current_name,
                    "state": current_state,
                    "mac_address": current_mac,
                    "device_type": dev_type,
                    "mtu": current_mtu,
                    "ip_addresses": ips,
                }));
            }

            let parts: Vec<&str> = line.split(':').collect();
            if parts.len() > 1 {
                current_name = parts[1].trim().split('@').next().unwrap_or("").to_string();
            }

            current_state = if line.contains("state UP") { "UP".to_string() }
                else if line.contains("state DOWN") { "DOWN".to_string() }
                else { "UNKNOWN".to_string() };

            if let Some(mtu_pos) = line.find("mtu ") {
                current_mtu = line[mtu_pos + 4..]
                    .split_whitespace()
                    .next()
                    .unwrap_or("")
                    .to_string();
            }

            current_mac = String::new();
        } else if line.contains("link/ether") {
            current_mac = line.split_whitespace().nth(1).unwrap_or("").to_string();
        }
    }

    if !current_name.is_empty() {
        let ips = extract_ip_addresses_linux(&addr_output, &current_name);
        let dev_type = categorize_network_device(&current_name);
        devices.push(json!({
            "name": current_name,
            "state": current_state,
            "mac_address": current_mac,
            "device_type": dev_type,
            "mtu": current_mtu,
            "ip_addresses": ips,
        }));
    }

    Ok(devices)
}

#[cfg(target_os = "linux")]
fn extract_ip_addresses_linux(addr_output: &str, device_name: &str) -> Vec<String> {
    let mut ips = Vec::new();
    let mut in_device = false;

    for line in addr_output.lines() {
        if !line.starts_with(' ') && line.contains(':') {
            let parts: Vec<&str> = line.split(':').collect();
            let name = parts
                .get(1)
                .map(|s| s.trim().split('@').next().unwrap_or(""))
                .unwrap_or("");
            in_device = name == device_name;
        } else if in_device {
            let trimmed = line.trim();
            if trimmed.starts_with("inet ") || trimmed.starts_with("inet6 ") {
                if let Some(addr) = trimmed.split_whitespace().nth(1) {
                    ips.push(addr.to_string());
                }
            }
        }
    }

    ips
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn list_network_devices() -> Result<Vec<serde_json::Value>, String> {
    let out = Command::new("ifconfig")
        .arg("-a")
        .output();

    let Ok(out) = out else { return Ok(vec![]) };
    let text = String::from_utf8_lossy(&out.stdout).to_string();

    let mut devices: Vec<serde_json::Value> = Vec::new();
    let mut current_name = String::new();
    let mut current_state = String::new();
    let mut current_mac = String::new();
    let mut current_mtu = String::new();
    let mut current_ips: Vec<String> = Vec::new();

    for line in text.lines() {
        if !line.starts_with('\t') && !line.starts_with(' ') && line.contains(':') {
            if !current_name.is_empty() {
                let dev_type = categorize_network_device(&current_name);
                devices.push(json!({
                    "name": current_name,
                    "state": current_state,
                    "mac_address": current_mac,
                    "device_type": dev_type,
                    "mtu": current_mtu,
                    "ip_addresses": current_ips,
                }));
            }

            current_name = line.split(':').next().unwrap_or("").to_string();
            current_state = if line.contains("<UP,") || line.contains(",UP,") || line.contains(",UP>") {
                "UP".to_string()
            } else {
                "DOWN".to_string()
            };
            current_mtu = line
                .split_whitespace()
                .skip_while(|&t| t != "mtu")
                .nth(1)
                .unwrap_or("")
                .to_string();
            current_mac = String::new();
            current_ips = Vec::new();
        } else {
            let trimmed = line.trim();
            if trimmed.starts_with("ether ") {
                current_mac = trimmed.split_whitespace().nth(1).unwrap_or("").to_string();
            } else if trimmed.starts_with("inet ") {
                if let Some(addr) = trimmed.split_whitespace().nth(1) {
                    current_ips.push(addr.to_string());
                }
            } else if trimmed.starts_with("inet6 ") {
                if let Some(addr) = trimmed.split_whitespace().nth(1) {
                    let clean = addr.split('%').next().unwrap_or(addr);
                    current_ips.push(clean.to_string());
                }
            }
        }
    }

    if !current_name.is_empty() {
        let dev_type = categorize_network_device(&current_name);
        devices.push(json!({
            "name": current_name,
            "state": current_state,
            "mac_address": current_mac,
            "device_type": dev_type,
            "mtu": current_mtu,
            "ip_addresses": current_ips,
        }));
    }

    Ok(devices)
}

fn categorize_pci_device(category: &str) -> String {
    let lower = category.to_lowercase();
    if lower.contains("vga") || lower.contains("3d") || lower.contains("display") { return "GPU".to_string(); }
    if lower.contains("audio") || lower.contains("multimedia") { return "Audio".to_string(); }
    if lower.contains("network") || lower.contains("ethernet") { return "Network".to_string(); }
    if lower.contains("wireless") || lower.contains("wifi") { return "WiFi".to_string(); }
    if lower.contains("usb") { return "USB Controller".to_string(); }
    if lower.contains("sata") || lower.contains("ide") || lower.contains("ahci") || lower.contains("nvme") || lower.contains("storage") || lower.contains("non-volatile") { return "Storage".to_string(); }
    if lower.contains("bridge") || lower.contains("isa") || lower.contains("pci") || lower.contains("smbus") || lower.contains("host") { return "System".to_string(); }
    if lower.contains("encryption") || lower.contains("signal") { return "Security".to_string(); }
    if lower.contains("bluetooth") { return "Bluetooth".to_string(); }
    "Other".to_string()
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn list_pci_devices() -> Result<Vec<serde_json::Value>, String> {
    let output = match Command::new("lspci").args(["-mm"]).output() {
        Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout).to_string(),
        _ => return Ok(vec![]),
    };

    let mut devices = Vec::new();
    for line in output.lines() {
        let parts = parse_lspci_mm_line(line);
        if parts.len() >= 4 {
            let device_type = categorize_pci_device(&parts[1]);
            devices.push(json!({
                "slot": parts[0],
                "category": parts[1],
                "vendor": parts[2],
                "name": parts[3],
                "device_type": device_type,
            }));
        }
    }

    Ok(devices)
}

#[cfg(target_os = "linux")]
fn parse_lspci_mm_line(line: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;

    for ch in line.chars() {
        match ch {
            '"' => in_quotes = !in_quotes,
            ' ' if !in_quotes => {
                if !current.is_empty() {
                    parts.push(current.clone());
                    current.clear();
                }
            }
            _ => current.push(ch),
        }
    }
    if !current.is_empty() {
        parts.push(current);
    }

    parts
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn list_pci_devices() -> Result<Vec<serde_json::Value>, String> {
    let out = Command::new("system_profiler")
        .args(["SPPCIDataType", "-json"])
        .output();

    let Ok(out) = out else { return Ok(vec![]) };
    let Ok(text) = String::from_utf8(out.stdout) else { return Ok(vec![]) };
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) else { return Ok(vec![]) };

    let mut devices = Vec::new();
    if let Some(items) = parsed["SPPCIDataType"].as_array() {
        for item in items {
            let name = item["_name"].as_str().unwrap_or("Unknown").to_string();
            let vendor = item["sppci_vendor"].as_str().unwrap_or("").to_string();
            let slot = item["sppci_bus"].as_str().unwrap_or("").to_string();
            let category = item["sppci_type"].as_str().unwrap_or("").to_string();
            let device_type = categorize_pci_device(&category);

            devices.push(json!({
                "slot": slot,
                "category": category,
                "vendor": vendor,
                "name": name,
                "device_type": device_type,
            }));
        }
    }

    Ok(devices)
}

fn categorize_input_device(name: &str, handlers: &str) -> String {
    let lower = name.to_lowercase();
    if lower.contains("keyboard") || handlers.contains("kbd") { return "Keyboard".to_string(); }
    if lower.contains("mouse") || lower.contains("touchpad") || lower.contains("trackpad") || handlers.contains("mouse") { return "Mouse".to_string(); }
    if lower.contains("touchscreen") { return "Touchscreen".to_string(); }
    if lower.contains("gamepad") || lower.contains("joystick") || lower.contains("controller") { return "Controller".to_string(); }
    if lower.contains("power") || lower.contains("button") || lower.contains("lid") { return "Button".to_string(); }
    if lower.contains("speaker") || lower.contains("headphone") || lower.contains("audio") { return "Audio".to_string(); }
    "Other".to_string()
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn list_input_devices() -> Result<Vec<serde_json::Value>, String> {
    let mut devices = Vec::new();

    if let Ok(content) = fs::read_to_string("/proc/bus/input/devices") {
        let mut name = String::new();
        let mut handlers = String::new();

        for line in content.lines() {
            if line.starts_with("N: Name=") {
                name = line.trim_start_matches("N: Name=").trim_matches('"').to_string();
            } else if line.starts_with("H: Handlers=") {
                handlers = line.trim_start_matches("H: Handlers=").to_string();
            } else if line.is_empty() && !name.is_empty() {
                let device_type = categorize_input_device(&name, &handlers);
                let event_path = handlers
                    .split_whitespace()
                    .find(|h| h.starts_with("event"))
                    .map(|e| format!("/dev/input/{}", e))
                    .unwrap_or_default();

                devices.push(json!({
                    "name": name,
                    "device_type": device_type,
                    "path": event_path,
                }));

                name.clear();
                handlers.clear();
            }
        }

        if !name.is_empty() {
            let device_type = categorize_input_device(&name, &handlers);
            devices.push(json!({
                "name": name,
                "device_type": device_type,
                "path": "",
            }));
        }
    }

    Ok(devices)
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn list_input_devices() -> Result<Vec<serde_json::Value>, String> {
    let out = Command::new("system_profiler")
        .args(["SPUSBDataType", "-json"])
        .output();

    let Ok(out) = out else { return Ok(vec![]) };
    let Ok(text) = String::from_utf8(out.stdout) else { return Ok(vec![]) };
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) else { return Ok(vec![]) };

    let mut devices = Vec::new();
    if let Some(controllers) = parsed["SPUSBDataType"].as_array() {
        for controller in controllers {
            collect_hid_devices(controller, &mut devices);
        }
    }

    Ok(devices)
}

#[cfg(target_os = "macos")]
fn collect_hid_devices(node: &serde_json::Value, devices: &mut Vec<serde_json::Value>) {
    let name = node["_name"].as_str().unwrap_or("").to_string();
    if !name.is_empty() {
        let device_type = categorize_input_device(&name, "");
        if matches!(device_type.as_str(), "Keyboard" | "Mouse" | "Touchscreen" | "Controller") {
            devices.push(json!({
                "name": name,
                "device_type": device_type,
                "path": "",
            }));
        }
    }

    if let Some(items) = node["_items"].as_array() {
        for item in items {
            collect_hid_devices(item, devices);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "linux")]
    #[test]
    fn test_get_processor_info() {
        let result = get_processor_info();
        assert!(result.is_ok(), "get_processor_info failed: {:?}", result.err());
        let info = result.unwrap();
        assert!(!info["model"].as_str().unwrap_or("").is_empty(), "CPU model should not be empty");
        let cores = info["cores"].as_u64().unwrap_or(0);
        let threads = info["threads"].as_u64().unwrap_or(0);
        assert!(cores > 0, "cores should be > 0");
        assert!(threads > 0, "threads should be > 0");
        assert!(threads >= cores, "threads should be >= cores");
        assert!(info["features"].as_array().is_some(), "features should be an array");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_get_processor_info() {
        let result = get_processor_info();
        assert!(result.is_ok(), "get_processor_info failed: {:?}", result.err());
        let info = result.unwrap();
        assert!(!info["model"].as_str().unwrap_or("").is_empty(), "CPU model should not be empty");
        assert!(info["cores"].as_u64().unwrap_or(0) > 0, "cores should be > 0");
        assert!(info["threads"].as_u64().unwrap_or(0) > 0, "threads should be > 0");
        assert!(info["features"].as_array().is_some(), "features should be an array");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_list_network_devices_has_loopback() {
        let result = list_network_devices();
        assert!(result.is_ok(), "list_network_devices failed: {:?}", result.err());
        let devices = result.unwrap();
        let has_lo = devices.iter().any(|d| d["name"].as_str() == Some("lo"));
        assert!(has_lo, "should have loopback interface 'lo'");
    }

    #[test]
    fn test_list_network_devices_fields() {
        let result = list_network_devices().unwrap();
        for dev in &result {
            assert!(dev["name"].as_str().is_some(), "network device should have a name");
            assert!(dev["state"].as_str().is_some(), "network device should have a state");
            assert!(dev["device_type"].as_str().is_some(), "network device should have a device_type");
            assert!(dev["ip_addresses"].as_array().is_some(), "network device should have ip_addresses array");
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_list_input_devices() {
        let result = list_input_devices();
        assert!(result.is_ok(), "list_input_devices failed: {:?}", result.err());
        let devices = result.unwrap();
        for dev in &devices {
            assert!(dev["name"].as_str().is_some(), "input device should have a name");
            assert!(dev["device_type"].as_str().is_some(), "input device should have a device_type");
            assert!(dev["path"].as_str().is_some(), "input device should have a path");
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_list_devices_returns_valid_json() {
        let result = list_devices();
        assert!(result.is_ok(), "list_devices failed: {:?}", result.err());
        let data = result.unwrap();
        assert!(data["blockdevices"].as_array().is_some(), "should have blockdevices array");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_list_devices_returns_valid_json() {
        let result = list_devices();
        assert!(result.is_ok(), "list_devices failed: {:?}", result.err());
        let data = result.unwrap();
        assert!(data["blockdevices"].as_array().is_some(), "should have blockdevices array");
    }

    #[test]
    fn test_categorize_usb_device() {
        assert_eq!(categorize_usb_device("USB Hub"), "Hub");
        assert_eq!(categorize_usb_device("USB Keyboard"), "Keyboard");
        assert_eq!(categorize_usb_device("Optical Mouse"), "Mouse");
        assert_eq!(categorize_usb_device("USB Webcam"), "Camera");
        assert_eq!(categorize_usb_device("USB Audio Device"), "Audio");
        assert_eq!(categorize_usb_device("USB Mass Storage"), "Storage");
        assert_eq!(categorize_usb_device("Bluetooth Controller"), "Bluetooth");
        assert_eq!(categorize_usb_device("Unknown Device XYZ"), "Other");
    }

    #[test]
    fn test_categorize_network_device() {
        assert_eq!(categorize_network_device("lo"), "Loopback");
        assert_eq!(categorize_network_device("lo0"), "Loopback");
        assert_eq!(categorize_network_device("eth0"), "Ethernet");
        assert_eq!(categorize_network_device("enp3s0"), "Ethernet");
        assert_eq!(categorize_network_device("en0"), "Ethernet");
        assert_eq!(categorize_network_device("wlan0"), "WiFi");
        assert_eq!(categorize_network_device("wlp2s0"), "WiFi");
        assert_eq!(categorize_network_device("docker0"), "Docker");
        assert_eq!(categorize_network_device("tun0"), "VPN");
        assert_eq!(categorize_network_device("utun0"), "VPN");
        assert_eq!(categorize_network_device("br0"), "Bridge");
    }

    #[test]
    fn test_categorize_pci_device() {
        assert_eq!(categorize_pci_device("VGA compatible controller"), "GPU");
        assert_eq!(categorize_pci_device("Audio device"), "Audio");
        assert_eq!(categorize_pci_device("Ethernet controller"), "Network");
        assert_eq!(categorize_pci_device("USB controller"), "USB Controller");
        assert_eq!(categorize_pci_device("SATA controller"), "Storage");
        assert_eq!(categorize_pci_device("Non-Volatile memory controller"), "Storage");
        assert_eq!(categorize_pci_device("PCI bridge"), "System");
    }
}
