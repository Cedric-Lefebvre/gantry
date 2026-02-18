import { useEffect, useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  ChevronDown, ChevronRight, HardDrive, Usb, Wifi, Monitor,
  Bluetooth, Keyboard, Mouse, Camera, Speaker, Gamepad2,
  Printer, Network, Globe, Container, CircleDot,
  Cpu, Shield, Server, RotateCw, Smartphone, ChevronsDownUp, ChevronsUpDown, Search, FileText
} from 'lucide-react'
import CopyableText from '../components/CopyableText'
import { getOsInfo } from '../api/system'
import SystemReportModal from '../components/SystemReportModal'

interface BlockDevice {
  name: string
  size: string
  type: string
  mountpoint: string | null
  model: string | null
  vendor: string | null
  fstype: string | null
  serial: string | null
  rota: boolean | null
  tran: string | null
  children?: BlockDevice[]
}

interface UsbDevice {
  bus: string
  device: string
  vendor_id: string
  product_id: string
  name: string
  device_type: string
}

interface NetworkDevice {
  name: string
  state: string
  mac_address: string
  device_type: string
  mtu: string
  ip_addresses: string[]
}

interface PciDevice {
  slot: string
  category: string
  vendor: string
  name: string
  device_type: string
}

interface InputDevice {
  name: string
  device_type: string
  path: string
}

interface OsInfo {
  os_pretty: string
  kernel: string
  hostname: string
  arch: string
}

interface ProcessorInfo {
  model: string
  vendor: string
  sockets: number
  cores: number
  threads: number
  cache: string
  family: string
  stepping: string
  features: string[]
}

const cleanVendor = (vendor: string): string => {
  const map: [RegExp, string][] = [
    [/Advanced Micro Devices.*/, 'AMD'],
    [/Intel Corporation/, 'Intel'],
    [/Samsung Electronics.*/, 'Samsung'],
    [/MEDIATEK Corp\.?/, 'MediaTek'],
    [/Foxconn \/ Hon Hai.*/, 'Foxconn'],
    [/ASUSTek Computer.*/, 'ASUS'],
    [/Logitech.*/, 'Logitech'],
    [/Genesys Logic.*/, 'Genesys Logic'],
    [/Linux Foundation.*/, 'Linux Foundation'],
    [/Realtek Semiconductor.*/, 'Realtek'],
    [/Broadcom.*/, 'Broadcom'],
    [/NVIDIA Corporation.*/, 'NVIDIA'],
    [/Micro-Star Int.*/, 'MSI'],
    [/Corsair.*/, 'Corsair'],
  ]
  for (const [re, short] of map) {
    if (re.test(vendor)) return short
  }
  return vendor.replace(/,?\s*(Inc\.?|Corp\.?|Co\.?\s*Ltd\.?|LLC|Ltd\.?)$/i, '').trim()
}

const cleanDeviceName = (name: string): string => {
  if (/^Device [0-9a-fA-F]{4}$/.test(name)) return name
  let clean = name.replace(/^.*\[AMD\/ATI\]\s*/, '')
  clean = clean.replace(/^.*\[Intel\]\s*/, '')
  clean = clean.replace(/\s*\(rev\s+\w+\)\s*$/, '')
  const bracketMatch = clean.match(/\[([^\]]+)\]/)
  if (bracketMatch) {
    const extracted = bracketMatch[1].split('/')[0].trim()
    if (extracted.length > 5) clean = extracted
  }
  return clean || name
}

const deviceTypeIcon = (type: string, size = 16) => {
  const icons: Record<string, typeof HardDrive> = {
    Hub: Usb, Keyboard: Keyboard, Mouse: Mouse, Camera: Camera,
    Audio: Speaker, Storage: HardDrive, Bluetooth: Bluetooth,
    Wireless: Wifi, WiFi: Wifi, Network: Network, Printer: Printer,
    Controller: Gamepad2, Ethernet: Globe, Loopback: CircleDot,
    Docker: Container, Virtual: Server, VPN: Shield, Bridge: Network,
    GPU: Monitor, 'USB Controller': Usb, System: Cpu, Security: Shield,
    Button: CircleDot, Touchscreen: Monitor, Cellular: Smartphone,
    Other: CircleDot,
  }
  const Icon = icons[type] || CircleDot
  return <Icon size={size} />
}

const deviceTypeColor = (type: string): string => {
  const colors: Record<string, string> = {
    Hub: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
    Keyboard: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    Mouse: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
    Camera: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400',
    Audio: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    Storage: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    Bluetooth: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    Wireless: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    WiFi: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    Network: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
    Ethernet: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
    GPU: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    System: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
    Security: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    'USB Controller': 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    Controller: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  }
  return colors[type] || 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
}

const COLLAPSED_TYPES = new Set(['Hub', 'System', 'Other', 'Button', 'Loopback', 'Docker', 'Virtual', 'Bridge'])

function groupByType<T extends { device_type: string }>(items: T[]): [string, T[]][] {
  const groups: Record<string, T[]> = {}
  const order: string[] = []
  items.forEach(item => {
    if (!groups[item.device_type]) {
      groups[item.device_type] = []
      order.push(item.device_type)
    }
    groups[item.device_type].push(item)
  })
  order.sort((a, b) => {
    const ac = COLLAPSED_TYPES.has(a) ? 1 : 0
    const bc = COLLAPSED_TYPES.has(b) ? 1 : 0
    return ac - bc
  })
  return order.map(key => [key, groups[key]])
}

function DeviceSection({ title, icon, count, defaultOpen = true, children, forceOpen }: {
  title: string
  icon: React.ReactNode
  count: number
  defaultOpen?: boolean
  children: React.ReactNode
  forceOpen?: boolean | null
}) {
  const [open, setOpen] = useState(defaultOpen)

  useEffect(() => {
    if (forceOpen !== null && forceOpen !== undefined) setOpen(forceOpen)
  }, [forceOpen])

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
      >
        {open ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
        <span className="text-gray-600 dark:text-gray-400">{icon}</span>
        <span className="font-semibold text-gray-900 dark:text-gray-100">{title}</span>
        <span className="text-xs bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded-full">{count}</span>
      </button>
      {open && <div className="border-t border-gray-200 dark:border-gray-700">{children}</div>}
    </div>
  )
}

function DeviceSubGroup({ type, count, children, forceOpen }: {
  type: string
  count: number
  children: React.ReactNode
  forceOpen?: boolean | null
}) {
  const [open, setOpen] = useState(forceOpen !== null && forceOpen !== undefined ? forceOpen : !COLLAPSED_TYPES.has(type))

  useEffect(() => {
    if (forceOpen !== null && forceOpen !== undefined) setOpen(forceOpen)
  }, [forceOpen])

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 pl-8 pr-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
      >
        {open ? <ChevronDown size={12} className="text-gray-400 shrink-0" /> : <ChevronRight size={12} className="text-gray-400 shrink-0" />}
        <span className={deviceTypeColor(type) + ' p-1.5 rounded-md'}>
          {deviceTypeIcon(type, 14)}
        </span>
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{type}</span>
        <span className="text-xs text-gray-400">({count})</span>
      </button>
      {open && <div>{children}</div>}
    </div>
  )
}

function StorageDeviceNode({ device, depth = 0 }: { device: BlockDevice; depth?: number }) {
  const [expanded, setExpanded] = useState(depth === 0)
  const hasChildren = device.children && device.children.length > 0

  return (
    <div>
      <div
        className="flex items-center gap-3 py-2.5 px-4 hover:bg-gray-50 dark:hover:bg-gray-700/30 cursor-pointer"
        style={{ paddingLeft: `${32 + depth * 20}px` }}
        onClick={() => hasChildren && setExpanded(!expanded)}
      >
        {hasChildren ? (
          expanded ? <ChevronDown size={14} className="text-gray-400 shrink-0" /> : <ChevronRight size={14} className="text-gray-400 shrink-0" />
        ) : <div className="w-3.5 shrink-0" />}

        <HardDrive size={16} className={device.type === 'disk' ? 'text-blue-500 shrink-0' : 'text-gray-400 shrink-0'} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <CopyableText value={device.name}>
              <span className="font-medium text-gray-900 dark:text-gray-100 text-sm">{device.name}</span>
            </CopyableText>
            {device.model && (
              <CopyableText value={device.model.trim()}>
                <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{device.model.trim()}</span>
              </CopyableText>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-400 mt-0.5">
            <span>{device.size}</span>
            {device.fstype && <span className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">{device.fstype}</span>}
            {device.mountpoint && (
              <CopyableText value={device.mountpoint}>
                <span className="text-blue-500">{device.mountpoint}</span>
              </CopyableText>
            )}
            {device.tran && <span className="uppercase">{device.tran}</span>}
            {device.serial && (
              <CopyableText value={device.serial}>
                <span className="font-mono text-gray-400">S/N {device.serial}</span>
              </CopyableText>
            )}
          </div>
        </div>

        <span className={`text-xs px-2 py-0.5 rounded ${
          device.type === 'disk' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
          device.type === 'part' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
          'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
        }`}>
          {device.type}
        </span>
      </div>

      {expanded && hasChildren && device.children!.map((child) => (
        <StorageDeviceNode key={child.name} device={child} depth={depth + 1} />
      ))}
    </div>
  )
}

function PciDeviceRow({ dev }: { dev: PciDevice }) {
  const name = cleanDeviceName(dev.name)
  const vendor = cleanVendor(dev.vendor)
  const isUnknown = /^Device [0-9a-fA-F]{4}$/.test(dev.name)
  return (
    <div className="flex items-center gap-3 pl-16 pr-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/30">
      <div className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600 shrink-0" />
      <div className="flex-1 min-w-0">
        <CopyableText value={name}>
          <div className={`text-sm truncate ${isUnknown ? 'text-gray-400 dark:text-gray-500 italic' : 'text-gray-900 dark:text-gray-100'}`}>{name}</div>
        </CopyableText>
        <div className="flex items-center gap-2 text-xs text-gray-400 mt-0.5">
          <span>{vendor}</span>
          <CopyableText value={dev.slot}>
            <span className="font-mono">{dev.slot}</span>
          </CopyableText>
        </div>
      </div>
    </div>
  )
}

function UsbDeviceRow({ dev }: { dev: UsbDevice }) {
  const parts = dev.name.split(' ')
  const vendorEnd = parts.findIndex((_, i) => i > 0 && /^[A-Z]/.test(parts[i]) && !/^(Inc|Corp|Ltd|Co|LLC)/.test(parts[i]) && parts.slice(0, i).join(' ').includes(','))
  let vendor = ''
  let product = dev.name || 'Unknown Device'
  if (vendorEnd > 0) {
    vendor = cleanVendor(parts.slice(0, vendorEnd).join(' '))
    product = parts.slice(vendorEnd).join(' ')
  }
  return (
    <div className="flex items-center gap-3 pl-16 pr-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/30">
      <div className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600 shrink-0" />
      <div className="flex-1 min-w-0">
        <CopyableText value={product}>
          <div className="text-sm text-gray-900 dark:text-gray-100 truncate">{product}</div>
        </CopyableText>
        <div className="flex items-center gap-2 text-xs text-gray-400 mt-0.5">
          {vendor && <span>{vendor}</span>}
          <CopyableText value={`${dev.vendor_id}:${dev.product_id}`}>
            <span className="font-mono">{dev.vendor_id}:{dev.product_id}</span>
          </CopyableText>
        </div>
      </div>
    </div>
  )
}

function NetworkDeviceRow({ dev }: { dev: NetworkDevice }) {
  return (
    <div className="flex items-center gap-3 pl-16 pr-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/30">
      <span className={`w-2 h-2 rounded-full shrink-0 ${dev.state === 'UP' ? 'bg-green-500' : 'bg-gray-400'}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <CopyableText value={dev.name}>
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{dev.name}</span>
          </CopyableText>
          <span className={`text-xs px-1.5 py-0.5 rounded ${dev.state === 'UP' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}`}>
            {dev.state}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400 mt-0.5">
          {dev.mac_address && (
            <CopyableText value={dev.mac_address}>
              <span className="font-mono">{dev.mac_address}</span>
            </CopyableText>
          )}
          {dev.ip_addresses.map((ip, i) => (
            <CopyableText key={i} value={ip}>
              <span className="bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded">{ip}</span>
            </CopyableText>
          ))}
          <span>MTU {dev.mtu}</span>
        </div>
      </div>
    </div>
  )
}

function InputDeviceRow({ dev }: { dev: InputDevice }) {
  return (
    <div className="flex items-center gap-3 pl-16 pr-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/30">
      <div className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600 shrink-0" />
      <div className="flex-1 min-w-0">
        <CopyableText value={dev.name}>
          <div className="text-sm text-gray-900 dark:text-gray-100 truncate">{dev.name}</div>
        </CopyableText>
        {dev.path && (
          <CopyableText value={dev.path}>
            <div className="text-xs text-gray-400 font-mono mt-0.5">{dev.path}</div>
          </CopyableText>
        )}
      </div>
    </div>
  )
}

export default function Devices() {
  const [blockDevices, setBlockDevices] = useState<BlockDevice[]>([])
  const [usbDevices, setUsbDevices] = useState<UsbDevice[]>([])
  const [networkDevices, setNetworkDevices] = useState<NetworkDevice[]>([])
  const [pciDevices, setPciDevices] = useState<PciDevice[]>([])
  const [inputDevices, setInputDevices] = useState<InputDevice[]>([])
  const [processor, setProcessor] = useState<ProcessorInfo | null>(null)
  const [osInfo, setOsInfo] = useState<OsInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [globalOpen, setGlobalOpen] = useState<boolean | null>(null)
  const [search, setSearch] = useState('')
  const [showReport, setShowReport] = useState(false)

  const collapseAll = useCallback(() => setGlobalOpen(false), [])
  const expandAll = useCallback(() => setGlobalOpen(true), [])

  useEffect(() => {
    fetchAllDevices()
  }, [])

  const fetchAllDevices = async () => {
    try {
      const [devData, usbData, netData, pciData, inputData, cpuData, osData] = await Promise.all([
        invoke<{ blockdevices?: BlockDevice[] }>('list_devices'),
        invoke<UsbDevice[]>('list_usb_devices'),
        invoke<NetworkDevice[]>('list_network_devices'),
        invoke<PciDevice[]>('list_pci_devices'),
        invoke<InputDevice[]>('list_input_devices'),
        invoke<ProcessorInfo>('get_processor_info'),
        getOsInfo() as Promise<OsInfo>,
      ])

      setBlockDevices(devData?.blockdevices || [])
      setUsbDevices(usbData || [])
      setNetworkDevices(netData || [])
      setPciDevices(pciData || [])
      setInputDevices(inputData || [])
      setProcessor(cpuData || null)
      setOsInfo(osData || null)
    } catch (err) {
      console.error('Failed to load devices:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Devices</h1>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-16">
          <div className="flex flex-col items-center justify-center gap-4">
            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-500 dark:text-gray-400">Scanning devices...</p>
          </div>
        </div>
      </div>
    )
  }

  const q = search.toLowerCase().trim()
  const searching = q.length > 0

  const matchBlock = (d: BlockDevice): boolean => {
    if (!q) return true
    if ([d.name, d.model, d.vendor, d.fstype, d.mountpoint, d.tran, d.serial, d.size].some(v => v && v.toLowerCase().includes(q))) return true
    return d.children?.some(matchBlock) ?? false
  }

  const filteredBlock = blockDevices.filter(matchBlock)
  const filteredPci = pciDevices
    .filter(d => !q || [d.name, d.vendor, d.category, d.slot, d.device_type].some(v => v.toLowerCase().includes(q)))
    .filter(d => searching || !/^Device [0-9a-fA-F]{4}$/.test(d.name))
  const filteredUsb = usbDevices.filter(d => !q || [d.name, d.vendor_id, d.product_id, d.device_type].some(v => v.toLowerCase().includes(q)))
  const filteredNetwork = networkDevices.filter(d => !q || [d.name, d.mac_address, d.device_type, d.state, ...d.ip_addresses].some(v => v.toLowerCase().includes(q)))
  const filteredInput = inputDevices.filter(d => !q || [d.name, d.device_type, d.path].some(v => v.toLowerCase().includes(q)))

  const pciGroups = groupByType(filteredPci)
  const usbGroups = groupByType(filteredUsb)
  const networkGroups = groupByType(filteredNetwork)
  const inputGroups = groupByType(filteredInput)

  const forceState = searching ? true : globalOpen

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Devices</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter devices..."
              className="pl-8 pr-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg border-none outline-none focus:ring-2 focus:ring-blue-500 w-48 placeholder-gray-400"
            />
          </div>
          <button
            onClick={collapseAll}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg transition-colors"
            title="Collapse All"
          >
            <ChevronsDownUp size={14} />
            Collapse
          </button>
          <button
            onClick={expandAll}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg transition-colors"
            title="Expand All"
          >
            <ChevronsUpDown size={14} />
            Expand
          </button>
          <button
            onClick={() => { setGlobalOpen(null); fetchAllDevices() }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg transition-colors"
          >
            <RotateCw size={14} />
            Refresh
          </button>
          <button
            onClick={() => setShowReport(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg transition-colors"
          >
            <FileText size={14} />
            Report
          </button>
        </div>
      </div>

      {showReport && <SystemReportModal onClose={() => setShowReport(false)} />}

      {osInfo && (!searching || ['os', 'operating', 'system', 'linux', 'kernel', 'hostname', osInfo.os_pretty, osInfo.hostname, osInfo.kernel, osInfo.arch].some(v => v.toLowerCase().includes(q))) && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 px-5 py-4">
          <div className="flex items-center gap-2 mb-3">
            <Monitor size={15} className="text-gray-400" />
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Operating System</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <div className="text-xs text-gray-400 mb-0.5">Hostname</div>
              <CopyableText value={osInfo.hostname}>
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{osInfo.hostname}</span>
              </CopyableText>
            </div>
            <div>
              <div className="text-xs text-gray-400 mb-0.5">OS</div>
              <CopyableText value={osInfo.os_pretty}>
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{osInfo.os_pretty}</span>
              </CopyableText>
            </div>
            <div>
              <div className="text-xs text-gray-400 mb-0.5">Kernel</div>
              <CopyableText value={osInfo.kernel}>
                <span className="text-sm font-mono text-gray-900 dark:text-gray-100">{osInfo.kernel}</span>
              </CopyableText>
            </div>
            <div>
              <div className="text-xs text-gray-400 mb-0.5">Architecture</div>
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{osInfo.arch}</span>
            </div>
          </div>
        </div>
      )}

      {processor && (!searching || [processor.model, processor.vendor, 'cpu', 'processor'].some(v => v.toLowerCase().includes(q))) && (
        <DeviceSection title="Processor" icon={<Cpu size={18} />} count={1} forceOpen={forceState}>
          <div className="px-5 py-4">
            <CopyableText value={processor.model}>
              <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{processor.model}</div>
            </CopyableText>
            <div className="flex flex-wrap gap-x-6 gap-y-1.5 mt-2 text-xs text-gray-500 dark:text-gray-400">
              <span>{processor.cores} cores / {processor.threads} threads</span>
              {processor.sockets > 1 && <span>{processor.sockets} sockets</span>}
              {processor.cache && <span>Cache: {processor.cache}</span>}
            </div>
            {processor.features.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {processor.features.map(f => (
                  <span key={f} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">{f}</span>
                ))}
              </div>
            )}
          </div>
        </DeviceSection>
      )}

      {filteredBlock.length > 0 && (
        <DeviceSection title="Storage" icon={<HardDrive size={18} />} count={filteredBlock.length} forceOpen={forceState}>
          {filteredBlock.map((device) => (
            <StorageDeviceNode key={device.name} device={device} />
          ))}
        </DeviceSection>
      )}

      {filteredPci.length > 0 && (
        <DeviceSection title="PCI Devices" icon={<Cpu size={18} />} count={filteredPci.length} forceOpen={forceState}>
          {pciGroups.map(([type, devices]) => (
            <DeviceSubGroup key={type} type={type} count={devices.length} forceOpen={forceState}>
              {devices.map((dev, i) => (
                <PciDeviceRow key={i} dev={dev} />
              ))}
            </DeviceSubGroup>
          ))}
        </DeviceSection>
      )}

      {filteredNetwork.length > 0 && (
        <DeviceSection title="Network Interfaces" icon={<Globe size={18} />} count={filteredNetwork.length} forceOpen={forceState}>
          {networkGroups.map(([type, devices]) => (
            <DeviceSubGroup key={type} type={type} count={devices.length} forceOpen={forceState}>
              {devices.map((dev) => (
                <NetworkDeviceRow key={dev.name} dev={dev} />
              ))}
            </DeviceSubGroup>
          ))}
        </DeviceSection>
      )}

      {filteredUsb.length > 0 && (
        <DeviceSection title="USB Devices" icon={<Usb size={18} />} count={filteredUsb.length} forceOpen={forceState}>
          {usbGroups.map(([type, devices]) => (
            <DeviceSubGroup key={type} type={type} count={devices.length} forceOpen={forceState}>
              {devices.map((dev, i) => (
                <UsbDeviceRow key={i} dev={dev} />
              ))}
            </DeviceSubGroup>
          ))}
        </DeviceSection>
      )}

      {filteredInput.length > 0 && (
        <DeviceSection title="Input Devices" icon={<Keyboard size={18} />} count={filteredInput.length} forceOpen={forceState}>
          {inputGroups.map(([type, devices]) => (
            <DeviceSubGroup key={type} type={type} count={devices.length} forceOpen={forceState}>
              {devices.map((dev, i) => (
                <InputDeviceRow key={i} dev={dev} />
              ))}
            </DeviceSubGroup>
          ))}
        </DeviceSection>
      )}
    </div>
  )
}
