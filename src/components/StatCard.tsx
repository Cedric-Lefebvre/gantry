import React from 'react'

interface StatCardProps {
  label: string
  value: string | number
  className?: string
}

export default function StatCard({ label, value, className = '' }: StatCardProps) {
  return (
    <div className={`bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 ${className}`}>
      <div className="text-sm text-gray-600 dark:text-gray-400">{label}</div>
      <div className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">{value}</div>
    </div>
  )
}
