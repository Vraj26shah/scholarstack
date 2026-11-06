import { create } from 'zustand';

type Theme = 'light' | 'dark';

interface ThemeState {
  theme: Theme;
  toggle(): void;
}

/** Only an explicit choice is stored; until then the site is light, whatever the phone's setting. */
const KEY = 'ss-theme-choice';

function saved(): Theme {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export const useTheme = create<ThemeState>()((set, get) => ({
  theme: (document.documentElement.dataset.theme as Theme | undefined) ?? saved(),
  toggle() {
    const theme = get().theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      // Private mode: the choice lasts until the tab closes.
    }
    set({ theme });
  },
}));
