import type { ReactNode } from 'react';
import { Hl } from './brand';

/** Key words inside a note: the same highlighter stroke as <Hl>, so key points read the same everywhere. */
export function U({ children, onDark = false }: { children: ReactNode; onDark?: boolean }) {
  return <Hl onDark={onDark}>{children}</Hl>;
}
