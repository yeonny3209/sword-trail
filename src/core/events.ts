import type * as THREE from 'three';
import type { Fighter } from '../combat/Fighter';
import type { AttackData } from '../combat/types';

export interface HitEvent {
  attacker: Fighter;
  target: Fighter;
  attack: AttackData;
  damage: number;
  postureDamage: number;
  point: THREE.Vector3;
  /** 자세 붕괴 상태에서 맞은 결정타 */
  finisher: boolean;
}

/** 게임 전체 이벤트 목록. 새 이벤트는 여기에 추가한다. */
export interface GameEvents {
  /** 고정 시간 단계 한 번 */
  tick: { frame: number; dt: number };
  debugToggle: Record<string, never>;
  /** 게임 논리를 N프레임 멈춘다(히트스톱) */
  hitstop: { frames: number };
  /** 사운드 키로 재생 */
  sfx: { key: string; volume?: number };

  fighterSpawned: { fighter: Fighter };
  fighterRemoved: { fighter: Fighter };
  attackStarted: { fighter: Fighter; attack: AttackData };
  /** 판정 구간 첫 프레임(휘두름 소리 시점) */
  attackActive: { fighter: Fighter; attack: AttackData };
  hit: HitEvent;
  death: { fighter: Fighter; killer: Fighter | null };
  postureBreak: { fighter: Fighter; guardBreak: boolean };
  postureRecovered: { fighter: Fighter };
  /** 막기 시작 직후 맞음 → 패링 성공. attacker는 패링당한 쪽 */
  parrySuccess: { attacker: Fighter; defender: Fighter; attack: AttackData; point: THREE.Vector3 };
  blocked: { attacker: Fighter; defender: Fighter; attack: AttackData; point: THREE.Vector3; guardBreak: boolean };
  /** 무적 시간으로 공격을 피함 */
  dodged: { attacker: Fighter; defender: Fighter; attack: AttackData };
  dodgeStarted: { fighter: Fighter };
  blockStarted: { fighter: Fighter };
}
