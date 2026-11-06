import { lazy } from 'react';
import { Calendar } from '../../../shared/ui/icons';
import type { ToolModule } from '../core/types';

export const timetableTool: ToolModule = {
  key: 'timetable',
  icon: Calendar,
  screen: lazy(() => import('./timetable-tool')),
};
