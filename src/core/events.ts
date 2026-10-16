/** 게임 전체 이벤트 목록. 새 이벤트는 여기에 추가한다. */
export interface GameEvents {
  /** 고정 시간 단계 한 번 */
  tick: { frame: number; dt: number };
}
