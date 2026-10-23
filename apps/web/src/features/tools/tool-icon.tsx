import { Calculator, Calendar, Sparkle } from '../../shared/ui/icons';

export function ToolIcon({ toolKey, size = 26 }: { toolKey: string; size?: number }) {
  if (toolKey === 'cgpa') return <Calculator size={size} />;
  if (toolKey === 'timetable') return <Calendar size={size} />;
  return <Sparkle size={size} />;
}
