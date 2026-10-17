import type { S2C } from '../../shared/protocol';
import type { Social2C } from '../../shared/social';

export interface Settings {
  volume: number;
  screenShake: boolean;
  showNames: boolean;
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
  sfx: { key: string; volume?: number };
  settingsChanged: { settings: Settings };
  /** 채팅 입력창이 열렸다/닫혔다(게임 입력 막기) */
  typing: { active: boolean };
  /** 화면 알림 한 줄 */
  toast: { text: string; kind?: 'info' | 'warn' | 'good' };
  /** 소셜 서버에서 받은 메시지 */
  social: Social2C;
  /** 채팅 입력창을 이 내용으로 연다(귓속말 등) */
  chatPrefill: { text: string };
}
