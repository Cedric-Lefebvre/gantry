import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { RotateCw, Plus, Trash2, Search } from 'lucide-react'
import { addAptRepo, deleteAptRepo } from '../api/config'

interface Repository {
  id: string
  file_path: string
  line_number: number
  types: string
  uris: string
  suites: string
  components: string
  enabled: boolean
  original_line: string
}

export default function Repositories() {
  const [repositories, setRepositories] = useState<Repository[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [newRepoLine, setNewRepoLine] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  useEffect(() => {
    fetchAptRepositories()
  }, [])

  const fetchAptRepositories = async () => {
    try {
      setError(null)
      const data = await invoke<Repository[]>('list_apt_repos')
      setRepositories(data)
    } catch (err) {
      console.error('Failed to load repositories:', err)
      setError(String(err))
    } finally {
      setIsLoading(false)
    }
  }

  const toggleRepositoryEnabled = async (repo: Repository) => {
    setTogglingId(repo.id)
    setError(null)
    try {
      await invoke('toggle_apt_repo', {
        id: repo.id,
        enabled: !repo.enabled,
      })
      await fetchAptRepositories()
    } catch (err) {
      console.error('Failed to toggle repository:', err)
      setError(String(err))
    } finally {
      setTogglingId(null)
    }
  }

  const handleAdd = async () => {
    if (!newRepoLine.trim()) return
    try {
      setError(null)
      await addAptRepo(newRepoLine.trim())
      setShowAddModal(false)
      setNewRepoLine('')
      await fetchAptRepositories()
    } catch (err) {
      setError(String(err))
    }
  }

  const handleDelete = async (id: string) => {
    try {
      setError(null)
      await deleteAptRepo(id)
      setDeleteConfirm(null)
      await fetchAptRepositories()
    } catch (err) {
      setError(String(err))
    }
  }

  const filteredRepositories = useMemo(() => {
    const q = search.toLowerCase()
    return repositories.filter((repo) =>
      repo.uris.toLowerCase().includes(q) ||
      repo.suites.toLowerCase().includes(q) ||
      repo.components.toLowerCase().includes(q) ||
      repo.file_path.toLowerCase().includes(q)
    )
  }, [repositories, search])

  const enabledCount = useMemo(() => repositories.filter((repo) => repo.enabled).length, [repositories])

  if (isLoading) return <div className="p-4 text-gray-900 dark:text-gray-100">Loading repositories...</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">APT Repositories</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setNewRepoLine(''); setShowAddModal(true) }}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            <Plus size={16} />
            Add
          </button>
          <button
            onClick={() => fetchAptRepositories()}
            className="flex items-center gap-2 px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 rounded-lg transition-colors"
          >
            <RotateCw size={16} />
            Refresh
          </button>
        </div>
      </div>

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search repositories…"
          className="w-full pl-9 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
        {filteredRepositories.length === 0 ? (
          <div className="p-4 text-gray-600 dark:text-gray-400">
            {search ? 'No repositories match your search' : 'No repositories configured'}
          </div>
        ) : (
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {filteredRepositories.map((repo) => (
              <div key={repo.id} className="flex items-center gap-4 p-4 hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                <button
                  onClick={() => toggleRepositoryEnabled(repo)}
                  disabled={togglingId !== null}
                  className={`flex-shrink-0 w-12 h-6 rounded-full transition ${
                    repo.enabled ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
                  } flex items-center px-1 ${togglingId === repo.id ? 'opacity-50' : ''}`}
                >
                  {togglingId === repo.id ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto" />
                  ) : (
                    <div
                      className={`w-5 h-5 bg-white rounded-full transition-all duration-200 ${
                        repo.enabled ? 'ml-auto' : 'ml-0'
                      }`}
                    />
                  )}
                </button>

                <div className="flex-1 min-w-0">
                  <div className="text-sm font-mono text-gray-900 dark:text-gray-100 truncate">
                    {repo.types} {repo.uris} {repo.suites}
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                    {repo.components}
                    <span className="ml-2 text-gray-400 dark:text-gray-500">({repo.file_path})</span>
                  </div>
                </div>

                <span
                  className={`text-xs font-semibold px-2 py-1 rounded whitespace-nowrap ${
                    repo.enabled
                      ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                  }`}
                >
                  {repo.enabled ? 'Enabled' : 'Disabled'}
                </span>

                <button
                  onClick={() => setDeleteConfirm(repo.id)}
                  className="p-2 text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-gray-600 rounded transition-colors"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {repositories.length > 0 && (
        <div className="text-sm text-gray-600 dark:text-gray-400">
          {enabledCount} of {repositories.length} repositories enabled
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowAddModal(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-lg mx-4 border border-gray-200 dark:border-gray-700" onClick={e => e.stopPropagation()}>
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">Add APT Repository</h2>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Repository Line</label>
              <input
                type="text"
                value={newRepoLine}
                onChange={e => setNewRepoLine(e.target.value)}
                placeholder="deb http://example.com/repo focal main"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Enter a complete APT repository line starting with <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">deb</code> or <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">deb-src</code>
              </p>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                disabled={!newRepoLine.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
              >
                Add Repository
              </button>
            </div>
          </div>
        </div>
      )}
      {deleteConfirm && (() => {
        const repo = repositories.find(r => r.id === deleteConfirm)
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setDeleteConfirm(null)}>
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-sm mx-4 border border-gray-200 dark:border-gray-700" onClick={e => e.stopPropagation()}>
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">Delete Repository</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">Are you sure you want to remove this repository?</p>
              {repo && (
                <p className="text-xs font-mono text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700 rounded p-2 mb-6 truncate">
                  {repo.types} {repo.uris} {repo.suites}
                </p>
              )}
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
        )
      })()}
    </div>
  )
}
