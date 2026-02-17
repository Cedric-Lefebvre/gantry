import { useState } from 'react'
import SpeedometerGauge from '../components/SpeedometerGauge'
import { Thermometer, Fan, ArrowDown, ArrowUp, HardDrive, ChevronDown, ChevronRight, Network, Clock, Activity, X, Cpu, Monitor, MemoryStick, Wifi, Info } from 'lucide-react'
import { useResourceMonitor } from '../hooks/useResourceMonitor'
import type { NetworkRate, DiskIoRate } from '../hooks/useResourceMonitor'

const formatBytes = (bytes: number): string => {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(1) + ' GB'
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(0) + ' MB'
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB'
  return bytes + ' B'
}

const formatDiskSize = (bytes?: number): string => {
  if (!bytes) return 'N/A'
  const gb = bytes / 1024 / 1024 / 1024
  if (gb >= 1000) return (gb / 1024).toFixed(1) + ' TB'
  return gb.toFixed(1) + ' GB'
}

const formatRate = (bytesPerSec: number): string => {
  if (bytesPerSec >= 1024 * 1024 * 1024) return (bytesPerSec / 1024 / 1024 / 1024).toFixed(1) + ' GB/s'
  if (bytesPerSec >= 1024 * 1024) return (bytesPerSec / 1024 / 1024).toFixed(1) + ' MB/s'
  if (bytesPerSec >= 1024) return (bytesPerSec / 1024).toFixed(1) + ' KB/s'
  return bytesPerSec.toFixed(0) + ' B/s'
}

const tempColor = (celsius: number): string => {
  if (celsius >= 90) return 'text-red-500'
  if (celsius >= 70) return 'text-amber-500'
  return 'text-green-500'
}

type SensorCategory = 'cpu' | 'gpu' | 'storage' | 'memory' | 'network' | 'other'

const SENSOR_CATEGORIES: Record<string, SensorCategory> = {
  k10temp: 'cpu',
  coretemp: 'cpu',
  zenpower: 'cpu',
  amdgpu: 'gpu',
  nouveau: 'gpu',
  radeon: 'gpu',
  nvme: 'storage',
  drivetemp: 'storage',
  spd5118: 'memory',
  jc42: 'memory',
}

const CATEGORY_META: Record<SensorCategory, { label: string; icon: typeof Cpu; color: string }> = {
  cpu: { label: 'CPU', icon: Cpu, color: 'text-blue-500' },
  gpu: { label: 'GPU', icon: Monitor, color: 'text-emerald-500' },
  storage: { label: 'Storage', icon: HardDrive, color: 'text-purple-500' },
  memory: { label: 'Memory', icon: MemoryStick, color: 'text-amber-500' },
  network: { label: 'Network', icon: Wifi, color: 'text-green-500' },
  other: { label: 'Other', icon: Thermometer, color: 'text-gray-500' },
}

const getSensorCategory = (sensor: string): SensorCategory => {
  if (SENSOR_CATEGORIES[sensor]) return SENSOR_CATEGORIES[sensor]
  if (sensor.startsWith('nvme')) return 'storage'
  if (sensor.includes('wifi') || sensor.includes('phy') || sensor.includes('iwl') || sensor.startsWith('mt7')) return 'network'
  return 'other'
}

const cleanTempLabel = (label: string, sensor: string, category: SensorCategory): string => {
  const lower = label.toLowerCase()
  if (category === 'cpu') {
    if (lower === 'tctl' || lower === 'tdie') return 'Package'
    const ccdMatch = lower.match(/tccd(\d+)/)
    if (ccdMatch) return `CCD ${parseInt(ccdMatch[1]) + 1}`
    if (lower.includes('package')) return 'Package'
    const coreMatch = lower.match(/core\s*(\d+)/i)
    if (coreMatch) return `Core ${coreMatch[1]}`
  }
  if (category === 'gpu') {
    if (lower === 'edge') return 'Edge'
    if (lower === 'junction') return 'Junction'
    if (lower === 'mem') return 'Memory'
  }
  if (category === 'storage') {
    if (lower === 'composite') return 'Drive'
    const sensorMatch = lower.match(/sensor\s*(\d+)/i)
    if (sensorMatch) return `Sensor ${sensorMatch[1]}`
  }
  if (category === 'memory') return 'Temperature'
  if (category === 'network') return 'Temperature'
  if (label.startsWith(sensor + ' ')) return label.slice(sensor.length + 1)
  return label
}

const cleanFanLabel = (label: string, sensor: string): string => {
  if (label.startsWith(sensor + ' ')) return label.slice(sensor.length + 1)
  return label
}

const isUserFacingInterface = (name: string): boolean => {
  if (name === 'lo') return false
  if (name.startsWith('veth')) return false
  if (name.startsWith('docker')) return false
  if (name.startsWith('br-')) return false
  if (name.startsWith('virbr')) return false
  return true
}

const cleanGpuName = (name: string): string => {
  let clean = name.replace(/^.*\[AMD\/ATI\]\s*/, '')
  clean = clean.replace(/^.*\[Intel\]\s*/, '')
  clean = clean.replace(/\s*\(rev\s+\w+\)\s*$/, '')
  const bracketMatch = clean.match(/\[([^\]]+)\]/)
  if (bracketMatch) {
    clean = bracketMatch[1].split('/')[0].trim()
  }
  return clean || name
}

const formatUptime = (seconds: number): string => {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h ${mins}m`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

function DetailModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto m-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
            <X size={20} className="text-gray-500" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}

function FullGraph({ data, color, unit = '%', height = 120 }: { data: number[]; color: string; unit?: string; height?: number }) {
  if (data.length < 2) return null
  const width = 560
  const stepX = width / (data.length - 1)
  const dataMin = Math.min(...data)
  const dataMax = Math.max(...data)
  const range = dataMax - dataMin
  const padding = Math.max(range * 0.2, 1)
  const yMin = Math.max(0, dataMin - padding)
  const yMax = dataMax + padding
  const yRange = yMax - yMin || 1

  let areaPath = `M 0 ${height}`
  data.forEach((val, i) => {
    const x = i * stepX
    const y = height - ((val - yMin) / yRange) * height
    areaPath += ` L ${x} ${y}`
  })
  areaPath += ` L ${(data.length - 1) * stepX} ${height} Z`

  let linePath = ''
  data.forEach((val, i) => {
    const x = i * stepX
    const y = height - ((val - yMin) / yRange) * height
    linePath += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`
  })

  const minutes = Math.round(data.length / 60)

  return (
    <div>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="modal-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.4" />
            <stop offset="100%" stopColor={color} stopOpacity="0.05" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map(pct => (
          <line key={pct} x1="0" y1={height * pct} x2={width} y2={height * pct} stroke="currentColor" strokeWidth="0.5" className="text-gray-200 dark:text-gray-700" />
        ))}
        <path d={areaPath} fill="url(#modal-grad)" />
        <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <div className="flex justify-between text-xs text-gray-400 mt-2">
        <span>{minutes >= 1 ? `${minutes}m ago` : `${data.length}s ago`}</span>
        <span className="font-mono">Range: {dataMin.toFixed(1)}{unit} - {dataMax.toFixed(1)}{unit}</span>
        <span>now</span>
      </div>
    </div>
  )
}

function Sparkline({ data, color, width = 140, height = 32 }: { data: number[]; color: string; width?: number; height?: number }) {
  if (data.length < 2) return <div style={{ width, height }} />
  const max = Math.max(...data, 1)
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width
    const y = height - (v / max) * (height - 2) - 1
    return `${x},${y}`
  }).join(' ')

  const fillPoints = `0,${height} ${points} ${width},${height}`

  return (
    <svg width={width} height={height} className="shrink-0">
      <polyline fill={color} fillOpacity="0.1" stroke="none" points={fillPoints} />
      <polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" points={points} />
    </svg>
  )
}

export default function Resources() {
  const {
    resources, loading, cpuHistory, memoryHistory, gpuHistory,
    networkRates, networkHistory, diskIoRates, diskIoHistory,
  } = useResourceMonitor()
  const [thermalExpanded, setThermalExpanded] = useState(false)
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({})
  const [coresExpanded, setCoresExpanded] = useState(false)
  const [igpuExpanded, setIgpuExpanded] = useState(false)
  const [detailModal, setDetailModal] = useState<'cpu' | 'memory' | 'gpu' | null>(null)

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Resources</h1>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-16">
          <div className="flex flex-col items-center justify-center gap-4">
            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-500 dark:text-gray-400">Loading resources...</p>
          </div>
        </div>
      </div>
    )
  }

  const memoryUsedPercent = resources?.memory
    ? (resources.memory.used / resources.memory.total) * 100
    : 0

  const cpuPackageTemp = resources?.temperatures?.find(t => {
    const l = t.label.toLowerCase()
    return l.includes('package') || l.includes('tctl') || l.includes('tdie')
  })

  const gpuTemp = resources?.gpu?.[0]?.temperature
  const visibleNetworkRates = networkRates.filter(n => isUserFacingInterface(n.name))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Resources</h1>
        <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
          {resources?.uptime !== undefined && (
            <span className="flex items-center gap-1.5">
              <Clock size={14} />
              <span className="text-gray-400">Uptime</span>
              {formatUptime(resources.uptime)}
            </span>
          )}
          {resources?.load_avg && (
            <div className="relative group flex items-center gap-1.5 cursor-help">
              <Activity size={14} />
              <span className="text-gray-400">Load</span>
              {resources.load_avg[0].toFixed(2)}
              <div className="absolute right-0 top-full mt-2 w-64 p-3 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-lg shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
                <div className="font-medium mb-1">System Load Average</div>
                Average number of processes waiting to run.
                <div className="mt-1.5 font-mono text-gray-300 space-y-0.5">
                  <div>1 min: {resources.load_avg[0].toFixed(2)}</div>
                  <div>5 min: {resources.load_avg[1].toFixed(2)}</div>
                  <div>15 min: {resources.load_avg[2].toFixed(2)}</div>
                </div>
                {resources.cpu_count > 0 && (
                  <div className="mt-1.5 text-gray-300">
                    With {resources.cpu_count} threads, values above {resources.cpu_count.toFixed(1)} indicate saturation.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <SpeedometerGauge value={resources?.cpu ?? 0} max={100} label="CPU Usage" unit="%" history={cpuHistory} color="#3b82f6" onClick={() => setDetailModal('cpu')} />
          <div className="text-center mt-2 text-sm text-gray-500 dark:text-gray-400 truncate px-2">
            {resources?.cpu_model || `${resources?.cpu_count} cores`}
          </div>
          {resources?.per_cpu && resources.per_cpu.length > 0 && (
            <div className="mt-3">
              <button
                onClick={() => setCoresExpanded(!coresExpanded)}
                className="flex items-center gap-1.5 mx-auto text-xs text-blue-500 hover:text-blue-600 transition-colors"
              >
                {coresExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {resources.cpu_count} threads @ {resources.per_cpu[0]?.frequency} MHz
              </button>
              {coresExpanded && (
                <div className="mt-2 grid grid-cols-4 gap-1">
                  {resources.per_cpu.map((core, i) => (
                    <div key={i} className="text-center">
                      <div
                        className="h-8 rounded text-xs flex items-end justify-center pb-0.5 font-mono"
                        style={{
                          background: `linear-gradient(to top, ${core.usage > 80 ? '#ef4444' : core.usage > 60 ? '#f59e0b' : '#3b82f6'} ${core.usage}%, rgba(128,128,128,0.1) ${core.usage}%)`,
                        }}
                      >
                        {core.usage.toFixed(0)}%
                      </div>
                      <div className="text-[10px] text-gray-400 mt-0.5">{core.frequency}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <SpeedometerGauge value={memoryUsedPercent} max={100} label="Memory Usage" unit="%" history={memoryHistory} color="#8b5cf6" onClick={() => setDetailModal('memory')} />
          <div className="text-center mt-2 text-sm text-gray-500 dark:text-gray-400">
            {resources?.memory && <span>{formatBytes(resources.memory.used)} / {formatBytes(resources.memory.total)}</span>}
          </div>
          {resources?.memory && resources.memory.swap_total > 0 && (
            <div className="text-center text-xs text-gray-400 mt-1">
              Swap: {formatBytes(resources.memory.swap_used)} / {formatBytes(resources.memory.swap_total)}
            </div>
          )}
        </div>
      </div>

      {resources?.gpu && resources.gpu.length > 0 && (() => {
        const sorted = resources.gpu
          .map((gpu, i) => ({ gpu, origIdx: i }))
          .sort((a, b) => (b.gpu.memory_total || 0) - (a.gpu.memory_total || 0))
        const primary = sorted[0]
        const secondary = sorted.slice(1)
        const hist = gpuHistory[primary.origIdx]
        const vramPercent = primary.gpu.memory_total && primary.gpu.memory_total > 0
          ? ((primary.gpu.memory_used || 0) / primary.gpu.memory_total) * 100 : 0

        return (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <div className="flex items-center gap-2 mb-4">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500">
                <rect x="2" y="6" width="20" height="12" rx="2" />
                <path d="M6 12h4" /><path d="M14 12h4" />
                <path d="M6 9v6" /><path d="M18 9v6" />
              </svg>
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">Graphics</h3>
            </div>

            <div
              className="border border-gray-100 dark:border-gray-700 rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors cursor-pointer"
              onClick={() => setDetailModal('gpu')}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{cleanGpuName(primary.gpu.name)}</div>
                  <div className="text-xs text-gray-400">{primary.gpu.vendor}</div>
                </div>
                <div className="flex items-center gap-4 ml-3 shrink-0">
                  {primary.gpu.temperature !== null && (
                    <div className="text-right">
                      <div className={`text-lg font-bold font-mono ${tempColor(primary.gpu.temperature)}`}>{primary.gpu.temperature}°C</div>
                      <div className="text-[10px] text-gray-400">Temp</div>
                    </div>
                  )}
                  {primary.gpu.fan_speed !== null && (
                    <div className="text-right">
                      <div className="text-lg font-bold text-gray-900 dark:text-gray-100 font-mono flex items-center gap-1 justify-end">
                        <Fan size={14} className="text-blue-500" />
                        {Math.round(primary.gpu.fan_speed)}
                      </div>
                      <div className="text-[10px] text-gray-400">RPM</div>
                    </div>
                  )}
                  {primary.gpu.usage !== null && (
                    <div className="text-right">
                      <div className="text-lg font-bold text-gray-900 dark:text-gray-100">{primary.gpu.usage.toFixed(0)}%</div>
                      <div className="text-[10px] text-gray-400">Usage</div>
                    </div>
                  )}
                </div>
              </div>

              {hist && hist.length > 1 && (() => {
                const graphW = 600
                const graphH = 48
                const stepX = graphW / (hist.length - 1 || 1)
                const dataMin = Math.min(...hist)
                const dataMax = Math.max(...hist)
                const range = dataMax - dataMin
                const padding = Math.max(range * 0.3, 2)
                const yMin = Math.max(0, dataMin - padding)
                const yMax = Math.min(100, dataMax + padding)
                const yRange = yMax - yMin || 1

                let areaPath = `M 0 ${graphH}`
                hist.forEach((val, i) => {
                  const x = i * stepX
                  const y = graphH - ((val - yMin) / yRange) * graphH
                  areaPath += ` L ${x} ${y}`
                })
                areaPath += ` L ${(hist.length - 1) * stepX} ${graphH} Z`

                let linePath = ''
                hist.forEach((val, i) => {
                  const x = i * stepX
                  const y = graphH - ((val - yMin) / yRange) * graphH
                  linePath += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`
                })

                const totalSec = hist.length
                const historyMinutes = Math.round(totalSec / 60)

                return (
                  <div className="mb-3">
                    <div className="flex items-stretch gap-1">
                      <div className="flex flex-col justify-between text-[9px] font-mono text-gray-400 w-7 shrink-0 text-right pr-0.5" style={{ height: graphH }}>
                        <span>{yMax.toFixed(0)}%</span>
                        <span>{yMin.toFixed(0)}%</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <svg width="100%" height={graphH} viewBox={`0 0 ${graphW} ${graphH}`} preserveAspectRatio="none">
                          <defs>
                            <linearGradient id="gpu-graph-grad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#10b981" stopOpacity="0.6" />
                              <stop offset="100%" stopColor="#10b981" stopOpacity="0.1" />
                            </linearGradient>
                          </defs>
                          <path d={areaPath} fill="url(#gpu-graph-grad)" />
                          <path d={linePath} fill="none" stroke="#10b981" strokeWidth="2" strokeLinejoin="round" />
                        </svg>
                        <div className="flex justify-between text-[9px] text-gray-400 mt-0.5 px-0.5">
                          <span>{historyMinutes >= 1 ? `${historyMinutes}m` : `${totalSec}s`}</span>
                          <span>now</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })()}

              {primary.gpu.memory_total !== null && primary.gpu.memory_total > 0 && (
                <div>
                  <div className="flex justify-between text-xs text-gray-400 mb-1">
                    <span>VRAM</span>
                    <span className="font-mono">{formatBytes(primary.gpu.memory_used || 0)} / {formatBytes(primary.gpu.memory_total)}</span>
                  </div>
                  <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                      style={{ width: `${vramPercent}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {secondary.length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
                <button
                  onClick={(e) => { e.stopPropagation(); setIgpuExpanded(!igpuExpanded) }}
                  className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors w-full"
                >
                  {igpuExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  {secondary.length} other GPU{secondary.length > 1 ? 's' : ''} (iGPU)
                </button>
                {igpuExpanded && secondary.map(({ gpu, origIdx }) => (
                  <div key={origIdx} className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400 py-1 mt-1">
                    <span className="truncate mr-3">{cleanGpuName(gpu.name)}</span>
                    <div className="flex items-center gap-3 shrink-0 text-xs font-mono">
                      {gpu.temperature !== null && <span className={tempColor(gpu.temperature)}>{gpu.temperature}°C</span>}
                      {gpu.usage !== null && <span>{gpu.usage.toFixed(0)}%</span>}
                      {gpu.memory_total !== null && gpu.memory_total > 0 && (
                        <span>{formatBytes(gpu.memory_used || 0)} / {formatBytes(gpu.memory_total)}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })()}

      {(() => {
        const hasTemps = resources?.temperatures && resources.temperatures.length > 0
        const hasRawFans = resources?.fans && resources.fans.length > 0
        const hasSensors = hasTemps || hasRawFans

        type DeviceSensors = { deviceId: string; deviceName: string; temps: { label: string; celsius: number }[]; fans: { label: string; rpm: number }[] }
        const grouped: Record<SensorCategory, DeviceSensors[]> = {
          cpu: [], gpu: [], storage: [], memory: [], network: [], other: [],
        }

        resources?.temperatures?.forEach(t => {
          const cat = getSensorCategory(t.sensor)
          let device = grouped[cat].find(d => d.deviceId === t.device_id)
          if (!device) {
            device = { deviceId: t.device_id, deviceName: t.device_name || '', temps: [], fans: [] }
            grouped[cat].push(device)
          }
          device.temps.push({ label: cleanTempLabel(t.label, t.sensor, cat), celsius: t.celsius })
        })
        resources?.fans?.filter(f => f.rpm > 0).forEach(f => {
          const cat = getSensorCategory(f.sensor)
          let device = grouped[cat].find(d => d.deviceId === f.device_id)
          if (!device) {
            device = { deviceId: f.device_id, deviceName: '', temps: [], fans: [] }
            grouped[cat].push(device)
          }
          device.fans.push({ label: cleanFanLabel(f.label, f.sensor), rpm: f.rpm })
        })

        const activeCategories = (Object.keys(grouped) as SensorCategory[]).filter(
          cat => grouped[cat].some(d => d.temps.length > 0 || d.fans.length > 0)
        )

        const getDeviceLabel = (cat: SensorCategory, devices: DeviceSensors[], idx: number): string => {
          const device = devices[idx]
          if (device.deviceName) return device.deviceName
          switch (cat) {
            case 'storage': return `NVMe ${idx + 1}`
            case 'memory': return `DIMM ${idx + 1}`
            case 'gpu': return `GPU ${idx + 1}`
            case 'cpu': return `CPU ${idx + 1}`
            case 'network': return `Adapter ${idx + 1}`
            default: return `Device ${idx + 1}`
          }
        }

        const toggleCategory = (cat: string) => {
          setExpandedCategories(prev => ({ ...prev, [cat]: !prev[cat] }))
        }

        return (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <button
              onClick={() => setThermalExpanded(!thermalExpanded)}
              className="w-full flex items-center gap-3 px-5 py-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
            >
              {thermalExpanded ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
              <Thermometer size={18} className="text-red-500" />
              <span className="font-semibold text-gray-900 dark:text-gray-100">Thermal</span>
              {hasSensors ? (
                <div className="flex gap-4 ml-auto text-sm">
                  {cpuPackageTemp && (
                    <span className={`font-mono font-medium ${tempColor(cpuPackageTemp.celsius)}`}>
                      CPU {cpuPackageTemp.celsius}°C
                    </span>
                  )}
                  {gpuTemp !== null && gpuTemp !== undefined && (
                    <span className={`font-mono font-medium ${tempColor(gpuTemp)}`}>
                      GPU {gpuTemp}°C
                    </span>
                  )}
                </div>
              ) : (
                <div className="ml-auto flex items-center gap-2 text-sm text-gray-400">
                  <span>No sensors detected</span>
                  <div className="relative group">
                    <Info size={14} className="text-gray-400 hover:text-blue-500 cursor-help" />
                    <div className="absolute right-0 bottom-full mb-2 w-64 p-3 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-lg shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
                      Install <span className="font-mono bg-gray-700 dark:bg-gray-600 px-1 rounded">lm-sensors</span> to enable hardware monitoring:
                      <div className="font-mono mt-1.5 bg-gray-800 dark:bg-gray-600 p-1.5 rounded">sudo apt install lm-sensors<br/>sudo sensors-detect</div>
                    </div>
                  </div>
                </div>
              )}
            </button>
            {thermalExpanded && hasSensors && (
              <div className="border-t border-gray-200 dark:border-gray-700">
                {activeCategories.map((cat, catIdx) => {
                  const meta = CATEGORY_META[cat]
                  const Icon = meta.icon
                  const isExpanded = expandedCategories[cat] !== false
                  const devices = grouped[cat]
                  const allTemps = devices.flatMap(d => d.temps)
                  const allFans = devices.flatMap(d => d.fans)

                  return (
                    <div key={cat} className={catIdx > 0 ? 'border-t border-gray-100 dark:border-gray-700' : ''}>
                      <button
                        onClick={() => toggleCategory(cat)}
                        className="w-full flex items-center gap-2.5 px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
                      >
                        {isExpanded ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
                        <Icon size={15} className={meta.color} />
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{meta.label}</span>
                        <div className="flex gap-3 ml-auto text-xs font-mono">
                          {allTemps.length > 0 && (
                            <span className={tempColor(Math.max(...allTemps.map(t => t.celsius)))}>
                              {Math.max(...allTemps.map(t => t.celsius))}°C
                            </span>
                          )}
                          {allFans.length > 0 && (
                            <span className="text-gray-500 dark:text-gray-400 flex items-center gap-1">
                              <Fan size={12} className="text-blue-500" />
                              {allFans[0].rpm} RPM
                            </span>
                          )}
                        </div>
                      </button>
                      {isExpanded && (
                        <div className="px-5 pb-3 pl-12">
                          {devices.length === 1 ? (
                            <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-1.5">
                              {devices[0].temps.map((temp, i) => (
                                <div key={`t${i}`} className="flex justify-between text-sm">
                                  <span className="text-gray-600 dark:text-gray-400 truncate mr-2">{temp.label}</span>
                                  <span className={`font-mono font-medium ${tempColor(temp.celsius)}`}>{temp.celsius}°C</span>
                                </div>
                              ))}
                              {devices[0].fans.map((fan, i) => (
                                <div key={`f${i}`} className="flex justify-between text-sm">
                                  <span className="text-gray-600 dark:text-gray-400 truncate mr-2 flex items-center gap-1">
                                    <Fan size={12} className="text-blue-400" />{fan.label}
                                  </span>
                                  <span className="font-mono font-medium text-gray-900 dark:text-gray-100">{fan.rpm} RPM</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {devices.map((device, devIdx) => (
                                <div key={device.deviceId}>
                                  <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 truncate" title={getDeviceLabel(cat, devices, devIdx)}>
                                    {getDeviceLabel(cat, devices, devIdx)}
                                  </div>
                                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-1.5">
                                    {device.temps.map((temp, i) => (
                                      <div key={`t${i}`} className="flex justify-between text-sm">
                                        <span className="text-gray-600 dark:text-gray-400 truncate mr-2">{temp.label}</span>
                                        <span className={`font-mono font-medium ${tempColor(temp.celsius)}`}>{temp.celsius}°C</span>
                                      </div>
                                    ))}
                                    {device.fans.map((fan, i) => (
                                      <div key={`f${i}`} className="flex justify-between text-sm">
                                        <span className="text-gray-600 dark:text-gray-400 truncate mr-2 flex items-center gap-1">
                                          <Fan size={12} className="text-blue-400" />{fan.label}
                                        </span>
                                        <span className="font-mono font-medium text-gray-900 dark:text-gray-100">{fan.rpm} RPM</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            {thermalExpanded && !hasSensors && (
              <div className="border-t border-gray-200 dark:border-gray-700 px-5 py-6 text-center">
                <Info size={24} className="text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                <p className="text-sm text-gray-500 dark:text-gray-400">No temperature sensors detected.</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  Install <span className="font-mono bg-gray-100 dark:bg-gray-700 px-1 rounded">lm-sensors</span> and run <span className="font-mono bg-gray-100 dark:bg-gray-700 px-1 rounded">sudo sensors-detect</span> to enable hardware monitoring.
                </p>
              </div>
            )}
          </div>
        )
      })()}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Network size={18} className="text-green-500" />
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">Network</h3>
          </div>
          {visibleNetworkRates.length > 0 ? (
            <div className="space-y-5">
              {visibleNetworkRates.map((net, i) => {
                const hist = networkHistory[net.name]
                return (
                  <div key={i}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{net.name}</span>
                      <div className="flex gap-3 text-sm font-mono">
                        <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                          <ArrowDown size={12} />{formatRate(net.rx)}
                        </span>
                        <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
                          <ArrowUp size={12} />{formatRate(net.tx)}
                        </span>
                      </div>
                    </div>
                    {hist && (hist.rx.length > 1 || hist.tx.length > 1) && (
                      <div className="flex gap-2 mt-1.5">
                        <Sparkline data={hist.rx} color="#22c55e" width={140} height={28} />
                        <Sparkline data={hist.tx} color="#3b82f6" width={140} height={28} />
                      </div>
                    )}
                    <div className="text-xs text-gray-400 mt-1">
                      Total: {formatBytes(net.totalRx)} received, {formatBytes(net.totalTx)} sent
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-sm text-gray-400">No active interfaces</div>
          )}
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <div className="flex items-center gap-2 mb-4">
            <HardDrive size={18} className="text-purple-500" />
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">Disk I/O</h3>
          </div>
          {diskIoRates.length > 0 ? (
            <div className="space-y-5">
              {diskIoRates.map((disk, i) => {
                const hist = diskIoHistory[disk.name]
                return (
                  <div key={i}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{disk.name}</span>
                      <div className="flex gap-3 text-sm font-mono">
                        <span className="text-green-600 dark:text-green-400">R {formatRate(disk.read)}</span>
                        <span className="text-blue-600 dark:text-blue-400">W {formatRate(disk.write)}</span>
                      </div>
                    </div>
                    {hist && (hist.read.length > 1 || hist.write.length > 1) && (
                      <div className="flex gap-2 mt-1.5">
                        <Sparkline data={hist.read} color="#22c55e" width={140} height={28} />
                        <Sparkline data={hist.write} color="#3b82f6" width={140} height={28} />
                      </div>
                    )}
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-purple-500 rounded-full transition-all duration-300"
                          style={{ width: `${disk.utilization}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-400 w-10 text-right font-mono">{disk.utilization.toFixed(0)}%</span>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-sm text-gray-400">No disk devices detected</div>
          )}
        </div>
      </div>

      {resources?.disks && resources.disks.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Disk Usage</h2>
          <div className="space-y-4">
            {resources.disks.map((disk) => {
              const used = disk.total_space && disk.available_space ? disk.total_space - disk.available_space : 0
              const total = disk.total_space || 0
              const usedPercent = total > 0 ? (used / total) * 100 : 0
              const barColor = usedPercent > 90 ? 'bg-red-500' : usedPercent > 75 ? 'bg-amber-500' : 'bg-green-500'

              return (
                <div key={disk.name} className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium text-gray-900 dark:text-gray-100">{disk.mount_point || disk.name}</span>
                    <span className="text-gray-500 dark:text-gray-400">{formatDiskSize(used)} / {formatDiskSize(total)}</span>
                  </div>
                  <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div className={`h-full ${barColor} rounded-full transition-all duration-300`} style={{ width: `${usedPercent}%` }} />
                  </div>
                  <div className="text-xs text-gray-400">{usedPercent.toFixed(1)}% used</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {detailModal === 'cpu' && resources && (
        <DetailModal title="CPU Details" onClose={() => setDetailModal(null)}>
          <div className="space-y-6">
            <div>
              <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{resources.cpu.toFixed(1)}%</div>
              <div className="text-sm text-gray-500 dark:text-gray-400">{resources.cpu_model}</div>
              <div className="text-sm text-gray-400">{resources.cpu_count} threads</div>
              {resources.load_avg && (
                <div className="text-sm text-gray-400 mt-1">
                  Load: {resources.load_avg[0].toFixed(2)} / {resources.load_avg[1].toFixed(2)} / {resources.load_avg[2].toFixed(2)}
                </div>
              )}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Usage History (last 5 min)</h3>
              <FullGraph data={cpuHistory} color="#3b82f6" />
            </div>
            {resources.per_cpu && resources.per_cpu.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Per Thread</h3>
                <div className="grid grid-cols-8 gap-1">
                  {resources.per_cpu.map((core, i) => (
                    <div key={i} className="text-center">
                      <div
                        className="h-10 rounded text-xs flex items-end justify-center pb-0.5 font-mono"
                        style={{
                          background: `linear-gradient(to top, ${core.usage > 80 ? '#ef4444' : core.usage > 60 ? '#f59e0b' : '#3b82f6'} ${core.usage}%, rgba(128,128,128,0.1) ${core.usage}%)`,
                        }}
                      >
                        {core.usage.toFixed(0)}%
                      </div>
                      <div className="text-[9px] text-gray-400 mt-0.5">{core.frequency}MHz</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </DetailModal>
      )}

      {detailModal === 'memory' && resources && (
        <DetailModal title="Memory Details" onClose={() => setDetailModal(null)}>
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-sm text-gray-500 dark:text-gray-400">Physical Memory</div>
                <div className="text-xl font-bold text-gray-900 dark:text-gray-100">
                  {formatBytes(resources.memory.used)} / {formatBytes(resources.memory.total)}
                </div>
                <div className="text-sm text-gray-400">{memoryUsedPercent.toFixed(1)}% used</div>
              </div>
              {resources.memory.swap_total > 0 && (
                <div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">Swap</div>
                  <div className="text-xl font-bold text-gray-900 dark:text-gray-100">
                    {formatBytes(resources.memory.swap_used)} / {formatBytes(resources.memory.swap_total)}
                  </div>
                  <div className="text-sm text-gray-400">
                    {resources.memory.swap_total > 0 ? ((resources.memory.swap_used / resources.memory.swap_total) * 100).toFixed(1) : '0'}% used
                  </div>
                </div>
              )}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Usage History (last 5 min)</h3>
              <FullGraph data={memoryHistory} color="#8b5cf6" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Breakdown</h3>
              <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden flex">
                <div
                  className="h-full bg-purple-500 transition-all"
                  style={{ width: `${(resources.memory.used / resources.memory.total) * 100}%` }}
                  title="Used"
                />
              </div>
              <div className="flex gap-4 mt-2 text-xs text-gray-500">
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-purple-500 rounded" /> Used: {formatBytes(resources.memory.used)}</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-gray-300 dark:bg-gray-600 rounded" /> Free: {formatBytes(resources.memory.total - resources.memory.used)}</span>
              </div>
            </div>
          </div>
        </DetailModal>
      )}

      {detailModal === 'gpu' && resources?.gpu?.[0] && (
        <DetailModal title="GPU Details" onClose={() => setDetailModal(null)}>
          <div className="space-y-6">
            {resources.gpu.map((gpu, i) => {
              const hist = gpuHistory[i]
              return (
                <div key={i} className={i > 0 ? 'pt-6 border-t border-gray-200 dark:border-gray-700' : ''}>
                  <div className="text-xl font-bold text-gray-900 dark:text-gray-100">{cleanGpuName(gpu.name)}</div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">{gpu.vendor}</div>
                  <div className="grid grid-cols-2 gap-4 mt-4">
                    {gpu.usage !== null && (
                      <div>
                        <div className="text-sm text-gray-400">Utilization</div>
                        <div className="text-lg font-bold text-gray-900 dark:text-gray-100">{gpu.usage}%</div>
                      </div>
                    )}
                    {gpu.temperature !== null && (
                      <div>
                        <div className="text-sm text-gray-400">Temperature</div>
                        <div className={`text-lg font-bold ${tempColor(gpu.temperature)}`}>{gpu.temperature}°C</div>
                      </div>
                    )}
                    {gpu.memory_total !== null && gpu.memory_total > 0 && (
                      <div>
                        <div className="text-sm text-gray-400">VRAM</div>
                        <div className="text-lg font-bold text-gray-900 dark:text-gray-100">
                          {formatBytes(gpu.memory_used || 0)} / {formatBytes(gpu.memory_total)}
                        </div>
                      </div>
                    )}
                    {gpu.fan_speed !== null && (
                      <div>
                        <div className="text-sm text-gray-400">Fan Speed</div>
                        <div className="text-lg font-bold text-gray-900 dark:text-gray-100">{Math.round(gpu.fan_speed)} RPM</div>
                      </div>
                    )}
                  </div>
                  {hist && hist.length > 1 && (
                    <div className="mt-4">
                      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Usage History (last 5 min)</h3>
                      <FullGraph data={hist} color="#10b981" />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </DetailModal>
      )}
    </div>
  )
}
