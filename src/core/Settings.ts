import { bus } from './bus';
import type { Settings } from './events';

const KEY = 'sto-settings';

export const DEFAULT_SETTINGS: Settings = {
  volume: 0.8, music: 0.6, shake: 1, showNames: true, damageNumbers: true, bloom: true,
  autoHp: 0, autoMp: 0, aimAssist: true, cdAlert: true,
};

/** 설정 보관: 읽기·바꾸기·저장. 바뀌면 settingsChanged 이벤트로 모두에게 알린다 */
class SettingsStore {
  readonly v: Settings = { ...DEFAULT_SETTINGS };

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) Object.assign(this.v, JSON.parse(raw));
      // 예전 F4 설정을 이어받는다
      if (localStorage.getItem('sto-fancy') === '0' && !raw) this.v.bloom = false;
    } catch {
      /* 저장소를 못 쓰면 기본값 */
    }
  }

  set<K extends keyof Settings>(k: K, val: Settings[K]): void {
    this.v[k] = val;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.v));
    } catch {
      /* 무시 */
    }
    this.emit();
  }

  reset(): void {
    Object.assign(this.v, DEFAULT_SETTINGS);
    this.set('volume', this.v.volume);
  }

  /** 처음 한 번(모든 시스템이 만들어진 뒤) 현재 값을 알린다 */
  emit(): void {
    bus.emit('settingsChanged', { settings: this.v });
  }
}

export const settings = new SettingsStore();
