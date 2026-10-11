import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Plus, Play, Trash2, Shield, Terminal, X, Check, AlertCircle, Eye, Pencil, ChevronDown, ChevronUp, ChevronRight, FolderOpen, FolderPlus, GripVertical } from 'lucide-react'
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, pointerWithin, useSensor, useSensors } from '@dnd-kit/core'
import type { CollisionDetection, DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import CategoryModal from '../components/scripts/CategoryModal'
import type { CategoryForm } from '../components/scripts/CategoryModal'
import { scriptIcon } from '../constants/scriptIcons'

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
  category?: string | null
}

interface ScriptCategory {
  id: string
  name: string
  icon: string
}

interface ScriptResult {
  success: boolean
  stdout: string
  stderr: string
  exit_code: number | null
  resolved_command?: string
}

interface ExecutionLog {
  id: number
  scriptName: string
  command: string
  // null while the script is still running
  result: ScriptResult | null
  timestamp: Date
  durationMs?: number
}

type ScriptForm = {
  name: string
  command: string
  requires_sudo: boolean
  prompts: ScriptPrompt[]
  category?: string | null
}

const UNCATEGORIZED = 'uncategorized'
const MAX_LOGS = 50

// Sections and script cards share one drag context: section ids carry this
// prefix so the two kinds of draggable can be told apart.
const SECTION_PREFIX = 'cat:'
const sectionDragId = (groupId: string) => `${SECTION_PREFIX}${groupId}`
const isSectionDragId = (id: unknown) => String(id).startsWith(SECTION_PREFIX)
const groupIdOf = (dragId: unknown) => String(dragId).slice(SECTION_PREFIX.length)

interface ScriptGroup {
  id: string
  name: string
  icon: string
  category: ScriptCategory | null
  scripts: CustomScript[]
}

const emptyForm = (category: string | null = null): ScriptForm => ({ name: '', command: '', requires_sudo: false, prompts: [], category })

// A dragged section only lands on other sections. A dragged script lands on
// the card under the pointer, or on the section itself when it is over a
// header, a gap or an empty category.
const collisionDetection: CollisionDetection = (args) => {
  if (isSectionDragId(args.active.id)) {
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter(container => isSectionDragId(container.id)),
    })
  }
  const underPointer = pointerWithin(args)
  const cards = underPointer.filter(collision => !isSectionDragId(collision.id))
  return cards.length > 0 ? cards : underPointer
}

function moveScript(scripts: CustomScript[], id: string, category: string | null, beforeId: string | null): CustomScript[] {
  const script = scripts.find(s => s.id === id)
  if (!script) return scripts
  const moved = { ...script, category }
  const rest = scripts.filter(s => s.id !== id)
  const index = beforeId ? rest.findIndex(s => s.id === beforeId) : -1
  return index === -1 ? [...rest, moved] : [...rest.slice(0, index), moved, ...rest.slice(index)]
}

// Rewrites the slots a group occupies in the flat list with its new order
function reorderGroup(scripts: CustomScript[], orderedIds: string[]): CustomScript[] {
  const byId = new Map(scripts.map(s => [s.id, s]))
  const queue = orderedIds.map(id => byId.get(id)).filter((s): s is CustomScript => s !== undefined)
  return scripts.map(s => (orderedIds.includes(s.id) ? queue.shift() ?? s : s))
}

function resolveCommand(command: string, args: Record<string, string> | null): string {
  return Object.entries(args ?? {}).reduce((cmd, [key, value]) => cmd.split(`{${key}}`).join(value), command)
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

let nextLogId = 1

export default function Scripts() {
  const [scripts, setScripts] = useState<CustomScript[]>([])
  const [categories, setCategories] = useState<ScriptCategory[]>([])
  const [collapsed, setCollapsed] = useState<string[]>([])
  const [activeDrag, setActiveDrag] = useState<string | null>(null)
  const [dragSnapshot, setDragSnapshot] = useState<{ scripts: CustomScript[]; categories: ScriptCategory[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingScript, setEditingScript] = useState<CustomScript | null>(null)
  const [newScript, setNewScript] = useState<ScriptForm>(emptyForm())
  const [categoryModal, setCategoryModal] = useState<{ editing: ScriptCategory | null } | null>(null)
  const [runningScripts, setRunningScripts] = useState<string[]>([])
  const [hoveredScript, setHoveredScript] = useState<string | null>(null)
  const [executionLogs, setExecutionLogs] = useState<ExecutionLog[]>([])
  const [terminalExpanded, setTerminalExpanded] = useState(true)
  const [promptModal, setPromptModal] = useState<{ script: CustomScript; values: Record<string, string> } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<{ kind: 'script' | 'category'; id: string; name: string } | null>(null)

  useEffect(() => {
    fetchScripts()
  }, [])

  const fetchScripts = async () => {
    try {
      const [scriptData, categoryData, collapsedData] = await Promise.all([
        invoke<CustomScript[]>('list_scripts'),
        invoke<ScriptCategory[]>('list_script_categories'),
        invoke<string[]>('get_collapsed_script_groups'),
      ])
      setScripts(scriptData)
      setCategories(categoryData)
      setCollapsed(collapsedData)
      setError(null)
    } catch (err) {
      console.error('Failed to load scripts:', err)
      setError(`Failed to load scripts: ${err}`)
    } finally {
      setLoading(false)
    }
  }

  const draggingScript = activeDrag !== null && !isSectionDragId(activeDrag)

  const groups = useMemo<ScriptGroup[]>(() => {
    const known = new Set(categories.map(c => c.id))
    const sections: ScriptGroup[] = categories.map(category => ({
      id: category.id,
      name: category.name,
      icon: category.icon,
      category,
      scripts: scripts.filter(s => s.category === category.id),
    }))
    const uncategorized = scripts.filter(s => !s.category || !known.has(s.category))
    // Kept visible during a drag so a script can be dropped out of its category
    if (uncategorized.length > 0 || categories.length === 0 || draggingScript) {
      sections.push({ id: UNCATEGORIZED, name: 'Uncategorized', icon: '', category: null, scripts: uncategorized })
    }
    return sections
  }, [scripts, categories, draggingScript])

  const sensors = useSensors(
    // A few pixels of travel before a drag starts, so plain clicks still work
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const groupOfScript = (scriptId: string) => groups.find(g => g.scripts.some(s => s.id === scriptId))?.id

  const dropTarget = (overId: unknown): { group?: string; script?: string } =>
    isSectionDragId(overId)
      ? { group: groupIdOf(overId) }
      : { group: groupOfScript(String(overId)), script: String(overId) }

  const persistLayout = async (nextCategories: ScriptCategory[], nextScripts: CustomScript[]) => {
    try {
      await invoke('set_script_layout', {
        categories: nextCategories.map(c => c.id),
        scripts: nextScripts.map(s => ({ id: s.id, category: s.category ?? null })),
      })
    } catch (err) {
      setError(`Failed to save the new order: ${err}`)
      fetchScripts()
    }
  }

  const handleDragStart = ({ active }: DragStartEvent) => {
    setActiveDrag(String(active.id))
    setDragSnapshot({ scripts, categories })
  }

  // Moving a card into another section happens while dragging, so the target
  // section makes room for it
  const handleDragOver = ({ active, over }: DragOverEvent) => {
    if (!over || isSectionDragId(active.id)) return
    const scriptId = String(active.id)
    const target = dropTarget(over.id)
    if (!target.group || target.group === groupOfScript(scriptId)) return
    const category = target.group === UNCATEGORIZED ? null : target.group
    setScripts(prev => moveScript(prev, scriptId, category, target.script ?? null))
  }

  const cancelDrag = () => {
    if (dragSnapshot) {
      setScripts(dragSnapshot.scripts)
      setCategories(dragSnapshot.categories)
    }
    setActiveDrag(null)
    setDragSnapshot(null)
  }

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) {
      cancelDrag()
      return
    }
    setActiveDrag(null)
    setDragSnapshot(null)

    if (isSectionDragId(active.id)) {
      const from = categories.findIndex(c => c.id === groupIdOf(active.id))
      const to = categories.findIndex(c => c.id === groupIdOf(over.id))
      if (from === -1 || to === -1 || from === to) return
      const nextCategories = arrayMove(categories, from, to)
      setCategories(nextCategories)
      persistLayout(nextCategories, scripts)
      return
    }

    const scriptId = String(active.id)
    const target = dropTarget(over.id)
    const group = groups.find(g => g.id === groupOfScript(scriptId))
    let nextScripts = scripts
    if (group && target.script && target.script !== scriptId && target.group === group.id) {
      const ids = group.scripts.map(s => s.id)
      nextScripts = reorderGroup(scripts, arrayMove(ids, ids.indexOf(scriptId), ids.indexOf(target.script)))
      setScripts(nextScripts)
    }
    persistLayout(categories, nextScripts)
  }

  const toggleCollapsed = (id: string) => {
    const collapse = !collapsed.includes(id)
    setCollapsed(prev => (collapse ? [...prev, id] : prev.filter(c => c !== id)))
    invoke('set_script_group_collapsed', { id, collapsed: collapse }).catch(err => {
      setError(`Failed to remember the collapsed state: ${err}`)
    })
  }

  const openAddModal = (category: string | null = null) => {
    setNewScript(emptyForm(category))
    setShowAddModal(true)
  }

  const handleAddScript = async () => {
    if (!newScript.name.trim() || !newScript.command.trim()) return
    try {
      await invoke('add_script', {
        name: newScript.name,
        command: newScript.command,
        requiresSudo: newScript.requires_sudo,
        prompts: newScript.prompts,
        category: newScript.category ?? null,
      })
      setNewScript(emptyForm())
      setShowAddModal(false)
      fetchScripts()
    } catch (err) {
      console.error('Failed to add script:', err)
      setError(`Failed to add script: ${err}`)
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
        category: editingScript.category ?? null,
      })
      setEditingScript(null)
      fetchScripts()
    } catch (err) {
      console.error('Failed to update script:', err)
      setError(`Failed to update script: ${err}`)
    }
  }

  const handleSaveCategory = async (form: CategoryForm) => {
    const editing = categoryModal?.editing
    if (editing) {
      await invoke('update_script_category', { id: editing.id, name: form.name, icon: form.icon })
    } else {
      await invoke('add_script_category', { name: form.name, icon: form.icon })
    }
    setCategoryModal(null)
    fetchScripts()
  }

  const handleRemoveScript = (id: string, name: string) => {
    setConfirmDelete({ kind: 'script', id, name })
  }

  const confirmRemove = async () => {
    if (!confirmDelete) return
    try {
      const command = confirmDelete.kind === 'script' ? 'remove_script' : 'remove_script_category'
      await invoke(command, { id: confirmDelete.id })
      setConfirmDelete(null)
      fetchScripts()
    } catch (err) {
      console.error('Failed to delete:', err)
      setError(`Failed to delete ${confirmDelete.name}: ${err}`)
      setConfirmDelete(null)
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
    setRunningScripts(prev => [...prev, script.id])
    setTerminalExpanded(true)

    // The entry is shown right away so a slow script is visibly running
    const logId = nextLogId++
    const started = Date.now()
    setExecutionLogs(prev => [{
      id: logId,
      scriptName: script.name,
      command: resolveCommand(script.command, args),
      result: null,
      timestamp: new Date(),
    }, ...prev].slice(0, MAX_LOGS))

    let result: ScriptResult
    try {
      result = await invoke<ScriptResult>('run_script', { id: script.id, args })
    } catch (err) {
      result = {
        success: false,
        stdout: '',
        stderr: err instanceof Error ? err.message : String(err),
        exit_code: -1,
      }
    }

    setExecutionLogs(prev => prev.map(log => log.id === logId
      ? { ...log, command: result.resolved_command ?? log.command, result, durationMs: Date.now() - started }
      : log))
    setRunningScripts(prev => prev.filter(id => id !== script.id))
  }

  const clearLogs = () => setExecutionLogs(prev => prev.filter(log => log.result === null))

  if (loading) return <div className="p-4 text-gray-900 dark:text-gray-100">Loading scripts...</div>

  const cardProps = (script: CustomScript) => ({
    script,
    running: runningScripts.includes(script.id),
    showCommand: hoveredScript === script.id && activeDrag === null,
    onHover: (hovered: boolean) => setHoveredScript(hovered ? script.id : null),
    onEdit: () => setEditingScript({ ...script }),
    onDelete: () => handleRemoveScript(script.id, script.name),
    onRun: () => initiateRun(script),
  })

  const draggedScript = draggingScript ? scripts.find(s => s.id === activeDrag) : undefined
  const draggedGroup = activeDrag !== null && isSectionDragId(activeDrag) ? groups.find(g => g.id === groupIdOf(activeDrag)) : undefined

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Custom Scripts</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCategoryModal({ editing: null })}
            className="flex items-center gap-2 px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 rounded-lg transition-colors"
          >
            <FolderPlus size={18} />
            New Category
          </button>
          <button
            onClick={() => openAddModal()}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            <Plus size={20} />
            Add Script
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start justify-between gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600" aria-label="Dismiss">
            <X size={16} />
          </button>
        </div>
      )}

      {scripts.length === 0 && categories.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-8 text-center">
          <Terminal size={48} className="mx-auto text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">No scripts yet</h3>
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            Add custom scripts to quickly run common commands
          </p>
          <button
            onClick={() => openAddModal()}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            <Plus size={20} />
            Add your first script
          </button>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={cancelDrag}
        >
          <SortableContext items={groups.map(g => sectionDragId(g.id))} strategy={verticalListSortingStrategy}>
            <div className="space-y-5">
              {groups.map(group => (
                <ScriptSection
                  key={group.id}
                  group={group}
                  showHeader={categories.length > 0}
                  collapsed={collapsed.includes(group.id)}
                  onToggle={() => toggleCollapsed(group.id)}
                  onAddScript={() => openAddModal(group.category ? group.id : null)}
                  onEdit={() => setCategoryModal({ editing: group.category })}
                  onDelete={() => setConfirmDelete({ kind: 'category', id: group.id, name: group.name })}
                >
                  {group.scripts.map(script => (
                    <SortableScriptCard key={script.id} {...cardProps(script)} />
                  ))}
                </ScriptSection>
              ))}
            </div>
          </SortableContext>

          <DragOverlay>
            {draggedScript && <ScriptCard {...cardProps(draggedScript)} showCommand={false} dragging />}
            {draggedGroup && (
              <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-blue-500 shadow-xl">
                <GroupBadge group={draggedGroup} />
                <span className="font-semibold text-gray-900 dark:text-gray-100">{draggedGroup.name}</span>
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                  {draggedGroup.scripts.length}
                </span>
              </div>
            )}
          </DragOverlay>
        </DndContext>
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
                <div key={log.id} className="mb-4 last:mb-0">
                  <div className="flex items-start gap-2 mb-1">
                    <span className="text-green-400 select-none">$</span>
                    <span className="text-gray-300">{log.command}</span>
                  </div>
                  <div className="flex items-center gap-2 mb-2 ml-4">
                    <span className="text-gray-500 text-xs">[{log.timestamp.toLocaleTimeString()}]</span>
                    <span className="text-gray-500 text-xs">{log.scriptName}</span>
                    {log.result === null ? (
                      <span className="flex items-center gap-1.5 text-blue-400 text-xs">
                        <span className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                        running…
                      </span>
                    ) : log.result.success ? (
                      <span className="flex items-center gap-1 text-green-400 text-xs"><Check size={12} />exit 0</span>
                    ) : (
                      <span className="flex items-center gap-1 text-red-400 text-xs"><AlertCircle size={12} />exit {log.result.exit_code ?? 'signal'}</span>
                    )}
                    {log.durationMs !== undefined && (
                      <span className="text-gray-500 text-xs">{formatDuration(log.durationMs)}</span>
                    )}
                  </div>
                  {log.result?.stdout && <pre className="text-gray-300 whitespace-pre-wrap ml-4 mb-1">{log.result.stdout}</pre>}
                  {log.result?.stderr && <pre className="text-red-400 whitespace-pre-wrap ml-4">{log.result.stderr}</pre>}
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
          categories={categories}
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
          categories={categories}
          onChange={(f) => setEditingScript({ ...editingScript, ...f })}
          onConfirm={handleUpdateScript}
          onClose={() => setEditingScript(null)}
          confirmLabel="Save Changes"
        />
      )}

      {categoryModal && (
        <CategoryModal
          title={categoryModal.editing ? 'Edit Category' : 'New Category'}
          initial={categoryModal.editing ? { name: categoryModal.editing.name, icon: categoryModal.editing.icon } : undefined}
          takenNames={categories.filter(c => c.id !== categoryModal.editing?.id).map(c => c.name)}
          confirmLabel={categoryModal.editing ? 'Save Changes' : 'Create Category'}
          onConfirm={handleSaveCategory}
          onClose={() => setCategoryModal(null)}
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
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">{confirmDelete.kind === 'script' ? 'Delete Script' : 'Delete Category'}</h2>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              Are you sure you want to delete <span className="font-semibold text-gray-900 dark:text-gray-100">{confirmDelete.name}</span>?{' '}
              {confirmDelete.kind === 'script' ? 'This cannot be undone.' : 'Its scripts are kept and become uncategorized.'}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmRemove}
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

function GroupBadge({ group }: { group: ScriptGroup }) {
  const Icon = group.category ? scriptIcon(group.icon) : FolderOpen
  return (
    <span className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${
      group.category
        ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400'
        : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
    }`}>
      <Icon size={16} />
    </span>
  )
}

function ScriptSection({ group, showHeader, collapsed, onToggle, onAddScript, onEdit, onDelete, children }: {
  group: ScriptGroup
  showHeader: boolean
  collapsed: boolean
  onToggle: () => void
  onAddScript: () => void
  onEdit: () => void
  onDelete: () => void
  children: React.ReactNode
}) {
  // "Uncategorized" always stays last: it accepts drops but cannot be moved
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging, isOver, active } = useSortable({
    id: sectionDragId(group.id),
    disabled: { draggable: !group.category },
  })
  const scriptOver = isOver && active !== null && !isSectionDragId(active.id)

  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={isDragging ? 'opacity-40' : ''}
    >
      {showHeader && (
        <div className={`group flex items-center gap-1 mb-3 rounded-lg transition-colors ${scriptOver ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}>
          {group.category ? (
            <button
              ref={setActivatorNodeRef}
              {...attributes}
              {...listeners}
              className="p-1 text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 cursor-grab active:cursor-grabbing touch-none"
              title="Drag to reorder"
              aria-label={`Reorder ${group.name}`}
            >
              <GripVertical size={16} />
            </button>
          ) : (
            <span className="w-6" />
          )}
          <button
            onClick={onToggle}
            aria-expanded={!collapsed}
            className="flex items-center gap-3 flex-1 min-w-0 text-left py-1"
          >
            {collapsed ? <ChevronRight size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
            <GroupBadge group={group} />
            <h2 className="font-semibold text-gray-900 dark:text-gray-100 truncate">{group.name}</h2>
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
              {group.scripts.length}
            </span>
            <span className="flex-1 border-t border-gray-200 dark:border-gray-700" />
          </button>
          {group.category && (
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
              <button onClick={onAddScript} className="p-1.5 text-gray-400 hover:text-blue-500 transition-colors" title={`Add script to ${group.name}`}>
                <Plus size={16} />
              </button>
              <button onClick={onEdit} className="p-1.5 text-gray-400 hover:text-blue-500 transition-colors" title="Edit category">
                <Pencil size={16} />
              </button>
              <button onClick={onDelete} className="p-1.5 text-gray-400 hover:text-red-500 transition-colors" title="Delete category">
                <Trash2 size={16} />
              </button>
            </div>
          )}
        </div>
      )}

      {!collapsed && (
        <SortableContext items={group.scripts.map(s => s.id)} strategy={rectSortingStrategy}>
          {group.scripts.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{children}</div>
          ) : (
            <button
              onClick={onAddScript}
              className={`w-full py-6 border-2 border-dashed rounded-lg text-sm transition-colors ${
                scriptOver
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-300 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400'
              }`}
            >
              {active !== null && !isSectionDragId(active.id)
                ? `Drop here to move to ${group.name}`
                : group.category ? `No scripts in ${group.name} yet. Add one` : 'Drop a script here to remove it from its category'}
            </button>
          )}
        </SortableContext>
      )}
    </section>
  )
}

interface ScriptCardProps {
  script: CustomScript
  running: boolean
  showCommand: boolean
  onHover: (hovered: boolean) => void
  onEdit: () => void
  onDelete: () => void
  onRun: () => void
  // Rendered inside the drag overlay, following the pointer
  dragging?: boolean
  handle?: React.ReactNode
}

function SortableScriptCard(props: ScriptCardProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: props.script.id })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'opacity-40' : ''}
    >
      <ScriptCard
        {...props}
        handle={
          <button
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            className="-ml-2 p-1 text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 cursor-grab active:cursor-grabbing touch-none"
            title="Drag to reorder or move to another category"
            aria-label={`Move ${props.script.name}`}
          >
            <GripVertical size={16} />
          </button>
        }
      />
    </div>
  )
}

function ScriptCard({ script, running, showCommand, onHover, onEdit, onDelete, onRun, dragging, handle }: ScriptCardProps) {
  return (
    <div
      className={`bg-white dark:bg-gray-800 rounded-xl border p-4 flex flex-col h-full ${
        dragging ? 'border-blue-500 shadow-xl cursor-grabbing' : 'border-gray-200 dark:border-gray-700'
      }`}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2 min-w-0">
          {handle ?? (dragging && <GripVertical size={16} className="-ml-1 text-gray-400" />)}
          <h3 className="font-semibold text-gray-900 dark:text-gray-100 truncate">{script.name}</h3>
          {script.requires_sudo && (
            <span title="Requires admin privileges">
              <Shield size={16} className="text-amber-500" />
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <div
            className="relative"
            onMouseEnter={() => onHover(true)}
            onMouseLeave={() => onHover(false)}
          >
            <button className="p-1.5 text-gray-400 hover:text-blue-500 transition-colors" title="View command">
              <Eye size={16} />
            </button>
            {showCommand && (
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
          <button onClick={onEdit} className="p-1.5 text-gray-400 hover:text-blue-500 transition-colors" title="Edit script">
            <Pencil size={16} />
          </button>
          <button onClick={onDelete} className="p-1.5 text-gray-400 hover:text-red-500 transition-colors" title="Delete script">
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      <button
        onClick={onRun}
        disabled={running}
        className={`flex items-center justify-center gap-2 w-full py-2 mt-auto rounded-lg transition-colors ${
          running
            ? 'bg-gray-300 dark:bg-gray-600 cursor-not-allowed text-gray-600 dark:text-gray-300'
            : 'bg-green-600 hover:bg-green-700 text-white'
        }`}
      >
        {running ? (
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
  )
}

function ScriptFormModal({
  title,
  form,
  categories,
  onChange,
  onConfirm,
  onClose,
  confirmLabel,
}: {
  title: string
  form: ScriptForm
  categories: ScriptCategory[]
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

          {categories.length > 0 && (
            <div>
              <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Category</div>
              <div className="flex flex-wrap gap-2">
                {[{ id: null, name: 'None', icon: undefined }, ...categories].map(category => {
                  const Icon = category.id === null ? FolderOpen : scriptIcon(category.icon)
                  const selected = (form.category ?? null) === category.id
                  return (
                    <button
                      key={category.id ?? 'none'}
                      onClick={() => onChange({ ...form, category: category.id })}
                      aria-pressed={selected}
                      className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border transition-colors ${
                        selected
                          ? 'bg-blue-600 border-blue-600 text-white'
                          : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-blue-500'
                      }`}
                    >
                      <Icon size={12} />
                      {category.name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

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
