import React from 'react'
import { PageType } from '../types'
import { NAVIGATION_ITEMS, APP_NAME, APP_SUBTITLE, APP_VERSION } from '../constants'

interface SidebarProps {
  currentPage: PageType
  onPageChange: (page: PageType) => void
}

export default function Sidebar({ currentPage, onPageChange }: SidebarProps) {
  return (
    <aside className="w-64 h-full bg-gray-900 text-white flex flex-col border-r border-gray-800 shadow-lg">
      <div className="p-6 border-b border-gray-800">
        <h1 className="text-2xl font-bold tracking-tight">{APP_NAME}</h1>
        <p className="text-gray-400 text-sm mt-1">{APP_SUBTITLE}</p>
      </div>

      <nav className="flex-1 px-4 py-6 space-y-2">
        {NAVIGATION_ITEMS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onPageChange(id)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
              currentPage === id
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-gray-300 hover:bg-gray-800 hover:text-white'
            }`}
          >
            <Icon size={20} />
            <span className="font-medium">{label}</span>
          </button>
        ))}
      </nav>

      <div className="p-4 border-t border-gray-800 text-xs text-gray-400">
        <p>{APP_VERSION}</p>
      </div>
    </aside>
  )
}
