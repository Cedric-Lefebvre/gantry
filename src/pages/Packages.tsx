import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { ArrowRight, ArrowUpCircle, Archive, Eraser, FileWarning, PackageX, RotateCw, Trash2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import CopyableText from '../components/CopyableText'

interface PackageUpdate {
  name: string
  current: string
  new: string
}

interface InstalledPackage {
  name: string
  version: string
}

interface Maintenance {
  orphans: InstalledPackage[]
  cache: { path: string; size: number; packages: number }
  unmerged_configs: string[]
}

interface Updates {
  updates: PackageUpdate[]
  fresh: boolean
}

type Action = 'orphans' | 'cache'

const UPGRADE_COMMAND = 'sudo pacman -Syu'

const ACTIONS: Record<Action, { command: string; title: string; confirm: string }> = {
  orphans: { command: 'remove_orphan_packages', title: 'Remove Orphaned Packages', confirm: 'Remove' },
  cache: { command: 'clean_package_cache', title: 'Clean Package Cache', confirm: 'Clean' },
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(1)} ${units[unit]}`
}

function Section({ icon: Icon, title, count, action, children }: {
  icon: LucideIcon
  title: string
  count?: number
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-200 dark:border-gray-700">
        <Icon size={18} className="text-blue-500" />
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
        {count !== undefined && (
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
            count > 0
              ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
              : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
          }`}>
            {count}
          </span>
        )}
        <div className="ml-auto">{action}</div>
      </div>
      {children}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-5 py-4 text-sm text-gray-500 dark:text-gray-400">{children}</div>
}

export default function Packages() {
  const [maintenance, setMaintenance] = useState<Maintenance | null>(null)
  const [updates, setUpdates] = useState<Updates | null>(null)
  const [updatesError, setUpdatesError] = useState<string | null>(null)
  const [checkingUpdates, setCheckingUpdates] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<Action | null>(null)
  const [runningAction, setRunningAction] = useState<Action | null>(null)
  const [actionOutput, setActionOutput] = useState<string | null>(null)

  useEffect(() => {
    refresh()
  }, [])

  const fetchMaintenance = async () => {
    try {
      setMaintenance(await invoke<Maintenance>('get_package_maintenance'))
      setError(null)
    } catch (err) {
      setError(String(err))
    }
  }

  // Checking for updates queries the mirrors, so it loads on its own
  const fetchUpdates = async () => {
    setCheckingUpdates(true)
    try {
      setUpdates(await invoke<Updates>('list_package_updates'))
      setUpdatesError(null)
    } catch (err) {
      setUpdatesError(String(err))
    } finally {
      setCheckingUpdates(false)
    }
  }

  const refresh = () => {
    fetchMaintenance()
    fetchUpdates()
  }

  const runAction = async (action: Action) => {
    setConfirmAction(null)
    setRunningAction(action)
    setActionOutput(null)
    try {
      const result = await invoke<{ output: string }>(ACTIONS[action].command)
      setActionOutput(result.output)
      setError(null)
    } catch (err) {
      setError(String(err))
    } finally {
      setRunningAction(null)
      fetchMaintenance()
    }
  }

  const actionButton = (action: Action, label: string, Icon: LucideIcon, disabled: boolean) => (
    <button
      onClick={() => setConfirmAction(action)}
      disabled={disabled || runningAction !== null}
      className="flex items-center gap-2 px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-gray-900 dark:text-gray-100 rounded-lg transition-colors"
    >
      {runningAction === action
        ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
        : <Icon size={14} />}
      {label}
    </button>
  )

  if (!maintenance && !error) return <div className="p-4 text-gray-900 dark:text-gray-100">Loading packages...</div>

  const orphans = maintenance?.orphans ?? []
  const unmerged = maintenance?.unmerged_configs ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Packages</h1>
        <button
          onClick={refresh}
          className="flex items-center gap-2 px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 rounded-lg transition-colors"
        >
          <RotateCw size={16} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-sm text-red-800 dark:text-red-300 whitespace-pre-wrap">{error}</p>
        </div>
      )}

      {actionOutput && (
        <pre className="bg-gray-900 text-gray-300 text-xs font-mono rounded-lg p-4 max-h-48 overflow-y-auto whitespace-pre-wrap">{actionOutput}</pre>
      )}

      <Section
        icon={ArrowUpCircle}
        title="Pending Updates"
        count={checkingUpdates || updatesError ? undefined : updates?.updates.length}
        action={
          <CopyableText value={UPGRADE_COMMAND}>
            <code className="text-xs font-mono bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-2 py-1 rounded">{UPGRADE_COMMAND}</code>
          </CopyableText>
        }
      >
        {checkingUpdates ? (
          <div className="flex items-center gap-3 px-5 py-4 text-sm text-gray-500 dark:text-gray-400">
            <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            Checking for updates...
          </div>
        ) : updatesError ? (
          <Empty><span className="text-red-600 dark:text-red-400">{updatesError}</span></Empty>
        ) : !updates || updates.updates.length === 0 ? (
          <Empty>The system is up to date.</Empty>
        ) : (
          <div className="max-h-80 overflow-y-auto divide-y divide-gray-200 dark:divide-gray-700">
            {updates.updates.map(pkg => (
              <div key={pkg.name} className="flex items-center gap-3 px-5 py-2 text-sm">
                <span className="font-mono font-medium text-gray-900 dark:text-gray-100 flex-1 truncate">{pkg.name}</span>
                <span className="font-mono text-xs text-gray-500 dark:text-gray-400">{pkg.current}</span>
                <ArrowRight size={12} className="text-gray-400" />
                <span className="font-mono text-xs text-green-600 dark:text-green-400">{pkg.new}</span>
              </div>
            ))}
          </div>
        )}
        {updates && !updates.fresh && !checkingUpdates && (
          <div className="px-5 py-2 text-xs text-gray-400 dark:text-gray-500 border-t border-gray-200 dark:border-gray-700">
            Based on the last database sync. Install <span className="font-mono">pacman-contrib</span> for a live check.
          </div>
        )}
      </Section>

      <Section
        icon={PackageX}
        title="Orphaned Packages"
        count={orphans.length}
        action={actionButton('orphans', 'Remove all', Trash2, orphans.length === 0)}
      >
        {orphans.length === 0 ? (
          <Empty>No orphaned packages.</Empty>
        ) : (
          <div className="max-h-60 overflow-y-auto divide-y divide-gray-200 dark:divide-gray-700">
            {orphans.map(pkg => (
              <div key={pkg.name} className="flex items-center gap-3 px-5 py-2 text-sm">
                <span className="font-mono font-medium text-gray-900 dark:text-gray-100 flex-1 truncate">{pkg.name}</span>
                <span className="font-mono text-xs text-gray-500 dark:text-gray-400">{pkg.version}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        icon={Archive}
        title="Package Cache"
        action={actionButton('cache', 'Clean', Eraser, (maintenance?.cache.packages ?? 0) === 0)}
      >
        <div className="flex items-center gap-8 px-5 py-4">
          <div>
            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{formatBytes(maintenance?.cache.size ?? 0)}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">on disk</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{maintenance?.cache.packages ?? 0}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">cached packages</div>
          </div>
          <div className="ml-auto text-xs font-mono text-gray-400 dark:text-gray-500 truncate">{maintenance?.cache.path}</div>
        </div>
      </Section>

      <Section icon={FileWarning} title="Config Files to Merge" count={unmerged.length}>
        {unmerged.length === 0 ? (
          <Empty>No .pacnew or .pacsave files in /etc.</Empty>
        ) : (
          <>
            <div className="max-h-60 overflow-y-auto divide-y divide-gray-200 dark:divide-gray-700">
              {unmerged.map(path => (
                <div key={path} className="px-5 py-2 text-sm">
                  <CopyableText value={path}>
                    <span className="font-mono text-gray-900 dark:text-gray-100">{path}</span>
                  </CopyableText>
                </div>
              ))}
            </div>
            <div className="px-5 py-2 text-xs text-gray-400 dark:text-gray-500 border-t border-gray-200 dark:border-gray-700">
              Package updates left these next to your edited files. Review and merge them with <span className="font-mono">sudo pacdiff</span>.
            </div>
          </>
        )}
      </Section>

      {confirmAction && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setConfirmAction(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-sm mx-4 border border-gray-200 dark:border-gray-700" onClick={e => e.stopPropagation()}>
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">{ACTIONS[confirmAction].title}</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
              {confirmAction === 'orphans'
                ? `This uninstalls ${orphans.length} package${orphans.length !== 1 ? 's' : ''} that nothing depends on any more, along with their configuration files.`
                : 'This deletes old package files from the cache and keeps the 3 most recent versions of each package.'}
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmAction(null)}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => runAction(confirmAction)}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
              >
                {ACTIONS[confirmAction].confirm}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
