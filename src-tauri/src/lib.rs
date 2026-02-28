mod modules;

use tauri::Manager;
use tauri::image::Image;

use modules::{
    get_system_overview,
    get_resources,
    get_os_info,
    get_platform,
    save_report_file,
    list_processes,
    kill_process,
    kill_process_group,
    get_processor_info,
    list_apt_repos,
    list_startup_apps,
    toggle_apt_repo,
    add_apt_repo,
    delete_apt_repo,
    add_startup_app,
    edit_startup_app,
    delete_startup_app,
    toggle_startup_app,
    list_devices,
    list_usb_devices,
    list_network_devices,
    list_pci_devices,
    list_input_devices,
    write_log,
    read_log_file,
    clear_log_file,
    list_scripts,
    add_script,
    remove_script,
    update_script,
    run_script,
    list_services,
    start_service,
    stop_service,
    restart_service,
    enable_service,
    disable_service,
    get_settings,
    set_theme,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_system_overview,
            get_resources,
            get_os_info,
            get_platform,
            save_report_file,
            list_processes,
            kill_process,
            kill_process_group,
            get_processor_info,
            list_devices,
            list_usb_devices,
            list_network_devices,
            list_pci_devices,
            list_input_devices,
            list_apt_repos,
            list_startup_apps,
            toggle_apt_repo,
            add_apt_repo,
            delete_apt_repo,
            add_startup_app,
            edit_startup_app,
            delete_startup_app,
            toggle_startup_app,
            write_log,
            read_log_file,
            clear_log_file,
            list_scripts,
            add_script,
            remove_script,
            update_script,
            run_script,
            list_services,
            start_service,
            stop_service,
            restart_service,
            enable_service,
            disable_service,
            get_settings,
            set_theme,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            if let Some(window) = app.get_webview_window("main") {
                let icon_bytes = include_bytes!("../icons/icon.png");
                if let Ok(icon) = Image::from_bytes(icon_bytes) {
                    let _ = window.set_icon(icon);
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
