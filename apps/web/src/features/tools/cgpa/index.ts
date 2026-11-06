import { lazy } from 'react';
import { Calculator } from '../../../shared/ui/icons';
import type { ToolModule } from '../core/types';

export const cgpaTool: ToolModule = {
  key: 'cgpa',
  icon: Calculator,
  screen: lazy(() => import('./cgpa-tool')),
};
