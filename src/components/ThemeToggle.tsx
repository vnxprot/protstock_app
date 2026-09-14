import { Moon, Sun } from 'lucide-react'
import { setTheme, useTheme } from '../lib/theme'

export function ThemeToggle() {
  const theme = useTheme()
  const label = theme === 'light' ? 'Chuyển giao diện tối' : 'Chuyển giao diện sáng'
  return <button type="button" className="theme-toggle" aria-label={label} title={label} aria-pressed={theme === 'light'} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
    {theme === 'light' ? <Moon size={18}/> : <Sun size={18}/>}
    <span>{theme === 'light' ? 'Tối' : 'Sáng'}</span>
  </button>
}
