import { lazy } from 'react';
import { loadScreen } from '../../../lib/release-sync';
import { Check } from '../../../shared/ui/icons';
import type { ToolModule } from '../core/types';

export const attendanceTool: ToolModule = {
  key: 'attendance',
  icon: Check,
  screen: lazy(loadScreen(() => import('./attendance-tool'))),
};
