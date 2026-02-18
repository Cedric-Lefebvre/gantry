import { useEffect, useState } from 'react'
import { X, Copy, Check, Download, RefreshCw } from 'lucide-react'
import { getOsInfo, getResources } from '../api/system'
import { invoke } from '@tauri-apps/api/core'

interface OsInfo {
  os_pretty: string
  kernel: string
  hostname: string
  arch: string
}

interface Resources {
  cpu_model: string
  memory: { total: number }
  gpu: null | Array<{ name: string; vendor: string; memory_total?: number }>
}

interface ProcessorInfo {
  model: string
  cores: number
  threads: number
}

interface BlockDevice {
  name: string
  size: string
  type: string
  model: string | null
  tran: string | null
  rota: boolean | null
  children?: BlockDevice[]
}

function fmtBytes(bytes: number): string {
  const gb = bytes / 1024 / 1024 / 1024
  if (gb >= 1) return gb.toFixed(1) + ' GB'
  return (bytes / 1024 / 1024).toFixed(0) + ' MB'
}

// Round up to the nearest standard RAM size (physical sticks are always a bit
// less than advertised once the OS subtracts reserved memory)
function physicalRam(bytes: number): string {
  const gb = bytes / 1024 / 1024 / 1024
  const standards = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512]
  const rounded = standards.find(s => s >= Math.round(gb)) ?? Math.ceil(gb)
  return `${rounded} GB`
}

function cleanGpuName(name: string): string {
  return name
    .replace(/^Advanced Micro Devices, Inc\. \[AMD\/ATI\] /, '')
    .replace(/\s*\(rev [0-9a-f]+\)\s*$/, '')
    .replace(/^.*\[([^\]]+)\].*$/, '$1')
    .trim()
}

function buildReport(
  os: OsInfo,
  res: Resources,
  proc: ProcessorInfo | null,
  blockDevices: BlockDevice[]
): string {
  const lines: string[] = []
  const date = new Date().toISOString().slice(0, 10)

  lines.push(`System Report — ${date}`)
  lines.push('')

  lines.push(`OS:      ${os.os_pretty}`)
  lines.push(`Kernel:  ${os.kernel}`)
  lines.push(`Arch:    ${os.arch}`)
  lines.push('')

  const cpuModel = proc?.model || res.cpu_model
  lines.push(`CPU:     ${cpuModel}`)
  if (proc) lines.push(`         ${proc.cores} cores / ${proc.threads} threads`)
  lines.push('')

  lines.push(`RAM:     ${physicalRam(res.memory.total)}`)
  lines.push('')

  if (res.gpu && res.gpu.length > 0) {
    // If any GPU has more than 2 GB VRAM, drop GPUs with less than 1 GB (iGPU)
    const maxVram = Math.max(...res.gpu.map(g => g.memory_total ?? 0))
    const gpus = maxVram > 2 * 1024 * 1024 * 1024
      ? res.gpu.filter(g => (g.memory_total ?? 0) >= 1024 * 1024 * 1024)
      : res.gpu
    lines.push('GPU:')
    for (const gpu of gpus) {
      const name = cleanGpuName(gpu.name)
      const vram = gpu.memory_total ? ` (${fmtBytes(gpu.memory_total)} VRAM)` : ''
      lines.push(`  ${name}${vram}`)
    }
    lines.push('')
  }

  const topDisks = blockDevices.filter(d => d.type === 'disk' && !d.name.startsWith('zram') && !d.name.startsWith('loop') && !d.name.startsWith('ram'))
  if (topDisks.length > 0) {
    lines.push('Storage:')
    for (const disk of topDisks) {
      const model = disk.model?.trim() || disk.name
      const tran = disk.tran?.toUpperCase() || ''
      const kind = disk.rota === true ? 'HDD' : disk.rota === false ? 'SSD' : ''
      const size = disk.size || ''
      const tags = [tran, kind, size].filter(Boolean).join(', ')
      lines.push(`  ${model}${tags ? `  (${tags})` : ''}`)
    }
  }

  return lines.join('\n')
}

export default function SystemReportModal({ onClose }: { onClose: () => void }) {
  const [report, setReport] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const fetchData = async () => {
    setLoading(true)
    setSavedPath(null)
    setSaveError(null)
    try {
      const [os, res, proc, devs] = await Promise.allSettled([
        getOsInfo() as Promise<OsInfo>,
        getResources() as Promise<Resources>,
        invoke<ProcessorInfo>('get_processor_info'),
        invoke<{ blockdevices?: BlockDevice[] }>('list_devices'),
      ])

      const osData = os.status === 'fulfilled' ? os.value : { os_pretty: 'Linux', kernel: 'unknown', hostname: 'unknown', arch: 'x86_64' }
      const resData = res.status === 'fulfilled' ? res.value : null
      const procData = proc.status === 'fulfilled' ? proc.value : null
      const blockDevices = devs.status === 'fulfilled' ? (devs.value?.blockdevices ?? []) : []

      if (resData) {
        setReport(buildReport(osData, resData, procData, blockDevices))
      } else {
        setReport('Failed to load system information.')
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  const handleCopy = () => {
    navigator.clipboard.writeText(report).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleDownload = async () => {
    setSavedPath(null)
    setSaveError(null)
    try {
      const filename = `system-report-${new Date().toISOString().slice(0, 10)}.txt`
      const path = await invoke<string>('save_report_file', { content: report, filename })
      setSavedPath(path)
    } catch (err) {
      setSaveError(String(err))
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 w-full max-w-lg mx-4 flex flex-col max-h-[80vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">System Report</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchData}
              disabled={loading}
              className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
              title="Refresh"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={handleCopy}
              disabled={loading || !report}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg transition-colors disabled:opacity-40"
            >
              {copied ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <button
              onClick={handleDownload}
              disabled={loading || !report}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-40"
            >
              <Download size={13} />
              Save .txt
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12 gap-3 text-gray-400">
              <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm">Gathering system info…</span>
            </div>
          ) : (
            <pre className="text-xs font-mono text-gray-700 dark:text-gray-300 whitespace-pre leading-relaxed">
              {report}
            </pre>
          )}
        </div>

        {(savedPath || saveError) && (
          <div className={`px-4 py-2.5 border-t text-xs font-mono ${
            saveError
              ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
              : 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'
          }`}>
            {saveError ? `Error: ${saveError}` : `Saved to ${savedPath}`}
          </div>
        )}
      </div>
    </div>
  )
}
