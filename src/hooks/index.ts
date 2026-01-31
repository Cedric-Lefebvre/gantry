import { useState, useEffect } from 'react'
import { logger } from '../utils/logger'

export function useFetch<T>(
  fetchFn: () => Promise<T>,
  dependencies: React.DependencyList = []
) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const result = await fetchFn()
        setData(result)
      } catch (err) {
        logger.error('useFetch error', err)
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    }

    load()
  }, dependencies)

  return { data, loading, error }
}

export function usePagination<T>(items: T[], itemsPerPage: number = 100) {
  const [currentPage, setCurrentPage] = useState(1)

  const totalPages = Math.ceil(items.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const paginatedItems = items.slice(startIndex, startIndex + itemsPerPage)

  const goToPage = (page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)))
  }

  return {
    currentPage,
    totalPages,
    paginatedItems,
    goToPage,
  }
}
