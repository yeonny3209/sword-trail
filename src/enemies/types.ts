import type { SwordSpec } from '../combat/Fighter';
import type { AttackData, ProjectileSpec } from '../combat/types';

export type { ProjectileSpec };

export interface EnemyAttack extends AttackData {
  weight: number;
  /** 이 거리 안에서 공격 시작 */
  range: number;
  /** 이 거리보다 가까우면 고르지 않음 */
  minRange?: number;
  /** 이어지는 공격 id(연속기) */
  next?: string;
  /** 페이즈 제한(보스) */
  phase?: number;
}

export interface EnemyData {
  name: string;
  shape?: 'capsule' | 'box';
  radius: number;
  height: number;
  color: string;
  hitColor: string;
  swordColor?: string;
  swordWidth?: number;
  hp: number;
  posture: number;
  postureRegenDelay: number;
  postureRegen: number;
  sword: SwordSpec;
  moveSpeed: number;
  circleSpeed: number;
  turnSpeed: number;
  trackTurnSpeed: number;
  aggroRange: number;
  keepDistance: [number, number];
  /** 플레이어가 이보다 가까우면 뒤로 물러남 */
  retreatDistance?: number;
  attackCooldown: [number, number];
  engageTimeout: number;
  recoverFrames: number;
  hitstunFrames: number;
  parriedFrames: number;
  knockback: number;
  deathSinkSeconds: number;
  /** 항상 강인함(경직 없음) */
  superArmor?: boolean;
  /** 공격 토큰 없이 공격(보스) */
  ignoreTokens?: boolean;
  attacks: EnemyAttack[];
  shards: [number, number];
  boss?: boolean;
}
