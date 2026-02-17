import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Play, Square, RotateCw, Search, Power, PowerOff, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, User, Monitor, X } from 'lucide-react'

interface ServiceInfo {
  name: string
  description: string
  load_state: string
  active_state: string
  sub_state: string
  is_running: boolean
  is_enabled: boolean
  is_user_service: boolean
}

const ITEMS_PER_PAGE = 50

export default function Services() {
  const [services, setServices] = useState<ServiceInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [filterType, setFilterType] = useState<'all' | 'system' | 'user'>('all')
  const [sortKey, setSortKey] = useState<'status' | 'type' | 'boot' | 'name' | 'description'>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      fetchServices()
    }, 50)
    return () => clearTimeout(timeoutId)
  }, [])

  const fetchServices = async () => {
    setLoading(true)
    try {
      const data = await invoke<ServiceInfo[]>('list_services')
      setServices(data)
      setError(null)
    } catch (err) {
      console.error('Failed to load services:', err)
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  const handleAction = async (action: string, service: ServiceInfo) => {
    setActionInProgress(`${action}-${service.name}`)
    setError(null)
    try {
      const command = `${action}_service`
      const result = await invoke<{ success: boolean; error: string }>(command, {
        name: service.name,
        isUser: service.is_user_service,
      })
      if (!result.success) {
        setError(result.error || `Failed to ${action} ${service.name}`)
      }
      await fetchServices()
    } catch (err) {
      setError(String(err))
    } finally {
      setActionInProgress(null)
    }
  }

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir(key === 'name' || key === 'description' ? 'asc' : 'desc') }
  }

  const filteredServices = services
    .filter((service) => {
      if (filterType === 'system') return !service.is_user_service
      if (filterType === 'user') return service.is_user_service
      return true
    })
    .filter(
      (service) =>
        service.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        service.description.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => {
      const mul = sortDir === 'asc' ? 1 : -1
      if (sortKey === 'status') return mul * (Number(a.is_running) - Number(b.is_running))
      if (sortKey === 'type') return mul * (Number(a.is_user_service) - Number(b.is_user_service))
      if (sortKey === 'boot') return mul * (Number(a.is_enabled) - Number(b.is_enabled))
      if (sortKey === 'description') return mul * (a.description || '').localeCompare(b.description || '')
      return mul * a.name.localeCompare(b.name)
    })

  const totalPages = Math.ceil(filteredServices.length / ITEMS_PER_PAGE)
  const paginatedServices = filteredServices.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  )

  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery, filterType])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Services</h1>
        <button
          onClick={() => fetchServices()}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 rounded-lg transition-colors disabled:opacity-50"
        >
          <RotateCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search services..."
            className="w-full pl-10 pr-10 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <X size={18} />
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setFilterType('all')}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              filterType === 'all'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilterType('system')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              filterType === 'system'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
            }`}
          >
            <Monitor size={14} />
            System
          </button>
          <button
            onClick={() => setFilterType('user')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              filterType === 'user'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
            }`}
          >
            <User size={14} />
            User
          </button>
        </div>
      </div>

      {loading ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="px-4 py-16">
            <div className="flex flex-col items-center justify-center gap-4">
              <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-gray-500 dark:text-gray-400">Loading services...</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="text-center px-3 py-3 text-sm font-semibold text-gray-900 dark:text-gray-100 w-12 cursor-pointer select-none hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors" onClick={() => toggleSort('status')}>
                    <div className="flex items-center justify-center gap-0.5">
                      {sortKey === 'status' && (sortDir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                    </div>
                  </th>
                  <th className="text-left px-3 py-3 text-sm font-semibold text-gray-900 dark:text-gray-100 w-16 cursor-pointer select-none hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors" onClick={() => toggleSort('type')}>
                    <div className="flex items-center gap-1">
                      Type
                      {sortKey === 'type' && (sortDir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                    </div>
                  </th>
                  <th className="text-left px-3 py-3 text-sm font-semibold text-gray-900 dark:text-gray-100 w-20 cursor-pointer select-none hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors" onClick={() => toggleSort('boot')}>
                    <div className="flex items-center gap-1">
                      Boot
                      {sortKey === 'boot' && (sortDir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                    </div>
                  </th>
                  <th className="text-center px-3 py-3 text-sm font-semibold text-gray-900 dark:text-gray-100 w-24">Actions</th>
                  <th className="text-left px-3 py-3 text-sm font-semibold text-gray-900 dark:text-gray-100 cursor-pointer select-none hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors" onClick={() => toggleSort('name')}>
                    <div className="flex items-center gap-1">
                      Name
                      {sortKey === 'name' && (sortDir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                    </div>
                  </th>
                  <th className="text-left px-3 py-3 text-sm font-semibold text-gray-900 dark:text-gray-100 hidden xl:table-cell cursor-pointer select-none hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors" onClick={() => toggleSort('description')}>
                    <div className="flex items-center gap-1">
                      Description
                      {sortKey === 'description' && (sortDir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {paginatedServices.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                    {searchQuery ? 'No services match your search' : 'No services found'}
                  </td>
                </tr>
              ) : (
                paginatedServices.map((service) => (
                  <tr
                    key={`${service.is_user_service ? 'user' : 'system'}-${service.name}`}
                    className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                  >
                    <td className="px-3 py-2 text-center">
                      <div
                        className={`w-3 h-3 rounded-full mx-auto ${
                          service.is_running
                            ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]'
                            : 'bg-gray-400'
                        }`}
                        title={service.is_running ? `Running (${service.sub_state})` : `Stopped (${service.sub_state})`}
                      />
                    </td>

                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${
                          service.is_user_service
                            ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400'
                            : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                        }`}
                      >
                        {service.is_user_service ? <User size={10} /> : <Monitor size={10} />}
                      </span>
                    </td>

                    <td className="px-3 py-2">
                      <button
                        onClick={() => handleAction(service.is_enabled ? 'disable' : 'enable', service)}
                        disabled={actionInProgress !== null}
                        className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium transition-colors ${
                          service.is_enabled
                            ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                        }`}
                        title={service.is_enabled ? 'Starts at boot - click to disable' : 'Does not start at boot - click to enable'}
                      >
                        {actionInProgress === `enable-${service.name}` || actionInProgress === `disable-${service.name}` ? (
                          <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        ) : service.is_enabled ? (
                          <Power size={12} />
                        ) : (
                          <PowerOff size={12} />
                        )}
                      </button>
                    </td>

                    <td className="px-3 py-2">
                      <div className="flex items-center justify-center gap-1">
                        {!service.is_running ? (
                          <button
                            onClick={() => handleAction('start', service)}
                            disabled={actionInProgress !== null}
                            className="p-1.5 text-green-600 hover:bg-green-100 dark:hover:bg-green-900/30 rounded transition-colors disabled:opacity-50"
                            title="Start"
                          >
                            {actionInProgress === `start-${service.name}` ? (
                              <div className="w-4 h-4 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <Play size={16} />
                            )}
                          </button>
                        ) : (
                          <button
                            onClick={() => handleAction('stop', service)}
                            disabled={actionInProgress !== null}
                            className="p-1.5 text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-colors disabled:opacity-50"
                            title="Stop"
                          >
                            {actionInProgress === `stop-${service.name}` ? (
                              <div className="w-4 h-4 border-2 border-red-600 border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <Square size={16} />
                            )}
                          </button>
                        )}
                        <button
                          onClick={() => handleAction('restart', service)}
                          disabled={actionInProgress !== null}
                          className="p-1.5 text-blue-600 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded transition-colors disabled:opacity-50"
                          title="Restart"
                        >
                          {actionInProgress === `restart-${service.name}` ? (
                            <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <RotateCw size={16} />
                          )}
                        </button>
                      </div>
                    </td>

                    <td className="px-3 py-2">
                      <span className="font-medium text-gray-900 dark:text-gray-100 text-sm" title={service.name}>
                        {service.name}
                      </span>
                    </td>

                    <td className="px-3 py-2 hidden xl:table-cell">
                      <span className="text-sm text-gray-500 dark:text-gray-400 truncate block max-w-md">
                        {service.description || '-'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {!loading && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {filteredServices.length > 0 ? (
              <>Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1}-{Math.min(currentPage * ITEMS_PER_PAGE, filteredServices.length)} of {filteredServices.length} services</>
            ) : (
              <>0 services</>
            )}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-2 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm text-gray-600 dark:text-gray-400">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-2 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
