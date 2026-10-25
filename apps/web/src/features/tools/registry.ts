import { attendanceTool } from './attendance';
import { cgpaTool } from './cgpa';
import type { ToolModule } from './core/types';
import { timetableTool } from './timetable';

/**
 * The tools this site has screens for. To add one, build its folder (see README.md) and add it
 * here; nothing else in the site changes. A tool listed in the admin panel without a module here
 * shows "coming soon".
 */
const MODULES: ToolModule[] = [cgpaTool, attendanceTool, timetableTool];

const BY_KEY = new Map(MODULES.map((m) => [m.key, m]));

export const toolModule = (key: string): ToolModule | undefined => BY_KEY.get(key);
