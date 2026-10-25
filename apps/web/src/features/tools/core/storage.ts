import { type ReactNode, createContext, createElement, useContext, useEffect, useRef, useState } from 'react';

/**
 * Where a tool keeps a student's data. Tools depend on this contract, never on localStorage
 * directly, so the place can change (memory in tests, the account one day) without touching them.
 */
export interface ToolStore {
  load<T>(key: string, fallback: T): T;
  save<T>(key: string, value: T): void;
}

/** This browser only. Never throws: private mode or blocked storage just means "not remembered". */
export const browserStore: ToolStore = {
  load(key, fallback) {
    try {
      const raw = localStorage.getItem(`ss_tool_${key}`);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  save(key, value) {
    try {
      localStorage.setItem(`ss_tool_${key}`, JSON.stringify(value));
    } catch {
      // storage unavailable: the tool keeps working in memory
    }
  },
};

/** For tests and previews: forgets everything on reload. */
export function memoryStore(): ToolStore {
  const data = new Map<string, unknown>();
  return {
    load: (key, fallback) => (data.has(key) ? (data.get(key) as typeof fallback) : fallback),
    save: (key, value) => void data.set(key, value),
  };
}

const StoreContext = createContext<ToolStore>(browserStore);

/** Swap the store for a part of the tree (tests use memoryStore()). */
export function ToolStoreProvider({ store, children }: { store: ToolStore; children: ReactNode }) {
  return createElement(StoreContext.Provider, { value: store }, children);
}

/** useState that the current ToolStore remembers between visits. */
export function useToolState<T>(key: string, initial: T): [T, (next: T | ((prev: T) => T)) => void] {
  const store = useContext(StoreContext);
  const [value, setValue] = useState<T>(() => store.load(key, initial));
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    store.save(key, value);
  }, [store, key, value]);
  return [value, setValue];
}

export const newId = () => Math.random().toString(36).slice(2, 10);
