# Gantry

A lightweight Linux system management tool built with Tauri and React. Monitor resources, manage services, control repositories, and run custom scripts from a modern desktop interface.

## Features

### System Monitoring
- **CPU & Memory** - Real-time gauges with historical graphs
- **GPU Usage** - NVIDIA, AMD, and Intel GPU monitoring
- **Disk Usage** - Storage utilization across all mounted drives

### Service Management
- Start, stop, and restart systemd services
- Enable/disable services at boot
- Visual status indicators for running services
- Support for both system and user services

### APT Repository Control
- View all configured APT repositories
- Enable/disable repositories with one click
- Supports both traditional `.list` and DEB822 `.sources` formats

### Custom Scripts
- Create and manage custom shell scripts
- Run scripts with optional sudo privileges
- View output in an integrated terminal
- Configuration stored in `~/.gantry/scripts.yaml`

### Additional Tools
- **Devices** - View block devices, USB, network, and PCI devices
- **Processes** - Monitor and kill running processes
- **Startup Apps** - View autostart applications
- **Logs** - Application logging

## Installation

### Prerequisites
- Node.js 18+
- Rust 1.77+
- System dependencies for Tauri (see [Tauri prerequisites](https://tauri.app/v1/guides/getting-started/prerequisites))

### Build from Source

```bash
# Clone the repository
git clone https://github.com/Cedric-Lefebvre/gantry.git
cd gantry

# Install dependencies
npm install

# Development mode
npm run tauri dev

# Build for production
npm run tauri build
```

### Pre-built Packages

After building, packages are available in `target/release/bundle/`:
- `.deb` - Debian/Ubuntu
- `.rpm` - Fedora/RHEL
- `.AppImage` - Universal Linux

## Configuration

Gantry stores configuration in `~/.gantry/`:

```
~/.gantry/
├── scripts.yaml    # Custom scripts
└── settings.yaml   # Application settings (theme, etc.)
```

## Tech Stack

- **Frontend**: React 18, TypeScript, Tailwind CSS
- **Backend**: Rust, Tauri 2.0
- **Icons**: Lucide React

## License

MIT
