import type { ComponentType } from 'react';

/**
 * Where each free tool's screen lives. A tool can be listed and announced before its screen
 * exists; until it is added here, its page shows "coming soon".
 *
 * To add one: build it under features/tools/<key>/, then (with `import { lazy } from 'react'`):
 *   cgpa: lazy(() => import('./cgpa/cgpa-tool')),
 */
export const TOOL_SCREENS: Record<string, ComponentType> = {};
