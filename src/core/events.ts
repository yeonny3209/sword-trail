import type * as THREE from 'three';
import type { Fighter } from '../combat/Fighter';
import type { AttackData } from '../combat/types';
import type { ProjectileSpec } from '../combat/types';
import type { SaveData, Settings } from '../progression/Save';
import type { RunSummary } from '../progression/RunStats';

export interface RewardOption {
  id: string;
  name: string;
  desc: string;
  tags?: string[];
  rarity?: string;
}

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
  /** 적이 공격 예비 동작을 시작(빛 신호) */
  telegraph: { fighter: Fighter; attack: AttackData; frames: number };
  /** 적 고정 대상 변경(null = 해제) */
  lockChanged: { target: Fighter | null };
  /** 적 생성 요청 */
  spawnEnemy: { type: string; x: number; z: number; yaw?: number };
  /** 모든 적 제거 요청(방 전환) */
  clearEnemies: Record<string, never>;
  /** 런·방 진행 */
  teleportPlayer: { x: number; z: number; yaw: number };
  /** 플레이어 완전 회복(새 런 시작, 야영지 귀환) */
  resetPlayer: Record<string, never>;
  roomEntered: { name: string; zone: string; index: number; total: number; type: string };
  waveStarted: { index: number; total: number };
  roomCleared: { type: string; roomId: string };
  gateOpened: Record<string, never>;
  runStarted: { seed: number };
  /** 런 종료(승리/사망). 결과 화면 표시 */
  runEnded: { victory: boolean };
  returnToCamp: Record<string, never>;
  /** 런 결과 요약(결과 화면용) */
  runSummary: { summary: RunSummary };
  /** 화면 전환 페이드 */
  transition: { seconds: number };
  /** 게임 논리 일시정지(메뉴, 포인터 잠금 해제) */
  pause: { paused: boolean; reason: string };
  /** 성장 */
  shardsChanged: { run: number; bank: number };
  shardsBanked: { earned: number; kept: number };
  rewardOffer: { title: string; options: RewardOption[] };
  rewardChosen: { id: string };
  engravingGained: { id: string; name: string; tags: string[] };
  potionsChanged: { count: number; max: number };
  potionUsed: Record<string, never>;
  heal: { target: Fighter; amount: number };
  /** 검 장착(공격 세트 교체) */
  equipSword: { id: string };
  /** 플레이어가 F를 누름 */
  interactPressed: Record<string, never>;
  interactHint: { text: string | null };
  openMenu: { kind: 'upgrades' | 'swords' };
  buyUpgrade: { id: string };
  selectSword: { id: string };
  saveChanged: { save: SaveData };
  settingsChanged: { settings: Settings };
  bossSpawned: { fighter: Fighter };
  bossPhase: { fighter: Fighter; phase: number };
  /** 투사체 발사(궁수 등) */
  fireProjectile: {
    owner: Fighter; attack: AttackData; spec: ProjectileSpec;
    x: number; y: number; z: number; dx: number; dy: number; dz: number;
  };
}
