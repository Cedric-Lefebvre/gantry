export type PageType = 'settings' | 'devices' | 'processes' | 'repositories' | 'startup' | 'resources' | 'logs' | 'scripts' | 'services'

export type Platform = 'linux' | 'macos' | 'windows'

export interface AppSettings {
  theme: string
}

export interface Process {
  pid: number
  name: string
  cpu: number
  memory: number
  status?: ProcessStatus
}

export type ProcessStatus = string | { [key: string]: unknown }

export interface CpuInfo {
  name?: string
  brand?: string
  frequency?: number
  vendor_id?: string
}

export interface MemoryInfo {
  total: number
  used: number
  available: number
  free: number
}

export interface SystemInfo {
  cpus: CpuInfo[]
  memory: MemoryInfo
}

export interface BlockDevice {
  name: string
  size: string
  type: 'disk' | 'part' | string
  mountpoint: string | null
  model: string | null
  vendor: string | null
  children?: BlockDevice[]
}

export interface UsbDevice {
  info: string
}

export interface NetworkDevice {
  name: string
  info: string
}

export interface PciDevice {
  info: string
}

export interface Device {
  name: string
  size?: string
  type?: string
  mountpoint?: string
}

export interface MenuItem {
  id: PageType
  label: string
  icon: React.ComponentType<{ size: number }>
}
