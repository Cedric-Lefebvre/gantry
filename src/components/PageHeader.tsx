import React from 'react'

interface PageHeaderProps {
  title: string
  subtitle?: string
  actions?: React.ReactNode
}

export default function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">{title}</h1>
        {subtitle && <p className="text-gray-600 dark:text-gray-400 mt-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  )
}
