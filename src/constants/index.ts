import { Settings as SettingsIcon, Cpu, HardDrive, Server, Database, Terminal, FileText, ScrollText, Cog } from 'lucide-react'
import { MenuItem, PageType } from '../types'

export const NAVIGATION_ITEMS: MenuItem[] = [
  { id: 'resources', label: 'Resources', icon: Cpu },
  { id: 'devices', label: 'Devices', icon: HardDrive },
  { id: 'processes', label: 'Processes', icon: Server },
  { id: 'services', label: 'Services', icon: Cog },
  { id: 'repositories', label: 'Repositories', icon: Database },
  { id: 'startup', label: 'Startup Apps', icon: Terminal },
  { id: 'scripts', label: 'Scripts', icon: ScrollText },
  { id: 'logs', label: 'Logs', icon: FileText },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
]

export const DEFAULT_PAGE: PageType = 'resources'
export const ITEMS_PER_PAGE = 100
export const APP_VERSION = `v${__APP_VERSION__}`
export const APP_NAME = 'Gantry'
export const APP_SUBTITLE = 'System Inspector'
