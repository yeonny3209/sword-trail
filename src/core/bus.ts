import { EventBus } from './EventBus';
import type { GameEvents } from './events';

export const bus = new EventBus<GameEvents>();
