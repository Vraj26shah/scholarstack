import { lazy } from 'react';
import { loadScreen } from '../../../lib/release-sync';
import { Bell } from '../../../shared/ui/icons';
import type { ToolModule } from '../core/types';

export const remindersTool: ToolModule = {
  key: 'reminders',
  icon: Bell,
  screen: lazy(loadScreen(() => import('./reminders-tool'))),
};
