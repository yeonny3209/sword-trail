import type { S2C } from '../../shared/protocol';
import type { Social2C } from '../../shared/social';

/** 사용자 설정(설정 창, localStorage 'sto-settings'에 저장) */
export interface Settings {
  /** 효과음 크기 0~1 */
  volume: number;
  /** 배경음악 크기 0~1 */
  music: number;
  /** 화면 흔들림 세기 0~1.5 */
  shake: number;
  showNames: boolean;
  /** 피해 숫자 표시 */
  damageNumbers: boolean;
  /** 빛 번짐 후처리 */
  bloom: boolean;
  /** 자동 물약: 체력·마나가 이 비율 아래면 마신다(0 = 끔) */
  autoHp: number;
  autoMp: number;
  /** 조준 보조: 마우스 방향 근처의 적 쪽으로 공격 방향을 맞춘다 */
  aimAssist: boolean;
  /** 스킬 쿨타임이 끝나면 슬롯이 반짝(+작은 소리) */
  cdAlert: boolean;
}

/** 클라이언트 이벤트 목록. 서버 메시지는 'net'으로 들어온다 */
export interface GameEvents {
  /** 고정 시간 단계 한 번 */
  tick: { frame: number; dt: number };
  /** 서버에서 받은 메시지 */
  net: S2C;
  /** 연결 상태 */
  connection: { state: 'connecting' | 'open' | 'closed'; reason?: string };
  /** 사운드 키로 재생 */
  /** rate: 재생 빠르기(음높이) 배율 */
  sfx: { key: string; volume?: number; rate?: number };
  settingsChanged: { settings: Settings };
  /** 채팅 입력창이 열렸다/닫혔다(게임 입력 막기) */
  typing: { active: boolean };
  /** 화면 알림 한 줄 */
  toast: { text: string; kind?: 'info' | 'warn' | 'good' };
  /** 소셜 서버에서 받은 메시지 */
  social: Social2C;
  /** 지역에 들어옴: 배경음악 선택용 */
  zoneTheme: { type: string; ambient?: string };
  /** 연속 처치 알림(n번째) */
  streak: { n: number };
  /** 채팅 입력창을 이 내용으로 연다(귓속말 등) */
  chatPrefill: { text: string };
  /** 화면 전체 번쩍임(flash) 또는 붉은 테두리(hurt) */
  screen: { kind: 'flash' | 'hurt'; alpha: number; ms: number };
  /** 조작법 창 열기·닫기 */
  help: Record<string, never>;
  /** 퀘스트 길 안내 시작(null = 멈춤) */
  guide: { quest: string | null };
  /** 내가 때린·가리킨 몬스터(대상 정보창) */
  target: { id: number };
  /** 잠깐 느리게(처치 순간 등). scale 0~1 */
  slowmo: { scale: number; ms: number };
}
