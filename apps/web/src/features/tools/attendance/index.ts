import { lazy } from 'react';
import { Check } from '../../../shared/ui/icons';
import type { ToolModule } from '../core/types';

export const attendanceTool: ToolModule = {
  key: 'attendance',
  icon: Check,
  screen: lazy(() => import('./attendance-tool')),
};
