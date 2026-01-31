import React from 'react'
import Sidebar from './Sidebar'
import { PageType } from '../types'

interface LayoutProps {
  children: React.ReactNode
  currentPage: PageType
  onPageChange: (page: PageType) => void
}

export default function Layout({ children, currentPage, onPageChange }: LayoutProps) {
  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      <div className="w-64 bg-gray-900 dark:bg-gray-950 overflow-hidden flex flex-col">
        <Sidebar currentPage={currentPage} onPageChange={onPageChange} />
      </div>
      <main className="flex-1 overflow-y-auto overflow-x-hidden bg-white dark:bg-gray-900">
        <div className="p-8">
          {children}
        </div>
      </main>
    </div>
  )
}
