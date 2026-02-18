import { useEffect, useState } from 'react'
import { listStartupApps, addStartupApp, editStartupApp, deleteStartupApp, toggleStartupApp } from '../api/config'
import { Plus, Pencil, Trash2, RotateCw } from 'lucide-react'
import Pagination from '../components/Pagination'

interface StartupApp {
  name?: string
  file?: string
  exec?: string
  enabled?: boolean
  file_path?: string
}

export default function StartupApps() {
  const [apps, setApps] = useState<StartupApp[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingApp, setEditingApp] = useState<StartupApp | null>(null)
  const [formName, setFormName] = useState('')
  const [formExec, setFormExec] = useState('')
  const [togglingFile, setTogglingFile] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const ITEMS_PER_PAGE = 20

  useEffect(() => {
    fetchApps()
  }, [])

  const fetchApps = async () => {
    try {
      setError(null)
      const data = await listStartupApps()
      setApps(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(String(err))
      setApps([])
    } finally {
      setIsLoading(false)
    }
  }

  const handleAdd = async () => {
    if (!formName.trim() || !formExec.trim()) return
    try {
      setError(null)
      await addStartupApp(formName.trim(), formExec.trim())
      setShowAddModal(false)
      setFormName('')
      setFormExec('')
      await fetchApps()
    } catch (err) {
      setError(String(err))
    }
  }

  const handleEdit = async () => {
    if (!editingApp?.file || !formName.trim() || !formExec.trim()) return
    try {
      setError(null)
      await editStartupApp(editingApp.file, formName.trim(), formExec.trim())
      setEditingApp(null)
      setFormName('')
      setFormExec('')
      await fetchApps()
    } catch (err) {
      setError(String(err))
    }
  }

  const handleDelete = async (file: string) => {
    try {
      setError(null)
      await deleteStartupApp(file)
      setDeleteConfirm(null)
      await fetchApps()
    } catch (err) {
      setError(String(err))
    }
  }

  const handleToggle = async (app: StartupApp) => {
    if (!app.file) return
    setTogglingFile(app.file)
    setError(null)
    try {
      await toggleStartupApp(app.file, !app.enabled)
      await fetchApps()
    } catch (err) {
      setError(String(err))
    } finally {
      setTogglingFile(null)
    }
  }

  const openEditModal = (app: StartupApp) => {
    setEditingApp(app)
    setFormName(app.name || '')
    setFormExec(app.exec || '')
  }

  if (isLoading) return <div className="p-4 text-gray-900 dark:text-gray-100">Loading startup apps…</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Startup Applications</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setFormName(''); setFormExec(''); setShowAddModal(true) }}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            <Plus size={16} />
            Add
          </button>
          <button
            onClick={() => fetchApps()}
            className="flex items-center gap-2 px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 rounded-lg transition-colors"
          >
            <RotateCw size={16} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
        {apps.length === 0 ? (
          <div className="p-4 text-gray-600 dark:text-gray-400">No autostart entries found.</div>
        ) : (
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {apps.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE).map((app) => (
              <div key={app.file || app.name} className="flex items-center gap-4 p-4 hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                <button
                  onClick={() => handleToggle(app)}
                  disabled={togglingFile !== null}
                  className={`flex-shrink-0 w-12 h-6 rounded-full transition ${
                    app.enabled ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
                  } flex items-center px-1 ${togglingFile === app.file ? 'opacity-50' : ''}`}
                >
                  {togglingFile === app.file ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto" />
                  ) : (
                    <div className={`w-5 h-5 bg-white rounded-full transition-all duration-200 ${app.enabled ? 'ml-auto' : 'ml-0'}`} />
                  )}
                </button>

                <div className="flex-1 min-w-0">
                  <div className={`font-semibold truncate ${app.enabled ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500'}`}>
                    {app.name || app.file}
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-400 truncate">{app.exec}</div>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => openEditModal(app)}
                    className="p-2 text-gray-400 hover:text-blue-500 hover:bg-gray-100 dark:hover:bg-gray-600 rounded transition-colors"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(app.file || null)}
                    className="p-2 text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-gray-600 rounded transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {apps.length > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {apps.filter(a => a.enabled).length} of {apps.length} enabled
          </span>
          <Pagination
            currentPage={currentPage}
            totalPages={Math.ceil(apps.length / ITEMS_PER_PAGE)}
            onPageChange={setCurrentPage}
          />
        </div>
      )}

      {(showAddModal || editingApp) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => { setShowAddModal(false); setEditingApp(null) }}>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-md mx-4 border border-gray-200 dark:border-gray-700" onClick={e => e.stopPropagation()}>
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">
              {editingApp ? 'Edit Startup Application' : 'Add Startup Application'}
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Application Name</label>
                <input
                  type="text"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder="My Application"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Command</label>
                <input
                  type="text"
                  value={formExec}
                  onChange={e => setFormExec(e.target.value)}
                  placeholder="/usr/bin/myapp --flag"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => { setShowAddModal(false); setEditingApp(null) }}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={editingApp ? handleEdit : handleAdd}
                disabled={!formName.trim() || !formExec.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
              >
                {editingApp ? 'Save Changes' : 'Add Application'}
              </button>
            </div>
          </div>
        </div>
      )}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-sm mx-4 border border-gray-200 dark:border-gray-700" onClick={e => e.stopPropagation()}>
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">Delete Startup App</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
              Are you sure you want to remove <span className="font-semibold text-gray-900 dark:text-gray-100">{apps.find(a => a.file === deleteConfirm)?.name || deleteConfirm}</span> from startup applications?
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
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
