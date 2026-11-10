import { lazy } from 'react';
import { loadScreen } from '../../../lib/release-sync';
import { Calculator } from '../../../shared/ui/icons';
import type { ToolModule } from '../core/types';

export const cgpaTool: ToolModule = {
  key: 'cgpa',
  icon: Calculator,
  screen: lazy(loadScreen(() => import('./cgpa-tool'))),
};
