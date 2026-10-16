import type * as THREE from 'three';

export type Team = 'player' | 'enemy';
/** 공격 예고 색. 흰 빛 = 패링 가능, 붉은 빛 = 회피만, 보라 = 잡기 */
export type Glow = 'white' | 'red' | 'purple';

export interface ProjectileSpec {
  speed: number;
  radius: number;
  length: number;
  life: number;
  count: number;
  /** 연사 간격(프레임) */
  interval: number;
  color: string;
  /** 발사 높이 */
  height: number;
}

/** 공격 한 동작의 데이터. 프레임은 60fps 기준. */
export interface AttackData {
  id: string;
  /** 표시용 이름(사망 원인 등) */
  name?: string;
  startup: number;
  active: number;
  recovery: number;
  /** 이 프레임부터 다음 행동으로 캔슬 가능(공격 시작 기준) */
  cancelFrame: number;
  /** 이 프레임부터 이동 입력만으로 후딜을 끊을 수 있음(없으면 끝까지) */
  moveCancelFrame?: number;
  damage: number;
  posture: number;
  /** 선딜+판정 동안 앞으로 미끄러지는 거리(m) */
  advance: number;
  hitstop: number;
  stamina?: number;
  shake?: number;
  sfx?: string;
  hitSfx?: string;
  /** [수평각, 수직각] 도 단위. 수평각 +는 왼쪽 */
  arc: { from: [number, number]; to: [number, number] };
  hitRadius?: number;
  glow?: Glow;
  parryable?: boolean;
  blockable?: boolean;
  heavy?: boolean;
  knockback?: number;
  /** 이 구간 동안 무적 [시작, 끝) */
  iframes?: [number, number];
  /** 강인함: 맞아도 경직되지 않음 */
  superArmor?: boolean;
  blockStamina?: number;
  /** false면 검 판정 없음(투사체만) */
  melee?: boolean;
  /** 판정 시작 시(또는 간격마다) 발사하는 투사체 */
  projectile?: ProjectileSpec;
}

export interface Segment {
  a: THREE.Vector3;
  b: THREE.Vector3;
}

export interface Vitals {
  hp: number;
  maxHp: number;
  posture: number;
  maxPosture: number;
  stamina: number;
  maxStamina: number;
  /** 기력(검 기술용, 플레이어만) */
  spirit: number;
  maxSpirit: number;
}

/** 각인·영구 강화가 바꾸는 배율. 기본값 1/0 */
export interface Modifiers {
  damageMul: number;
  postureMul: number;
  heavyDamageMul: number;
  attackSpeed: number;
  parryWindowBonusMs: number;
  nextHitMul: number;
  damageTakenMul: number;
  staminaRegenMul: number;
  blockCostMul: number;
  dodgeCostDelta: number;
  /** 강공격 차지·공격 중 강인함 */
  heavyArmor: boolean;
}

export function defaultMods(): Modifiers {
  return {
    damageMul: 1, postureMul: 1, heavyDamageMul: 1, attackSpeed: 1, parryWindowBonusMs: 0, nextHitMul: 1,
    damageTakenMul: 1, staminaRegenMul: 1, blockCostMul: 1, dodgeCostDelta: 0, heavyArmor: false,
  };
}

/** 판정 출처: 검 휘두르기 또는 투사체 */
export interface HitSource {
  owner: import('./Fighter').Fighter;
  data: AttackData;
  hitList: Set<number>;
  prevSeg: Segment;
  seg: Segment;
  radius: number;
  isActive(): boolean;
  /** 막기 방향 판정에 쓰는 공격 원점 */
  origin(): THREE.Vector3;
  /** 무언가에 닿아 소멸해야 하는 투사체면 true */
  consumeOnContact?: boolean;
  consumed?: boolean;
}
