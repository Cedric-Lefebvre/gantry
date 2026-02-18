import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

export default function CopyableText({ value, children }: { value: string; children: React.ReactNode }) {
  const [copied, setCopied] = useState(false)
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(value).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <span className="group/copy inline-flex items-center gap-0.5 cursor-pointer" onClick={copy} title="Click to copy">
      {children}
      {copied
        ? <Check size={10} className="text-green-500 shrink-0" />
        : <Copy size={10} className="opacity-0 group-hover/copy:opacity-60 text-gray-400 shrink-0 transition-opacity" />}
    </span>
  )
}
