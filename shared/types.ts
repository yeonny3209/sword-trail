/** 게임 데이터(JSON) 타입. 클라이언트·서버 공용 */

export type ClassId = 'swordsman' | 'berserker' | 'blademaster' | 'spellblade';

/** 중심 좌표 + 크기의 사각형(XZ 평면) */
export interface Rect {
  x: number;
  z: number;
  w: number;
  d: number;
}

export interface WallDef extends Rect {
  h: number;
  color?: string;
  /** 지붕이 있는 건물 */
  roof?: string;
}

export interface PropDef {
  kind: 'tree' | 'rock' | 'lamp' | 'crate' | 'fence' | 'well' | 'grass' | 'pillar';
  x: number;
  z: number;
  s?: number;
  r?: number;
}

export interface PortalDef {
  id: string;
  x: number;
  z: number;
  r: number;
  to: string;
  toPortal: string;
  /** 이 포탈로 도착했을 때 나타나는 위치 */
  exit: [number, number];
  label: string;
}

export interface NpcDef {
  id: string;
  name: string;
  title: string;
  x: number;
  z: number;
  f: number;
  color: string;
  role: 'shop' | 'quest' | 'smith' | 'auction' | 'guild' | 'mail' | 'storage' | 'skill' | 'arena' | 'flavor';
  ref?: string;
  lines?: string[];
}

export interface SpawnDef {
  monster: string;
  count: number;
  /** 스폰 영역 사각형 */
  area: Rect;
}

export interface NodeDef {
  kind: 'ore' | 'herb' | 'wood';
  x: number;
  z: number;
}

export interface ZoneDef {
  id: string;
  name: string;
  type: 'town' | 'field' | 'arena';
  level: [number, number];
  pvp: boolean;
  size: [number, number];
  spawn: [number, number];
  ground: string;
  groundAccent?: string;
  sky: string;
  light?: number;
  walls: WallDef[];
  props: PropDef[];
  portals: PortalDef[];
  npcs: NpcDef[];
  spawns: SpawnDef[];
  nodes: NodeDef[];
  /** 필드 보스 */
  boss?: { monster: string; x: number; z: number; respawn: number };
}

export interface ClassDef {
  id: ClassId;
  name: string;
  desc: string;
  role: string;
  color: string;
  weapon: { kind: 'sword' | 'greatsword' | 'dual' | 'runeblade'; length: number; width: number; color: string };
  base: { hp: number; mp: number; atk: number; def: number; crit: number; speed: number };
  growth: { hp: number; mp: number; atk: number; def: number };
  /** 레벨업마다 주는 주 스탯 비중 */
  mainStat: 'str' | 'dex' | 'int';
}
