import { useEffect, useState, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import SpeedometerGauge from '../components/SpeedometerGauge'

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
}

interface SystemResources {
  cpu: number
  memory: {
    used: number
    total: number
  }
  disks: DiskInfo[]
  gpu: GpuInfo[] | null
}

const HISTORY_LENGTH = 30

export default function Resources() {
  const [resources, setResources] = useState<SystemResources | null>(null)
  const [loading, setLoading] = useState(true)
  const [cpuHistory, setCpuHistory] = useState<number[]>([])
  const [memoryHistory, setMemoryHistory] = useState<number[]>([])
  const [gpuHistory, setGpuHistory] = useState<number[]>([])
  const intervalRef = useRef<number | null>(null)

  useEffect(() => {
    fetchSystemResources()

    // Update every second for real-time monitoring
    intervalRef.current = window.setInterval(fetchSystemResources, 1000)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [])

  const fetchSystemResources = async () => {
    try {
      const data = await invoke<SystemResources>('get_resources')
      setResources(data)

      // Update history
      setCpuHistory(prev => {
        const newHistory = [...prev, data.cpu]
        return newHistory.slice(-HISTORY_LENGTH)
      })

      if (data.memory) {
        const memPercent = (data.memory.used / data.memory.total) * 100
        setMemoryHistory(prev => {
          const newHistory = [...prev, memPercent]
          return newHistory.slice(-HISTORY_LENGTH)
        })
      }

      // Update GPU history (use first GPU if available)
      if (data.gpu && data.gpu.length > 0 && data.gpu[0].usage !== null) {
        setGpuHistory(prev => {
          const newHistory = [...prev, data.gpu![0].usage!]
          return newHistory.slice(-HISTORY_LENGTH)
        })
      }
    } catch (err) {
      console.error('Failed to fetch resources:', err)
    } finally {
      setLoading(false)
    }
  }

  const formatBytes = (bytes: number): string => {
    const gb = bytes / 1024 / 1024 / 1024
    return gb.toFixed(1) + ' GB'
  }

  const formatDiskSize = (bytes?: number): string => {
    if (!bytes) return 'N/A'
    const gb = bytes / 1024 / 1024 / 1024
    if (gb >= 1000) {
      return (gb / 1024).toFixed(1) + ' TB'
    }
    return gb.toFixed(1) + ' GB'
  }

  if (loading) return <div className="p-4 text-gray-900 dark:text-gray-100">Loading resources...</div>

  const memoryUsedPercent = resources?.memory
    ? (resources.memory.used / resources.memory.total) * 100
    : 0

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Resources</h1>

      {/* CPU, Memory, and GPU Gauges */}
      <div className={`grid grid-cols-1 ${resources?.gpu && resources.gpu.length > 0 ? 'md:grid-cols-3' : 'md:grid-cols-2'} gap-6`}>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <SpeedometerGauge
            value={resources?.cpu ?? 0}
            max={100}
            label="CPU Usage"
            unit="%"
            history={cpuHistory}
            color="#3b82f6"
          />
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <SpeedometerGauge
            value={memoryUsedPercent}
            max={100}
            label="Memory Usage"
            unit="%"
            history={memoryHistory}
            color="#8b5cf6"
          />
          <div className="text-center mt-2 text-sm text-gray-500 dark:text-gray-400">
            {resources?.memory && (
              <span>{formatBytes(resources.memory.used)} / {formatBytes(resources.memory.total)}</span>
            )}
          </div>
        </div>

        {/* GPU Gauge */}
        {resources?.gpu && resources.gpu.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
            {resources.gpu[0].usage !== null ? (
              <>
                <SpeedometerGauge
                  value={resources.gpu[0].usage}
                  max={100}
                  label="GPU Usage"
                  unit="%"
                  history={gpuHistory}
                  color="#10b981"
                />
                <div className="text-center mt-2 text-sm text-gray-500 dark:text-gray-400">
                  <span>{resources.gpu[0].name}</span>
                  {resources.gpu[0].temperature !== null && (
                    <span className="ml-2">({resources.gpu[0].temperature}°C)</span>
                  )}
                </div>
                {resources.gpu[0].memory_total !== null && resources.gpu[0].memory_total > 0 && (
                  <div className="text-center text-xs text-gray-400 mt-1">
                    {formatBytes(resources.gpu[0].memory_used || 0)} / {formatBytes(resources.gpu[0].memory_total)} VRAM
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full min-h-[200px]">
                <div className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">GPU</div>
                <div className="text-sm text-gray-500 dark:text-gray-400 text-center">{resources.gpu[0].name}</div>
                <div className="text-xs text-gray-400 mt-2">(Usage monitoring not available)</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Disk Usage */}
      {resources?.disks && resources.disks.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Disk Usage</h2>
          <div className="space-y-4">
            {resources.disks.map((disk) => {
              const used = disk.total_space && disk.available_space
                ? disk.total_space - disk.available_space
                : 0
              const total = disk.total_space || 0
              const usedPercent = total > 0 ? (used / total) * 100 : 0
              const barColor = usedPercent > 90 ? 'bg-red-500' : usedPercent > 75 ? 'bg-amber-500' : 'bg-green-500'

              return (
                <div key={disk.name} className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                      {disk.mount_point || disk.name}
                    </span>
                    <span className="text-gray-500 dark:text-gray-400">
                      {formatDiskSize(used)} / {formatDiskSize(total)}
                    </span>
                  </div>
                  <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${barColor} rounded-full transition-all duration-300`}
                      style={{ width: `${usedPercent}%` }}
                    />
                  </div>
                  <div className="text-xs text-gray-400">
                    {usedPercent.toFixed(1)}% used
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
