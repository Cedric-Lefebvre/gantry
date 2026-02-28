#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn print_help() {
  println!("gantry {}", env!("CARGO_PKG_VERSION"));
  println!("A lightweight system management app");
  println!();
  println!("Usage: gantry [OPTIONS]");
  println!();
  println!("Options:");
  println!("  -h, --help     Print help");
  println!("  -V, --version  Print version");
}

fn main() {
  let args: Vec<String> = std::env::args().collect();

  let has_flag = |short: &str, long: &str| -> bool {
    args.iter().any(|a| a == short || a == long)
  };

  if has_flag("-V", "--version") {
    println!("gantry {}", env!("CARGO_PKG_VERSION"));
    return;
  }

  if has_flag("-h", "--help") {
    print_help();
    return;
  }

  #[cfg(all(target_os = "linux", not(debug_assertions)))]
  if std::env::var("_GANTRY_DETACHED").is_err()
    && std::env::var("TAURI_WEBVIEW_AUTOMATION").as_deref() != Ok("true")
  {
    let exe = std::fs::read_link("/proc/self/exe")
      .unwrap_or_else(|_| std::env::current_exe().unwrap());
    let _ = std::process::Command::new("setsid")
      .arg(exe)
      .args(std::env::args().skip(1))
      .env("_GANTRY_DETACHED", "1")
      .stdin(std::process::Stdio::null())
      .stdout(std::process::Stdio::null())
      .stderr(std::process::Stdio::null())
      .spawn();
    return;
  }

  gantry_lib::run();
}
