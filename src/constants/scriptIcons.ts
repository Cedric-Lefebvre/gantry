import {
  Activity, Archive, Bot, Bug, Camera, Clock, Cloud, Code, Container, Cpu, Database, Download,
  Eraser, FlaskConical, Folder, Gamepad2, GitBranch, Globe, HardDrive, KeyRound, Lock, Monitor,
  Music, Network, Package, Power, RefreshCw, Rocket, Server, Shield, Star, Terminal, Trash2,
  Upload, Wifi, Wrench, Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface ScriptIcon {
  icon: LucideIcon
  label: string
}

// Keys are stored in scripts.yaml, so they must stay stable.
export const SCRIPT_ICONS: Record<string, ScriptIcon> = {
  terminal: { icon: Terminal, label: 'Terminal' },
  container: { icon: Container, label: 'Containers' },
  cloud: { icon: Cloud, label: 'Cloud' },
  server: { icon: Server, label: 'Server' },
  rocket: { icon: Rocket, label: 'Deploy' },
  'git-branch': { icon: GitBranch, label: 'Git' },
  code: { icon: Code, label: 'Code' },
  bug: { icon: Bug, label: 'Debug' },
  flask: { icon: FlaskConical, label: 'Experiments' },
  bot: { icon: Bot, label: 'Automation' },
  eraser: { icon: Eraser, label: 'Cleanup' },
  trash: { icon: Trash2, label: 'Trash' },
  refresh: { icon: RefreshCw, label: 'Updates' },
  package: { icon: Package, label: 'Packages' },
  download: { icon: Download, label: 'Download' },
  upload: { icon: Upload, label: 'Upload' },
  archive: { icon: Archive, label: 'Backup' },
  database: { icon: Database, label: 'Database' },
  'hard-drive': { icon: HardDrive, label: 'Storage' },
  folder: { icon: Folder, label: 'Files' },
  network: { icon: Network, label: 'Network' },
  globe: { icon: Globe, label: 'Web' },
  wifi: { icon: Wifi, label: 'Wi-Fi' },
  shield: { icon: Shield, label: 'Security' },
  lock: { icon: Lock, label: 'Lock' },
  key: { icon: KeyRound, label: 'Keys' },
  cpu: { icon: Cpu, label: 'System' },
  monitor: { icon: Monitor, label: 'Display' },
  activity: { icon: Activity, label: 'Monitoring' },
  power: { icon: Power, label: 'Power' },
  clock: { icon: Clock, label: 'Scheduled' },
  wrench: { icon: Wrench, label: 'Maintenance' },
  zap: { icon: Zap, label: 'Quick actions' },
  gamepad: { icon: Gamepad2, label: 'Gaming' },
  music: { icon: Music, label: 'Media' },
  camera: { icon: Camera, label: 'Capture' },
  star: { icon: Star, label: 'Favorites' },
}

export const DEFAULT_SCRIPT_ICON = 'terminal'

export const CATEGORY_PRESETS: { name: string; icon: string }[] = [
  { name: 'Maintenance', icon: 'wrench' },
  { name: 'Cleanup', icon: 'eraser' },
  { name: 'Updates', icon: 'refresh' },
  { name: 'Network', icon: 'network' },
  { name: 'Backup', icon: 'archive' },
  { name: 'System', icon: 'cpu' },
  { name: 'Security', icon: 'shield' },
  { name: 'Development', icon: 'code' },
]

export function scriptIcon(key: string | undefined): LucideIcon {
  return (SCRIPT_ICONS[key ?? ''] ?? SCRIPT_ICONS[DEFAULT_SCRIPT_ICON]).icon
}
