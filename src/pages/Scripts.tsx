import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Plus, Play, Trash2, Shield, Terminal, X, Check, AlertCircle, Eye, Pencil, ChevronDown, ChevronUp } from 'lucide-react'

interface CustomScript {
  id: string
  name: string
  command: string
  requires_sudo: boolean
}

interface ScriptResult {
  success: boolean
  stdout: string
  stderr: string
  exit_code: number | null
}

interface ExecutionLog {
  scriptName: string
  command: string
  result: ScriptResult
  timestamp: Date
}

export default function Scripts() {
  const [scripts, setScripts] = useState<CustomScript[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingScript, setEditingScript] = useState<CustomScript | null>(null)
  const [newScript, setNewScript] = useState({ name: '', command: '', requires_sudo: false })
  const [runningScript, setRunningScript] = useState<string | null>(null)
  const [hoveredScript, setHoveredScript] = useState<string | null>(null)
  const [executionLogs, setExecutionLogs] = useState<ExecutionLog[]>([])
  const [terminalExpanded, setTerminalExpanded] = useState(true)

  useEffect(() => {
    fetchScripts()
  }, [])

  const fetchScripts = async () => {
    try {
      const data = await invoke<CustomScript[]>('list_scripts')
      setScripts(data)
    } catch (err) {
      console.error('Failed to load scripts:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleAddScript = async () => {
    if (!newScript.name.trim() || !newScript.command.trim()) return

    try {
      await invoke('add_script', {
        name: newScript.name,
        command: newScript.command,
        requiresSudo: newScript.requires_sudo,
      })
      setNewScript({ name: '', command: '', requires_sudo: false })
      setShowAddModal(false)
      fetchScripts()
    } catch (err) {
      console.error('Failed to add script:', err)
    }
  }

  const handleUpdateScript = async () => {
    if (!editingScript || !editingScript.name.trim() || !editingScript.command.trim()) return

    try {
      await invoke('update_script', {
        id: editingScript.id,
        name: editingScript.name,
        command: editingScript.command,
        requiresSudo: editingScript.requires_sudo,
      })
      setEditingScript(null)
      fetchScripts()
    } catch (err) {
      console.error('Failed to update script:', err)
    }
  }

  const handleRemoveScript = async (id: string) => {
    try {
      await invoke('remove_script', { id })
      fetchScripts()
    } catch (err) {
      console.error('Failed to remove script:', err)
    }
  }

  const handleRunScript = async (script: CustomScript) => {
    setRunningScript(script.id)
    setTerminalExpanded(true)
    try {
      const result = await invoke<ScriptResult>('run_script', { id: script.id })
      setExecutionLogs(prev => [{
        scriptName: script.name,
        command: script.command,
        result,
        timestamp: new Date(),
      }, ...prev].slice(0, 50))
    } catch (err) {
      setExecutionLogs(prev => [{
        scriptName: script.name,
        command: script.command,
        result: {
          success: false,
          stdout: '',
          stderr: err instanceof Error ? err.message : String(err),
          exit_code: -1,
        },
        timestamp: new Date(),
      }, ...prev].slice(0, 50))
    } finally {
      setRunningScript(null)
    }
  }

  const clearLogs = () => {
    setExecutionLogs([])
  }

  if (loading) return <div className="p-4 text-gray-900 dark:text-gray-100">Loading scripts...</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Custom Scripts</h1>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
        >
          <Plus size={20} />
          Add Script
        </button>
      </div>

      {scripts.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-8 text-center">
          <Terminal size={48} className="mx-auto text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">No scripts yet</h3>
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            Add custom scripts to quickly run common commands
          </p>
          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            <Plus size={20} />
            Add your first script
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {scripts.map((script) => (
            <div
              key={script.id}
              className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex flex-col"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-gray-900 dark:text-gray-100">{script.name}</h3>
                  {script.requires_sudo && (
                    <Shield size={16} className="text-amber-500" title="Requires admin privileges" />
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <div
                    className="relative"
                    onMouseEnter={() => setHoveredScript(script.id)}
                    onMouseLeave={() => setHoveredScript(null)}
                  >
                    <button
                      className="p-1.5 text-gray-400 hover:text-blue-500 transition-colors"
                      title="View command"
                    >
                      <Eye size={16} />
                    </button>
                    {hoveredScript === script.id && (
                      <div className="absolute right-0 top-8 z-10 w-64 p-3 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-lg shadow-lg">
                        <div className="text-gray-400 mb-1">Command:</div>
                        <code className="block whitespace-pre-wrap break-all font-mono">
                          {script.command}
                        </code>
                        <div className="absolute -top-1.5 right-3 w-3 h-3 bg-gray-900 dark:bg-gray-700 rotate-45" />
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => setEditingScript({ ...script })}
                    className="p-1.5 text-gray-400 hover:text-blue-500 transition-colors"
                    title="Edit script"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    onClick={() => handleRemoveScript(script.id)}
                    className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                    title="Delete script"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              <button
                onClick={() => handleRunScript(script)}
                disabled={runningScript === script.id}
                className={`flex items-center justify-center gap-2 w-full py-2 rounded-lg transition-colors ${
                  runningScript === script.id
                    ? 'bg-gray-300 dark:bg-gray-600 cursor-not-allowed text-gray-600 dark:text-gray-300'
                    : 'bg-green-600 hover:bg-green-700 text-white'
                }`}
              >
                {runningScript === script.id ? (
                  <>
                    <div className="w-4 h-4 border-2 border-gray-600 dark:border-gray-300 border-t-transparent rounded-full animate-spin" />
                    Running...
                  </>
                ) : (
                  <>
                    <Play size={16} />
                    Run
                  </>
                )}
              </button>
            </div>
          ))}
        </div>
      )}

      {executionLogs.length > 0 && (
        <div className="bg-gray-900 rounded-xl border border-gray-700 overflow-hidden">
          <div
            className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700 cursor-pointer"
            onClick={() => setTerminalExpanded(!terminalExpanded)}
          >
            <div className="flex items-center gap-3">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-500" />
                <div className="w-3 h-3 rounded-full bg-yellow-500" />
                <div className="w-3 h-3 rounded-full bg-green-500" />
              </div>
              <span className="text-gray-300 text-sm font-medium">Terminal Output</span>
              <span className="text-gray-500 text-xs">({executionLogs.length} executions)</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); clearLogs(); }}
                className="text-xs text-gray-400 hover:text-gray-200 transition-colors"
              >
                Clear
              </button>
              {terminalExpanded ? (
                <ChevronDown size={16} className="text-gray-400" />
              ) : (
                <ChevronUp size={16} className="text-gray-400" />
              )}
            </div>
          </div>

          {terminalExpanded && (
            <div className="max-h-80 overflow-y-auto p-4 font-mono text-sm">
              {executionLogs.map((log, index) => (
                <div key={index} className="mb-4 last:mb-0">
                  <div className="flex items-start gap-2 mb-1">
                    <span className="text-green-400 select-none">$</span>
                    <span className="text-gray-300">{log.command}</span>
                  </div>

                  <div className="flex items-center gap-2 mb-2 ml-4">
                    <span className="text-gray-500 text-xs">
                      [{log.timestamp.toLocaleTimeString()}]
                    </span>
                    <span className="text-gray-500 text-xs">{log.scriptName}</span>
                    {log.result.success ? (
                      <span className="flex items-center gap-1 text-green-400 text-xs">
                        <Check size={12} />
                        exit 0
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-red-400 text-xs">
                        <AlertCircle size={12} />
                        exit {log.result.exit_code}
                      </span>
                    )}
                  </div>

                  {log.result.stdout && (
                    <pre className="text-gray-300 whitespace-pre-wrap ml-4 mb-1">{log.result.stdout}</pre>
                  )}
                  {log.result.stderr && (
                    <pre className="text-red-400 whitespace-pre-wrap ml-4">{log.result.stderr}</pre>
                  )}

                  {index < executionLogs.length - 1 && (
                    <div className="border-t border-gray-700 mt-4" />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-md mx-4 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Add Custom Script</h2>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Script Name
                </label>
                <input
                  type="text"
                  value={newScript.name}
                  onChange={(e) => setNewScript({ ...newScript, name: e.target.value })}
                  placeholder="e.g., Network Reset"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Command
                </label>
                <textarea
                  value={newScript.command}
                  onChange={(e) => setNewScript({ ...newScript, command: e.target.value })}
                  placeholder="e.g., hciconfig hci0 reset"
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                />
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="requires_sudo"
                  checked={newScript.requires_sudo}
                  onChange={(e) => setNewScript({ ...newScript, requires_sudo: e.target.checked })}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <label htmlFor="requires_sudo" className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-2">
                  <Shield size={16} className="text-amber-500" />
                  Requires admin privileges (sudo)
                </label>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddScript}
                  disabled={!newScript.name.trim() || !newScript.command.trim()}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg transition-colors"
                >
                  Add Script
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editingScript && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-md mx-4 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Edit Script</h2>
              <button
                onClick={() => setEditingScript(null)}
                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Script Name
                </label>
                <input
                  type="text"
                  value={editingScript.name}
                  onChange={(e) => setEditingScript({ ...editingScript, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Command
                </label>
                <textarea
                  value={editingScript.command}
                  onChange={(e) => setEditingScript({ ...editingScript, command: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                />
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="edit_requires_sudo"
                  checked={editingScript.requires_sudo}
                  onChange={(e) => setEditingScript({ ...editingScript, requires_sudo: e.target.checked })}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <label htmlFor="edit_requires_sudo" className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-2">
                  <Shield size={16} className="text-amber-500" />
                  Requires admin privileges (sudo)
                </label>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setEditingScript(null)}
                  className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpdateScript}
                  disabled={!editingScript.name.trim() || !editingScript.command.trim()}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg transition-colors"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
