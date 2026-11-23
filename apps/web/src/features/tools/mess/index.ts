import { lazy } from 'react';
import { loadScreen } from '../../../lib/release-sync';
import { Bowl } from '../../../shared/ui/icons';
import type { ToolModule } from '../core/types';

export const messTool: ToolModule = {
  key: 'mess-menu',
  icon: Bowl,
  screen: lazy(loadScreen(() => import('./mess-tool'))),
};
