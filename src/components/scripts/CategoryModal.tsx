import { useState } from 'react'
import { X } from 'lucide-react'
import { CATEGORY_PRESETS, DEFAULT_SCRIPT_ICON, SCRIPT_ICONS, scriptIcon } from '../../constants/scriptIcons'

export interface CategoryForm {
  name: string
  icon: string
}

interface CategoryModalProps {
  title: string
  initial?: CategoryForm
  takenNames: string[]
  confirmLabel: string
  onConfirm: (form: CategoryForm) => Promise<void>
  onClose: () => void
}

export default function CategoryModal({ title, initial, takenNames, confirmLabel, onConfirm, onClose }: CategoryModalProps) {
  const [form, setForm] = useState<CategoryForm>(initial ?? { name: '', icon: DEFAULT_SCRIPT_ICON })
  const [error, setError] = useState<string | null>(null)

  const taken = new Set(takenNames.map(n => n.toLowerCase()))
  const presets = CATEGORY_PRESETS.filter(p => !taken.has(p.name.toLowerCase()))
  const PreviewIcon = scriptIcon(form.icon)
  const valid = form.name.trim() !== ''

  const submit = async () => {
    if (!valid) return
    try {
      setError(null)
      await onConfirm({ name: form.name.trim(), icon: form.icon })
    } catch (err) {
      setError(String(err))
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-md mx-4 shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{title}</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                <PreviewIcon size={20} />
              </div>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                onKeyDown={e => { if (e.key === 'Enter') submit() }}
                placeholder="e.g., Cleanup"
                autoFocus
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {presets.length > 0 && (
            <div>
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Suggestions</div>
              <div className="flex flex-wrap gap-2">
                {presets.map(preset => {
                  const Icon = scriptIcon(preset.icon)
                  return (
                    <button
                      key={preset.name}
                      onClick={() => setForm(preset)}
                      className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                    >
                      <Icon size={12} />
                      {preset.name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div>
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Icon</div>
            <div className="grid grid-cols-8 gap-1.5">
              {Object.entries(SCRIPT_ICONS).map(([key, { icon: Icon, label }]) => (
                <button
                  key={key}
                  onClick={() => setForm({ ...form, icon: key })}
                  title={label}
                  aria-label={label}
                  aria-pressed={form.icon === key}
                  className={`aspect-square flex items-center justify-center rounded-lg transition-colors ${
                    form.icon === key
                      ? 'bg-blue-600 text-white shadow'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  <Icon size={18} />
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={!valid}
              className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg transition-colors"
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
