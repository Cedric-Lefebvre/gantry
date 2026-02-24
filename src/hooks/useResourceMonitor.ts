import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

interface DiskInfo {
  name: string
  mount_point?: string
  total_space?: number
  available_space?: number
}

interface GpuInfo {
  name: string
  vendor: string
  usage: number | null
  memory_used: number | null
  memory_total: number | null
  temperature: number | null
  fan_speed: number | null
}

interface TempInfo {
  label: string
  sensor: string
  device_id: string
  device_name: string
  celsius: number
}

interface FanInfo {
  label: string
  sensor: string
  device_id: string
  rpm: number
}

interface NetworkStat {
  name: string
  rx_bytes: number
  tx_bytes: number
}

interface DiskIoStat {
  name: string
  read_bytes: number
  write_bytes: number
  io_ms: number
}

interface CpuCore {
  name: string
  usage: number
  frequency: number
}

export interface NetworkRate {
  name: string
  rx: number
  tx: number
  totalRx: number
  totalTx: number
}

export interface DiskIoRate {
  name: string
  read: number
  write: number
  utilization: number
}

export interface SystemResources {
  cpu: number
  cpu_count: number
  cpu_model: string
  per_cpu: CpuCore[]
  load_avg: [number, number, number]
  uptime: number
  memory: {
    used: number
    total: number
    swap_total: number
    swap_used: number
  }
  disks: DiskInfo[]
  gpu: GpuInfo[] | null
  temperatures: TempInfo[]
  fans: FanInfo[]
  network: NetworkStat[]
  disk_io: DiskIoStat[]
}

export interface ResourceMonitorData {
  resources: SystemResources | null
  loading: boolean
  cpuHistory: number[]
  memoryHistory: number[]
  gpuHistory: Record<number, number[]>
  networkRates: NetworkRate[]
  networkHistory: Record<string, { rx: number[]; tx: number[] }>
  diskIoRates: DiskIoRate[]
  diskIoHistory: Record<string, { read: number[]; write: number[] }>
}

const HISTORY_LENGTH = 300

export const ResourceMonitorContext = createContext<ResourceMonitorData>({
  resources: null,
  loading: true,
  cpuHistory: [],
  memoryHistory: [],
  gpuHistory: {},
  networkRates: [],
  networkHistory: {},
  diskIoRates: [],
  diskIoHistory: {},
})

export function useResourceMonitor(): ResourceMonitorData {
  return useContext(ResourceMonitorContext)
}

export function useResourceMonitorProvider(): ResourceMonitorData {
  const [resources, setResources] = useState<SystemResources | null>(null)
  const [loading, setLoading] = useState(true)
  const [cpuHistory, setCpuHistory] = useState<number[]>([])
  const [memoryHistory, setMemoryHistory] = useState<number[]>([])
  const [gpuHistory, setGpuHistory] = useState<Record<number, number[]>>({})
  const [networkRates, setNetworkRates] = useState<NetworkRate[]>([])
  const [networkHistory, setNetworkHistory] = useState<Record<string, { rx: number[]; tx: number[] }>>({})
  const [diskIoRates, setDiskIoRates] = useState<DiskIoRate[]>([])
  const [diskIoHistory, setDiskIoHistory] = useState<Record<string, { read: number[]; write: number[] }>>({})
  const prevNetworkRef = useRef<NetworkStat[] | null>(null)
  const prevDiskIoRef = useRef<DiskIoStat[] | null>(null)
  const intervalRef = useRef<number | null>(null)

  useEffect(() => {
    const fetch = async () => {
      try {
        const data = await invoke<SystemResources>('get_resources')
        setResources(data)

        setCpuHistory(prev => [...prev, data.cpu].slice(-HISTORY_LENGTH))

        if (data.memory) {
          const memPercent = (data.memory.used / data.memory.total) * 100
          setMemoryHistory(prev => [...prev, memPercent].slice(-HISTORY_LENGTH))
        }

        if (data.gpu?.length) {
          setGpuHistory(prev => {
            const next = { ...prev }
            data.gpu!.forEach((gpu, i) => {
              if (gpu.usage !== null) {
                next[i] = [...(next[i] || []), gpu.usage!].slice(-HISTORY_LENGTH)
              }
            })
            return next
          })
        }

        const prevNet = prevNetworkRef.current
        if (prevNet && data.network) {
          const prevNetMap = new Map(prevNet.map(p => [p.name, p]))
          const rates = data.network.map(curr => {
            const old = prevNetMap.get(curr.name)
            return {
              name: curr.name,
              rx: old ? Math.max(0, curr.rx_bytes - old.rx_bytes) : 0,
              tx: old ? Math.max(0, curr.tx_bytes - old.tx_bytes) : 0,
              totalRx: curr.rx_bytes,
              totalTx: curr.tx_bytes,
            }
          })
          setNetworkRates(rates)
          setNetworkHistory(prev => {
            const next = { ...prev }
            rates.forEach(r => {
              if (!next[r.name]) next[r.name] = { rx: [], tx: [] }
              next[r.name] = {
                rx: [...next[r.name].rx, r.rx].slice(-HISTORY_LENGTH),
                tx: [...next[r.name].tx, r.tx].slice(-HISTORY_LENGTH),
              }
            })
            return next
          })
        } else if (data.network) {
          setNetworkRates(data.network.map(n => ({
            name: n.name,
            rx: 0,
            tx: 0,
            totalRx: n.rx_bytes,
            totalTx: n.tx_bytes,
          })))
        }
        prevNetworkRef.current = data.network

        const prevDisk = prevDiskIoRef.current
        if (prevDisk && data.disk_io) {
          const prevDiskMap = new Map(prevDisk.map(p => [p.name, p]))
          const rates = data.disk_io.map(curr => {
            const old = prevDiskMap.get(curr.name)
            return {
              name: curr.name,
              read: old ? Math.max(0, curr.read_bytes - old.read_bytes) : 0,
              write: old ? Math.max(0, curr.write_bytes - old.write_bytes) : 0,
              utilization: old ? Math.min(100, Math.max(0, (curr.io_ms - old.io_ms) / 10)) : 0,
            }
          })
          setDiskIoRates(rates)
          setDiskIoHistory(prev => {
            const next = { ...prev }
            rates.forEach(r => {
              if (!next[r.name]) next[r.name] = { read: [], write: [] }
              next[r.name] = {
                read: [...next[r.name].read, r.read].slice(-HISTORY_LENGTH),
                write: [...next[r.name].write, r.write].slice(-HISTORY_LENGTH),
              }
            })
            return next
          })
        } else if (data.disk_io) {
          setDiskIoRates(data.disk_io.map(d => ({
            name: d.name,
            read: 0,
            write: 0,
            utilization: 0,
          })))
        }
        prevDiskIoRef.current = data.disk_io
      } catch (err) {
        console.error('Failed to fetch resources:', err)
      } finally {
        setLoading(false)
      }
    }

    fetch()
    intervalRef.current = window.setInterval(fetch, 1000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [])

  return {
    resources,
    loading,
    cpuHistory,
    memoryHistory,
    gpuHistory,
    networkRates,
    networkHistory,
    diskIoRates,
    diskIoHistory,
  }
}
