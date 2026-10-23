import { useTheme } from '../../lib/theme';
import { Moon, Sun } from './icons';

export function ThemeToggle({ onDark = false }: { onDark?: boolean }) {
  const { theme, toggle } = useTheme();
  const next = theme === 'light' ? 'dark' : 'light';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className={`w-11 h-11 rounded-full inline-flex items-center justify-center border-[1.5px] cursor-pointer bg-transparent ${
        onDark ? 'border-white/35 text-white' : 'border-line text-ink'
      }`}
    >
      {theme === 'light' ? <Moon /> : <Sun />}
    </button>
  );
}
