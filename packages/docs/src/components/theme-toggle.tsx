import { Monitor, Moon, Sun } from 'lucide-react'
import { type Theme, useTheme } from '../theme/theme-provider'

const OPTIONS: ReadonlyArray<{
  readonly value: Theme
  readonly label: string
  readonly Icon: typeof Sun
}> = [
  { value: 'light', label: 'Light theme', Icon: Sun },
  { value: 'system', label: 'System theme', Icon: Monitor },
  { value: 'dark', label: 'Dark theme', Icon: Moon },
]

/** Three-way light / system / dark switch. */
export function ThemeToggle({ className = '' }: { readonly className?: string }) {
  const { theme, setTheme } = useTheme()
  return (
    <div
      className={`inline-flex items-center rounded-full border border-neutral-200 p-0.5 dark:border-neutral-800 ${className}`}
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = theme === value
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={`rounded-full p-1.5 transition-colors ${
              active
                ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100'
            }`}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}
