/**
 * 상태효과(버프·디버프): 아군에게 걸리는 것과 적에게 걸리는 것.
 * 같은 효과가 겹치면 더 센 쪽과 더 긴 시간을 따른다(쌓이지 않음).
 */
export type StatusId =
  // 아군(플레이어)
  | 'atkUp' | 'defUp' | 'speedUp' | 'critUp' | 'regen' | 'shield' | 'guard' | 'mpRegen' | 'bond'
  // 적(몬스터)
  | 'defDown' | 'atkDown' | 'slow' | 'bind' | 'vuln' | 'poison';

export interface StatusInfo {
  name: string;
  icon: string;
  debuff: boolean;
  /** power의 뜻(툴팁용) */
  desc: string;
}

export const STATUS: Record<StatusId, StatusInfo> = {
  atkUp: { name: '공격력 증가', icon: '⚔', debuff: false, desc: '공격력 +{p}%' },
  defUp: { name: '방어력 증가', icon: '🛡', debuff: false, desc: '방어력 +{p}%' },
  speedUp: { name: '신속', icon: '💨', debuff: false, desc: '이동 속도 +{p}%' },
  critUp: { name: '치명타 증가', icon: '🎯', debuff: false, desc: '치명타 확률 +{p}%p' },
  regen: { name: '재생', icon: '🌿', debuff: false, desc: '초당 최대 체력의 {p}% 회복' },
  shield: { name: '보호막', icon: '🔰', debuff: false, desc: '피해를 대신 받아 줌' },
  guard: { name: '수호', icon: '✨', debuff: false, desc: '받는 피해 -{p}%' },
  mpRegen: { name: '마나 샘', icon: '💧', debuff: false, desc: '초당 최대 MP의 {p}% 회복' },
  bond: { name: '파티 결속', icon: '👥', debuff: false, desc: '가까운 파티원이 있어 공격·방어 증가' },
  defDown: { name: '방어력 약화', icon: '⬇', debuff: true, desc: '방어력 -{p}%' },
  atkDown: { name: '공격력 약화', icon: '🔻', debuff: true, desc: '공격력 -{p}%' },
  slow: { name: '둔화', icon: '🐌', debuff: true, desc: '이동 속도 -{p}%' },
  bind: { name: '속박', icon: '⛓', debuff: true, desc: '움직일 수 없음' },
  vuln: { name: '약점 노출', icon: '💢', debuff: true, desc: '받는 피해 +{p}%' },
  poison: { name: '독', icon: '☠', debuff: true, desc: '초당 피해' },
};

/** 걸 효과: power는 효과 id마다 뜻이 다르다(비율). dur은 초 */
export interface StatusApply {
  id: StatusId;
  power: number;
  dur: number;
}

/** 서버가 알려 주는 내 효과 한 줄 */
export interface BuffView {
  id: StatusId;
  /** 남은 시간(ms) */
  left: number;
  power: number;
  /** 보호막 남은 양 등 */
  val?: number;
}

/** 스킬 레벨이 오를수록 효과가 커진다(레벨 1 = 1배) */
export function castScale(slv: number): number {
  return 1 + 0.1 * Math.max(0, slv - 1);
}

/** 가까운 파티원이 있을 때의 사냥 보너스 */
export const BOND = { atk: 0.05, def: 0.04, max: 3, range: 30 };

/** 보스는 속박에 면역이고 다른 약화는 이 비율만 통한다 */
export const BOSS_DEBUFF_RATE = 0.6;
