use serde_json::json;
use std::process::Command;
use std::fs;

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
        if parts.len() != 2 { continue; }
        let key = parts[0].trim();
        let val = parts[1].trim();

        match key {
            "model name" if model_name.is_empty() => model_name = val.to_string(),
            "vendor_id" if vendor.is_empty() => vendor = val.to_string(),
            "cpu family" if cpu_family.is_empty() => cpu_family = val.to_string(),
            "stepping" if stepping.is_empty() => stepping = val.to_string(),
            "cache size" if cache_size.is_empty() => cache_size = val.to_string(),
            "flags" if flags_str.is_empty() => flags_str = val.to_string(),
            "physical id" => { physical_ids.insert(val.to_string()); }
            "core id" => { core_ids.insert(val.to_string()); }
            "processor" => { thread_count += 1; }
            _ => {}
        }
    }

    let sockets = physical_ids.len().max(1);
    let cores = core_ids.len().max(1);

    let features: Vec<&str> = flags_str.split_whitespace()
        .filter(|f| ["sse4_2", "avx", "avx2", "avx512f", "aes", "svm", "vmx", "rdrand", "sha_ni", "fma"].contains(f))
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

#[tauri::command]
pub fn list_network_devices() -> Result<Vec<serde_json::Value>, String> {
    let link_output = match Command::new("ip").args(["-d", "link", "show"]).output() {
        Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout).to_string(),
        _ => return Ok(vec![]),
    };

    let addr_output = Command::new("ip").args(["addr", "show"]).output()
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
                let ips = extract_ip_addresses(&addr_output, &current_name);
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
                current_mtu = line[mtu_pos + 4..].split_whitespace().next().unwrap_or("").to_string();
            }

            current_mac = String::new();
        } else if line.contains("link/ether") {
            current_mac = line.split_whitespace().nth(1).unwrap_or("").to_string();
        }
    }

    if !current_name.is_empty() {
        let ips = extract_ip_addresses(&addr_output, &current_name);
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

fn extract_ip_addresses(addr_output: &str, device_name: &str) -> Vec<String> {
    let mut ips = Vec::new();
    let mut in_device = false;

    for line in addr_output.lines() {
        if !line.starts_with(' ') && line.contains(':') {
            let parts: Vec<&str> = line.split(':').collect();
            let name = parts.get(1).map(|s| s.trim().split('@').next().unwrap_or("")).unwrap_or("");
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

fn categorize_network_device(name: &str) -> String {
    let lower = name.to_lowercase();
    if lower == "lo" { return "Loopback".to_string(); }
    if lower.starts_with("eth") || lower.starts_with("en") { return "Ethernet".to_string(); }
    if lower.starts_with("wl") { return "WiFi".to_string(); }
    if lower.starts_with("ww") { return "Cellular".to_string(); }
    if lower.starts_with("br") { return "Bridge".to_string(); }
    if lower.starts_with("docker") || lower.starts_with("veth") { return "Docker".to_string(); }
    if lower.starts_with("virbr") || lower.starts_with("vnet") { return "Virtual".to_string(); }
    if lower.starts_with("tun") || lower.starts_with("tap") { return "VPN".to_string(); }
    "Other".to_string()
}

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

fn categorize_pci_device(category: &str) -> String {
    let lower = category.to_lowercase();
    if lower.contains("vga") || lower.contains("3d") || lower.contains("display") { return "GPU".to_string(); }
    if lower.contains("audio") || lower.contains("multimedia") { return "Audio".to_string(); }
    if lower.contains("network") || lower.contains("ethernet") { return "Network".to_string(); }
    if lower.contains("wireless") || lower.contains("wifi") { return "WiFi".to_string(); }
    if lower.contains("usb") { return "USB Controller".to_string(); }
    if lower.contains("sata") || lower.contains("ide") || lower.contains("ahci") || lower.contains("nvme") || lower.contains("storage") { return "Storage".to_string(); }
    if lower.contains("bridge") || lower.contains("isa") || lower.contains("pci") || lower.contains("smbus") || lower.contains("host") { return "System".to_string(); }
    if lower.contains("encryption") || lower.contains("signal") { return "Security".to_string(); }
    if lower.contains("bluetooth") { return "Bluetooth".to_string(); }
    "Other".to_string()
}

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
                let event_path = handlers.split_whitespace()
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
