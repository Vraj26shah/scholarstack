import { Toolbox } from '../../shared/ui/icons';
import { toolModule } from './registry';

/** A tool's own icon from its module, or the toolbox for tools that aren't built yet. */
export function ToolIcon({ toolKey, size = 26 }: { toolKey: string; size?: number }) {
  const Icon = toolModule(toolKey)?.icon ?? Toolbox;
  return <Icon size={size} />;
}
