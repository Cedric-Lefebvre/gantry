pub mod system;
pub mod processes;
pub mod config;
pub mod devices;
pub mod logging;
pub mod paths;
pub mod packages;
#[cfg(target_os = "linux")]
pub mod pacman;
pub mod scripts;
pub mod services;
pub mod settings;

pub use system::{get_system_overview, get_resources, get_os_info, get_platform, save_report_file};
pub use processes::{list_processes, kill_process, kill_process_group};
pub use config::{get_package_manager, list_apt_repos, list_startup_apps, toggle_apt_repo, add_apt_repo, delete_apt_repo, add_startup_app, edit_startup_app, delete_startup_app, toggle_startup_app};
pub use devices::{get_processor_info, list_devices, list_usb_devices, list_network_devices, list_pci_devices, list_input_devices};
pub use logging::{write_log, read_log_file, clear_log_file};
pub use scripts::{list_scripts, add_script, remove_script, update_script, run_script, list_script_categories, add_script_category, update_script_category, remove_script_category, set_script_layout, get_collapsed_script_groups, set_script_group_collapsed};
pub use services::{list_services, start_service, stop_service, restart_service, enable_service, disable_service};
pub use settings::{get_settings, set_theme};
pub use packages::{get_package_maintenance, list_package_updates, remove_orphan_packages, clean_package_cache};
