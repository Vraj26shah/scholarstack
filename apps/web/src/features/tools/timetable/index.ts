import { lazy } from 'react';
import { loadScreen } from '../../../lib/release-sync';
import { Calendar } from '../../../shared/ui/icons';
import type { ToolModule } from '../core/types';

export const timetableTool: ToolModule = {
  key: 'timetable',
  icon: Calendar,
  screen: lazy(loadScreen(() => import('./timetable-tool'))),
};
