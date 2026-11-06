import type { Standing } from '../domain';

/** How each standing is coloured, in one place. */
export const STANDING_TONE: Record<Standing, string> = {
  safe: 'bg-mist text-on-mist',
  edge: 'bg-marigold-soft text-marigold-text',
  warning: 'bg-marigold-soft text-marigold-text',
  danger: 'bg-blush text-blush-text',
};
