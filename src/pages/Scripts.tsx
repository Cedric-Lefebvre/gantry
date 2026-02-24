import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Plus, Play, Trash2, Shield, Terminal, X, Check, AlertCircle, Eye, Pencil, ChevronDown, ChevronUp } from 'lucide-react'

interface ScriptPrompt {
  variable: string
  label: string
}

interface CustomScript {
  id: string
  name: string
  command: string
  requires_sudo: boolean
  prompts: ScriptPrompt[]
}

interface ScriptResult {
  success: boolean
  stdout: string
  stderr: string
  exit_code: number | null
  resolved_command?: string
}

interface ExecutionLog {
  scriptName: string
  command: string
  result: ScriptResult
  timestamp: Date
}

type ScriptForm = {
  name: string
  command: string
  requires_sudo: boolean
  prompts: ScriptPrompt[]
}

const emptyForm = (): ScriptForm => ({ name: '', command: '', requires_sudo: false, prompts: [] })

export default function Scripts() {
  const [scripts, setScripts] = useState<CustomScript[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingScript, setEditingScript] = useState<CustomScript | null>(null)
  const [newScript, setNewScript] = useState<ScriptForm>(emptyForm())
  const [runningScript, setRunningScript] = useState<string | null>(null)
  const [hoveredScript, setHoveredScript] = useState<string | null>(null)
  const [executionLogs, setExecutionLogs] = useState<ExecutionLog[]>([])
  const [terminalExpanded, setTerminalExpanded] = useState(true)
  const [promptModal, setPromptModal] = useState<{ script: CustomScript; values: Record<string, string> } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null)

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
        prompts: newScript.prompts,
      })
      setNewScript(emptyForm())
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
        prompts: editingScript.prompts,
      })
      setEditingScript(null)
      fetchScripts()
    } catch (err) {
      console.error('Failed to update script:', err)
    }
  }

  const handleRemoveScript = (id: string, name: string) => {
    setConfirmDelete({ id, name })
  }

  const confirmRemoveScript = async () => {
    if (!confirmDelete) return
    try {
      await invoke('remove_script', { id: confirmDelete.id })
      setConfirmDelete(null)
      fetchScripts()
    } catch (err) {
      console.error('Failed to remove script:', err)
    }
  }

  const initiateRun = (script: CustomScript) => {
    if (script.prompts.length > 0) {
      const initial: Record<string, string> = {}
      script.prompts.forEach(p => { initial[p.variable] = '' })
      setPromptModal({ script, values: initial })
    } else {
      executeScript(script, null)
    }
  }

  const executeScript = async (script: CustomScript, args: Record<string, string> | null) => {
    setPromptModal(null)
    setRunningScript(script.id)
    setTerminalExpanded(true)
    try {
      const result = await invoke<ScriptResult>('run_script', { id: script.id, args })
      setExecutionLogs(prev => [{
        scriptName: script.name,
        command: result.resolved_command ?? script.command,
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

  const clearLogs = () => setExecutionLogs([])

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
                    <button className="p-1.5 text-gray-400 hover:text-blue-500 transition-colors" title="View command">
                      <Eye size={16} />
                    </button>
                    {hoveredScript === script.id && (
                      <div className="absolute right-0 top-8 z-10 w-64 p-3 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-lg shadow-lg">
                        <div className="text-gray-400 mb-1">Command:</div>
                        <code className="block whitespace-pre-wrap break-all font-mono">{script.command}</code>
                        {script.prompts.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-gray-700">
                            <div className="text-gray-400 mb-1">Prompts:</div>
                            {script.prompts.map(p => (
                              <div key={p.variable} className="font-mono text-blue-300">{`{${p.variable}}`} — {p.label}</div>
                            ))}
                          </div>
                        )}
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
                    onClick={() => handleRemoveScript(script.id, script.name)}
                    className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                    title="Delete script"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              <button
                onClick={() => initiateRun(script)}
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
                    {script.prompts.length > 0 ? 'Run…' : 'Run'}
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
                onClick={(e) => { e.stopPropagation(); clearLogs() }}
                className="text-xs text-gray-400 hover:text-gray-200 transition-colors"
              >
                Clear
              </button>
              {terminalExpanded ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronUp size={16} className="text-gray-400" />}
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
                    <span className="text-gray-500 text-xs">[{log.timestamp.toLocaleTimeString()}]</span>
                    <span className="text-gray-500 text-xs">{log.scriptName}</span>
                    {log.result.success ? (
                      <span className="flex items-center gap-1 text-green-400 text-xs"><Check size={12} />exit 0</span>
                    ) : (
                      <span className="flex items-center gap-1 text-red-400 text-xs"><AlertCircle size={12} />exit {log.result.exit_code}</span>
                    )}
                  </div>
                  {log.result.stdout && <pre className="text-gray-300 whitespace-pre-wrap ml-4 mb-1">{log.result.stdout}</pre>}
                  {log.result.stderr && <pre className="text-red-400 whitespace-pre-wrap ml-4">{log.result.stderr}</pre>}
                  {index < executionLogs.length - 1 && <div className="border-t border-gray-700 mt-4" />}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add Script Modal */}
      {showAddModal && (
        <ScriptFormModal
          title="Add Custom Script"
          form={newScript}
          onChange={setNewScript}
          onConfirm={handleAddScript}
          onClose={() => { setShowAddModal(false); setNewScript(emptyForm()) }}
          confirmLabel="Add Script"
        />
      )}

      {/* Edit Script Modal */}
      {editingScript && (
        <ScriptFormModal
          title="Edit Script"
          form={editingScript}
          onChange={(f) => setEditingScript({ ...editingScript, ...f })}
          onConfirm={handleUpdateScript}
          onClose={() => setEditingScript(null)}
          confirmLabel="Save Changes"
        />
      )}

      {/* Prompt Modal */}
      {promptModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-md mx-4 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Run — {promptModal.script.name}</h2>
              <button onClick={() => setPromptModal(null)} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              {promptModal.script.prompts.map(p => (
                <div key={p.variable}>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{p.label}</label>
                  <input
                    type="text"
                    value={promptModal.values[p.variable] ?? ''}
                    onChange={(e) => setPromptModal(prev => prev ? {
                      ...prev,
                      values: { ...prev.values, [p.variable]: e.target.value }
                    } : null)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') executeScript(promptModal.script, promptModal.values)
                    }}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
                    autoFocus={promptModal.script.prompts[0].variable === p.variable}
                  />
                </div>
              ))}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setPromptModal(null)}
                  className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => executeScript(promptModal.script, promptModal.values)}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
                >
                  <Play size={16} />
                  Run
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-sm mx-4 shadow-xl">
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">Delete Script</h2>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              Are you sure you want to delete <span className="font-semibold text-gray-900 dark:text-gray-100">{confirmDelete.name}</span>? This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmRemoveScript}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
                title="Confirm delete"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ScriptFormModal({
  title,
  form,
  onChange,
  onConfirm,
  onClose,
  confirmLabel,
}: {
  title: string
  form: ScriptForm
  onChange: (f: ScriptForm) => void
  onConfirm: () => void
  onClose: () => void
  confirmLabel: string
}) {
  const addPrompt = () => onChange({ ...form, prompts: [...form.prompts, { variable: '', label: '' }] })

  const updatePrompt = (index: number, field: keyof ScriptPrompt, value: string) => {
    const prompts = form.prompts.map((p, i) => i === index ? { ...p, [field]: value } : p)
    onChange({ ...form, prompts })
  }

  const removePrompt = (index: number) => {
    onChange({ ...form, prompts: form.prompts.filter((_, i) => i !== index) })
  }

  const valid = form.name.trim() !== '' && form.command.trim() !== ''

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-md mx-4 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{title}</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Script Name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => onChange({ ...form, name: e.target.value })}
              placeholder="e.g., Shutdown Timer"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Command</label>
            <textarea
              value={form.command}
              onChange={(e) => onChange({ ...form, command: e.target.value })}
              placeholder={'e.g., shutdown -h +{delay}'}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
            />
            {form.prompts.length > 0 && (
              <p className="text-xs text-gray-400 mt-1">Use <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">{'{variable}'}</code> in the command to insert prompt values.</p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="modal_requires_sudo"
              checked={form.requires_sudo}
              onChange={(e) => onChange({ ...form, requires_sudo: e.target.checked })}
              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
            <label htmlFor="modal_requires_sudo" className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <Shield size={16} className="text-amber-500" />
              Requires admin privileges (sudo)
            </label>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Prompts</label>
              <button
                onClick={addPrompt}
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400"
              >
                <Plus size={14} />
                Add prompt
              </button>
            </div>

            {form.prompts.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-gray-500">No prompts. Add one to ask for input before running.</p>
            ) : (
              <div className="space-y-2">
                {form.prompts.map((p, i) => (
                  <div key={i} className="flex gap-2 items-start">
                    <div className="flex-1 flex gap-2">
                      <input
                        type="text"
                        value={p.variable}
                        onChange={(e) => updatePrompt(i, 'variable', e.target.value.replace(/\s/g, '_'))}
                        placeholder="variable"
                        className="w-28 px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                      <input
                        type="text"
                        value={p.label}
                        onChange={(e) => updatePrompt(i, 'label', e.target.value)}
                        placeholder="Label shown to user"
                        className="flex-1 px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    <button onClick={() => removePrompt(i)} className="p-1.5 text-gray-400 hover:text-red-500 transition-colors mt-0.5">
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={!valid}
              className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg transition-colors"
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
