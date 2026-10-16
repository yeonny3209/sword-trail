import type { ZoneDO } from './zone/ZoneDO';
import type { SocialDO } from './social/SocialDO';

export interface Env {
  DB: D1Database;
  ZONE: DurableObjectNamespace<ZoneDO>;
  SOCIAL: DurableObjectNamespace<SocialDO>;
  ASSETS: Fetcher;
}
