import { useEffect, useState } from 'react'
import { listDevices, listUsbDevices, listNetworkDevices, listPciDevices } from '../api/devices'
import { logger } from '../utils/logger'
import { ChevronDown, ChevronRight } from 'lucide-react'
import {
  BlockDevice,
  UsbDevice,
  NetworkDevice,
  PciDevice
} from '../types'

function StorageDeviceNode({ device, depth = 0 }: { device: BlockDevice; depth?: number }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const hasChildren = device.children && device.children.length > 0

  return (
    <div>
      <div
        className={`flex items-center gap-2 py-2 px-3 rounded cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700`}
        style={{ marginLeft: `${depth * 16}px` }}
      >
        {hasChildren && (
          <button onClick={() => setIsExpanded(!isExpanded)} className="p-0 w-5 flex items-center justify-center text-gray-900 dark:text-gray-100">
            {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        )}
        {!hasChildren && <div className="w-5" />}

        <div className="flex-1">
          <div className="font-semibold text-gray-900 dark:text-gray-100">{device.name}</div>
          <div className="text-sm text-gray-600 dark:text-gray-400">
            {device.model && <span>{device.model} • </span>}
            <span>{device.size}</span>
            {device.mountpoint && <span> • {device.mountpoint}</span>}
          </div>
        </div>
        <span className="text-xs bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 px-2 py-1 rounded">{device.type}</span>
      </div>

      {isExpanded && hasChildren && (
        <div>
          {device.children!.map((child) => (
            <StorageDeviceNode key={child.name} device={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function Devices() {
  const [blockDevices, setBlockDevices] = useState<BlockDevice[]>([])
  const [usbDevices, setUsbDevices] = useState<UsbDevice[]>([])
  const [networkDevices, setNetworkDevices] = useState<NetworkDevice[]>([])
  const [pciDevices, setPciDevices] = useState<PciDevice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchAllDeviceData()
  }, [])

  const fetchAllDeviceData = async () => {
    try {
      const [devData, usbData, netData, pciData] = await Promise.all([
        listDevices(),
        listUsbDevices(),
        listNetworkDevices(),
        listPciDevices(),
      ])

      setBlockDevices((devData as { blockdevices?: BlockDevice[] })?.blockdevices || [])
      setUsbDevices((usbData || []) as UsbDevice[])
      setNetworkDevices((netData || []) as NetworkDevice[])
      setPciDevices((pciData || []) as PciDevice[])
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      logger.error('Failed to load device data', { error: errorMessage })
      setError(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  if (loading) return <div className="p-4 text-gray-900 dark:text-gray-100">Loading devices...</div>
  if (error) return <div className="p-4 text-red-600 dark:text-red-400">Error: {error}</div>

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Devices & Hardware</h1>

      {blockDevices.length > 0 && (
        <div>
          <h2 className="text-xl font-bold mb-3 text-gray-900 dark:text-gray-100">💾 Storage Devices</h2>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
            <div className="space-y-0">
              {blockDevices.map((device) => (
                <StorageDeviceNode key={device.name} device={device} />
              ))}
            </div>
          </div>
        </div>
      )}

      {networkDevices.length > 0 && (
        <div>
          <h2 className="text-xl font-bold mb-3 text-gray-900 dark:text-gray-100">🌐 Network Devices ({networkDevices.length})</h2>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
            {networkDevices.map((dev) => (
              <div key={dev.name} className="p-4">
                <div className="font-semibold text-gray-900 dark:text-gray-100">{dev.name}</div>
                <div className="text-sm text-gray-600 dark:text-gray-400 font-mono mt-1">{dev.info}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {pciDevices.length > 0 && (
        <div>
          <h2 className="text-xl font-bold mb-3 text-gray-900 dark:text-gray-100">🔌 PCI Devices - Bluetooth/Wireless ({pciDevices.length})</h2>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
            {pciDevices.map((dev) => (
              <div key={dev.info} className="p-4">
                <div className="text-sm text-gray-600 dark:text-gray-400 font-mono">{dev.info}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {usbDevices.length > 0 && (
        <div>
          <h2 className="text-xl font-bold mb-3 text-gray-900 dark:text-gray-100">🔗 USB Devices ({usbDevices.length})</h2>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700 max-h-64 overflow-y-auto">
            {usbDevices.map((dev) => (
              <div key={dev.info} className="p-4">
                <div className="text-sm text-gray-600 dark:text-gray-400 font-mono">{dev.info}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
