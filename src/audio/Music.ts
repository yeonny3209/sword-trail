import { bus } from '../core/bus';

/** 곡 하나의 설정: 음계(반음 간격), 빠르기, 어떤 층을 쓰는가 */
interface Theme {
  root: number;
  scale: number[];
  bpm: number;
  /** 4마디 코드 진행(음계 칸 번호) */
  chords: number[][];
  pad: number;
  arp: number;
  drums: number;
  bass: number;
  /** 음색 밝기 */
  tone: number;
}

const THEMES: Record<string, Theme> = {
  town: { root: 60, scale: [0, 2, 4, 7, 9], bpm: 78, chords: [[0, 2, 4], [3, 5, 7], [1, 3, 5], [4, 6, 8]], pad: 0.5, arp: 0.5, drums: 0, bass: 0.5, tone: 2400 },
  field: { root: 57, scale: [0, 2, 3, 5, 7, 9, 10], bpm: 96, chords: [[0, 2, 4], [5, 7, 9], [3, 5, 7], [4, 6, 8]], pad: 0.5, arp: 0.6, drums: 0.5, bass: 0.7, tone: 2000 },
  snow: { root: 62, scale: [0, 2, 4, 7, 9], bpm: 70, chords: [[0, 2, 4], [2, 4, 6], [1, 3, 5], [3, 5, 7]], pad: 0.7, arp: 0.7, drums: 0, bass: 0.4, tone: 3200 },
  ash: { root: 52, scale: [0, 1, 4, 5, 7, 8, 10], bpm: 104, chords: [[0, 2, 4], [1, 3, 5], [0, 2, 4], [5, 7, 9]], pad: 0.6, arp: 0.4, drums: 0.7, bass: 0.9, tone: 1500 },
  arena: { root: 52, scale: [0, 2, 3, 5, 7, 8, 10], bpm: 126, chords: [[0, 2, 4], [5, 7, 9], [3, 5, 7], [6, 8, 10]], pad: 0.4, arp: 0.7, drums: 1, bass: 1, tone: 2200 },
  raid: { root: 45, scale: [0, 1, 3, 5, 7, 8, 10], bpm: 112, chords: [[0, 2, 4], [1, 3, 5], [0, 2, 4], [4, 6, 8]], pad: 0.7, arp: 0.5, drums: 0.9, bass: 1, tone: 1300 },
};

/** 존 종류·분위기에서 곡을 고른다 */
function themeOf(zone: { type: string; ambient?: string }): string {
  if (zone.type === 'town') return 'town';
  if (zone.type === 'arena') return 'arena';
  if (zone.type === 'raid') return 'raid';
  if (zone.ambient === 'snow') return 'snow';
  if (zone.ambient === 'ash') return 'ash';
  return 'field';
}

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

/**
 * 지역마다 다른 분위기의 배경음악을 Web Audio로 실시간 합성한다(파일 없음).
 * 코드 진행 위에 패드·베이스·아르페지오·드럼 층을 올리고, 지역이 바뀌면 자연스럽게 바꾼다. M 키로 끄고 켠다.
 */
export class Music {
  private ctx: AudioContext | null = null;
  private out!: GainNode;
  private noise!: AudioBuffer;
  private theme: Theme | null = null;
  private name = '';
  private step = 0;
  private nextT = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private volume = 1;
  private muted = false;
  private pending: string | null = null;

  constructor() {
    const unlock = () => this.ensure();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    bus.on('zoneTheme', ({ type, ambient }) => this.set(themeOf({ type, ambient })));
    bus.on('settingsChanged', ({ settings }) => {
      this.volume = settings.volume;
      this.apply();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyM' || e.repeat || e.ctrlKey || e.metaKey || (e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      this.muted = !this.muted;
      this.apply();
      bus.emit('toast', { text: this.muted ? '배경음악 끔 (M)' : '배경음악 켬 (M)', kind: 'info' });
    });
  }

  private ensure(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const ctx = (this.ctx = new AudioContext());
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(ctx.destination);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const ch = this.noise.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    this.timer = setInterval(() => this.tick(), 90);
    if (this.pending) this.set(this.pending);
  }

  private apply(): void {
    if (!this.ctx) return;
    const g = this.muted ? 0 : 0.2 * this.volume;
    this.out.gain.cancelScheduledValues(this.ctx.currentTime);
    this.out.gain.linearRampToValueAtTime(g, this.ctx.currentTime + 0.8);
  }

  /** 곡을 바꾼다(같은 곡이면 그대로) */
  private set(name: string): void {
    if (!this.ctx) {
      this.pending = name;
      return;
    }
    if (name === this.name) return;
    this.name = name;
    this.theme = THEMES[name];
    this.step = 0;
    this.nextT = this.ctx.currentTime + 0.2;
    this.apply();
  }

  private tick(): void {
    const ctx = this.ctx, th = this.theme;
    if (!ctx || !th || ctx.state !== 'running') return;
    const sixteenth = 60 / th.bpm / 4;
    while (this.nextT < ctx.currentTime + 0.35) {
      this.play(th, this.step, this.nextT, sixteenth);
      this.nextT += sixteenth;
      this.step++;
    }
  }

  private note(th: Theme, degree: number, octave = 0): number {
    const n = th.scale.length;
    const oct = Math.floor(degree / n);
    return th.root + octave * 12 + oct * 12 + th.scale[((degree % n) + n) % n];
  }

  private play(th: Theme, step: number, t: number, s: number): void {
    const bar = Math.floor(step / 16) % 4, pos = step % 16;
    const chord = th.chords[bar];
    // 패드: 마디 첫 박에 코드를 길게
    if (pos === 0 && th.pad > 0) for (const d of chord) this.tone(midi(this.note(th, d, 0)), t, s * 16, 'sawtooth', 0.05 * th.pad, th.tone * 0.5, 0.6);
    // 베이스: 박마다 근음, 변주
    if (th.bass > 0 && (pos % 4 === 0 || (th.drums > 0.8 && pos % 8 === 6))) this.tone(midi(this.note(th, chord[0], -1)), t, s * 3.5, 'triangle', 0.22 * th.bass, 700, 0.02);
    // 아르페지오: 코드 음을 돌며 뜯는다
    const pat = [0, 1, 2, 1, 2, 1, 0, 1];
    if (th.arp > 0 && pos % 2 === 0 && (pos % 8 !== 6 || th.arp > 0.55)) {
      const d = chord[pat[(pos / 2) % pat.length] % chord.length];
      this.tone(midi(this.note(th, d, 1)), t, s * 2.2, 'triangle', 0.1 * th.arp, th.tone * 1.8, 0.01);
    }
    // 드럼
    if (th.drums > 0) {
      if (pos % 8 === 0 || (th.drums > 0.8 && pos % 8 === 6)) this.kick(t, th.drums);
      if (pos === 4 || pos === 12) this.snare(t, th.drums);
      if (pos % 2 === 0 && th.drums > 0.4) this.hat(t, th.drums * (pos % 4 === 2 ? 1 : 0.6));
    }
  }

  private tone(freq: number, t: number, dur: number, wave: OscillatorType, gain: number, cutoff: number, attack: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = wave;
    o.frequency.value = freq;
    o.detune.value = (Math.random() - 0.5) * 8;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + Math.max(0.005, attack));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(this.out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private kick(t: number, vol: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.25);
  }

  private snare(t: number, vol: number): void {
    this.burst(t, 0.16, 'bandpass', 1800, 0.22 * vol);
  }

  private hat(t: number, vol: number): void {
    this.burst(t, 0.05, 'highpass', 7000, 0.09 * vol);
  }

  private burst(t: number, dur: number, type: BiquadFilterType, freq: number, gain: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.out);
    src.start(t, Math.random() * 0.5, dur + 0.02);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    void this.ctx?.close();
  }
}
