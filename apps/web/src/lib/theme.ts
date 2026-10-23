import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'light' | 'dark';

interface ThemeState {
  theme: Theme;
  toggle(): void;
}

const initial = (): Theme =>
  (document.documentElement.dataset.theme as Theme) ??
  (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

export const useTheme = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: initial(),
      toggle() {
        const theme = get().theme === 'light' ? 'dark' : 'light';
        document.documentElement.dataset.theme = theme;
        set({ theme });
      },
    }),
    {
      name: 'ss-theme',
      onRehydrateStorage: () => (state) => {
        if (state) document.documentElement.dataset.theme = state.theme;
      },
    },
  ),
);
