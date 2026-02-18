import { ChevronLeft, ChevronRight } from 'lucide-react'

interface PaginationProps {
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
}

export default function Pagination({ currentPage, totalPages, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null

  const pages: (number | '...')[] = []

  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i)
  } else {
    pages.push(1)
    if (currentPage > 3) pages.push('...')
    for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
      pages.push(i)
    }
    if (currentPage < totalPages - 2) pages.push('...')
    pages.push(totalPages)
  }

  const btn = 'px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors min-w-[32px] text-center'
  const active = 'bg-blue-600 text-white'
  const inactive = 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
  const nav = 'p-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors'

  return (
    <div className="flex items-center gap-1">
      <button className={nav} onClick={() => onPageChange(currentPage - 1)} disabled={currentPage === 1}>
        <ChevronLeft size={14} />
      </button>
      {pages.map((p, i) =>
        p === '...' ? (
          <span key={`dots-${i}`} className="px-1 text-gray-400 text-sm">…</span>
        ) : (
          <button key={p} onClick={() => onPageChange(p)} className={`${btn} ${p === currentPage ? active : inactive}`}>
            {p}
          </button>
        )
      )}
      <button className={nav} onClick={() => onPageChange(currentPage + 1)} disabled={currentPage === totalPages}>
        <ChevronRight size={14} />
      </button>
    </div>
  )
}
