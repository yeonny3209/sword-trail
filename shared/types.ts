/** 게임 데이터(JSON) 타입. 클라이언트·서버 공용 */

export type ClassId = 'swordsman' | 'berserker' | 'blademaster' | 'spellblade' | 'buffer' | 'debuffer';

/** 무기 종류(손에 쥔 모양) */
export type WeaponKind = 'sword' | 'greatsword' | 'dual' | 'runeblade' | 'staff' | 'scythe';

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
  kind: 'tree' | 'rock' | 'lamp' | 'crate' | 'fence' | 'well' | 'grass' | 'pillar' | 'deadtree' | 'snowpine' | 'crystal' | 'lava';
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
  type: 'town' | 'field' | 'arena' | 'raid';
  level: [number, number];
  pvp: boolean;
  size: [number, number];
  spawn: [number, number];
  ground: string;
  groundAccent?: string;
  sky: string;
  light?: number;
  /** 햇빛(달빛) 색 */
  sun?: string;
  /** 떠다니는 입자(분위기) */
  ambient?: 'dust' | 'leaf' | 'firefly' | 'mist' | 'ash' | 'snow' | 'ember' | 'wisp';
  /** 안개가 시작되는 거리·완전히 덮는 거리 */
  fog?: [number, number];
  walls: WallDef[];
  props: PropDef[];
  portals: PortalDef[];
  npcs: NpcDef[];
  spawns: SpawnDef[];
  nodes: NodeDef[];
  /** 필드 보스 */
  boss?: { monster: string; x: number; z: number; respawn: number };
}

/** 캐릭터 겉모습(머리 모양·갑옷·망토 등) */
export interface CharacterLook {
  hairStyle: 'spiky' | 'short' | 'long' | 'pony' | 'wild' | 'none';
  hairColor: string;
  /** 가슴 갑옷 */
  armor: string;
  /** 허리띠·테두리 */
  accent: string;
  boots: string;
  /** 망토 색(없으면 망토 없음) */
  cape?: string;
  pauldron: 'none' | 'small' | 'big';
  /** 투구(병사형 몬스터) */
  helm?: boolean;
}

export interface ClassDef {
  id: ClassId;
  name: string;
  desc: string;
  role: string;
  color: string;
  weapon: { kind: WeaponKind; length: number; width: number; color: string };
  base: { hp: number; mp: number; atk: number; def: number; crit: number; speed: number };
  growth: { hp: number; mp: number; atk: number; def: number };
  /** 레벨업마다 주는 주 스탯 비중 */
  mainStat: 'str' | 'dex' | 'int';
  look?: CharacterLook;
}

/** 타격 한 번(행동 안의 판정 구간) */
export interface HitDef {
  /** 판정 프레임 [시작, 끝] (60fps) */
  f: [number, number];
  shape: import('./geom').HitShape;
  /** 공격력 배율 */
  dmg: number;
  /** 수평 밀어내기 속도(m/s) */
  kx: number;
  /** 지상 대상을 띄우는 속도(m/s) */
  kz?: number;
  /** 공중 대상을 다시 띄우는 속도(공중 콤보) */
  airKz?: number;
  /** 경직 프레임 */
  stun: number;
  /** 히트스톱 프레임 */
  stop: number;
  shake?: number;
  /** N프레임마다 같은 대상을 다시 때릴 수 있음(연타 판정) */
  multi?: number;
  /** 때릴 때 얻는 MP */
  mp?: number;
  fx?: 'slash' | 'heavy' | 'pierce' | 'x' | 'magic';
  /** 대상을 끌어당김(+) 또는 밀어냄 */
  pull?: boolean;
}

/** 스킬 효과: 정해진 프레임에 서버가 적용한다. 효과 크기는 스킬 레벨(castScale)에 따라 커진다 */
export interface Cast {
  /** 이 프레임에 적용 */
  at: number;
  /** 아군: 가까운 파티원(나 포함) */
  ally?: {
    range: number;
    /** 나만 */
    selfOnly?: boolean;
    /** 최대 체력의 비율만큼 회복 */
    heal?: number;
    buffs?: import('./status').StatusApply[];
    /** 쓰러진 파티원 한 명을 이 체력 비율로 살림 */
    revive?: number;
  };
  /** 적: 판정 모양 안의 적에게 */
  foe?: { shape: import('./geom').HitShape; debuffs: import('./status').StatusApply[] };
  /** 연출 색 */
  color?: string;
}

/** 행동(기본공격·대시공격·점프공격·백스텝·스킬) — 프레임 단위 */
export interface ActionDef {
  id: string;
  name: string;
  len: number;
  /** 이 프레임부터 다음 콤보 입력을 받는다 */
  chain?: number;
  next?: string;
  /** 이 프레임부터 스킬·백스텝으로 캔슬 */
  cancel?: number;
  /** 이 프레임부터 이동으로 끊기 */
  moveCancel?: number;
  /** 앞으로 미는 속도 구간 [시작, 끝, m/s] */
  move?: [number, number, number][];
  /** 위로 뛰는 순간 [프레임, m/s] */
  vy?: [number, number][];
  air?: boolean;
  armor?: [number, number];
  invul?: [number, number];
  /** 앞쪽 방향 고정(백스텝 등) */
  back?: boolean;
  hits: HitDef[];
  /** 무기 자세 키프레임 [프레임, 수평각, 수직각] */
  pose: [number, number, number][];
  trail?: [number, number][];
  /** 화면 연출 [프레임, 종류] */
  fx?: [number, 'crescent' | 'ring' | 'wave' | 'flash' | 'line', number?][];
  sfx?: [number, string][];
  /** 스킬 비용 */
  mp?: number;
  cd?: number;
  /** 스킬을 배우는 레벨 */
  lv?: number;
  /** 스킬 최대 레벨(기본 5) */
  max?: number;
  /** 이 프레임들에서 마우스 방향으로 다시 돈다 */
  aim?: number[];
  /** 아군·적에게 거는 효과(치유·버프·디버프·소생) */
  cast?: Cast;
  icon?: string;
  desc?: string;
}

export interface ClassKit {
  combo: string;
  dash: string;
  jump: string;
  back: string;
  skills: string[];
  actions: ActionDef[];
}

export interface MonsterAttackDef {
  name: string;
  /** 예비 동작(초) */
  windup: number;
  /** 판정 시간(초) */
  active: number;
  recover: number;
  range: number;
  shape: import('./geom').HitShape;
  dmg: number;
  kx: number;
  kz?: number;
  stun: number;
  /** 앞으로 덤비는 속도 */
  lunge?: number;
  /** 강한 공격(붉은 빛) */
  heavy?: boolean;
  cd: number;
  /** 화면 연출(화살·검기) */
  fx?: 'arrow' | 'wave';
}

export interface MonsterDef {
  id: string;
  name: string;
  lv: number;
  hp: number;
  atk: number;
  def: number;
  exp: number;
  gold: [number, number];
  speed: number;
  radius: number;
  height: number;
  /** 띄우기·밀림 저항(1 = 보통) */
  weight: number;
  aggro: number;
  leash: number;
  superArmor?: boolean;
  boss?: boolean;
  respawn: number;
  /** 레이드 보스: 부하 소환·체력 단계·격노 */
  raid?: { adds: string; phases: number[]; addsPerPlayer: number; enrageSec: number };
  attacks: MonsterAttackDef[];
  model: { shape: 'slime' | 'beast' | 'humanoid' | 'golem'; color: string; scale: number; weapon?: { kind: WeaponKind; length: number; width: number; color: string } };
  /** 정예 몬스터: 원래 몬스터 id */
  elite?: string;
  hitMat?: 'flesh' | 'metal' | 'slime' | 'stone';
}
