import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { RotateCw } from 'lucide-react'

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

  const getEnabledRepositoryCount = (): number => {
    return repositories.filter((repo) => repo.enabled).length
  }

  if (isLoading) return <div className="p-4 text-gray-900 dark:text-gray-100">Loading repositories...</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">APT Repositories</h1>
        <button
          onClick={() => fetchAptRepositories()}
          className="flex items-center gap-2 px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 rounded-lg transition-colors"
        >
          <RotateCw size={16} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
        {repositories.length === 0 ? (
          <div className="p-4 text-gray-600 dark:text-gray-400">No repositories configured</div>
        ) : (
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {repositories.map((repo) => (
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
              </div>
            ))}
          </div>
        )}
      </div>

      {repositories.length > 0 && (
        <div className="text-sm text-gray-600 dark:text-gray-400">
          {getEnabledRepositoryCount()} of {repositories.length} repositories enabled
        </div>
      )}
    </div>
  )
}
