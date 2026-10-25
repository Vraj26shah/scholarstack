import type { ReactNode } from 'react';

/** Underlined key words inside a one-line note (students' side). */
export function U({ children, onDark = false }: { children: ReactNode; onDark?: boolean }) {
  return (
    <span
      className={`font-semibold underline decoration-2 underline-offset-[5px] ${
        onDark ? 'text-white decoration-mist' : 'text-ink decoration-teal'
      }`}
    >
      {children}
    </span>
  );
}
