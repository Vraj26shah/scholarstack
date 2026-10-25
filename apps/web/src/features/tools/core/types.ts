import type { ComponentType, LazyExoticComponent } from 'react';

/**
 * Everything the site needs to know about one tool. Each tool folder exports one of these from
 * its index.ts; the registry lists them. The tool page, the icons and the toolbox read only this,
 * so adding a tool never means editing them.
 */
export interface ToolModule {
  /** Same key as the tool's row in Admin → Features & email. */
  key: string;
  icon: ComponentType<{ size?: number }>;
  screen: LazyExoticComponent<ComponentType>;
}
