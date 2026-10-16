import { bus } from '../core/bus';
import { getData } from '../core/config';

interface Layer {
  type: 'noise' | 'tone' | 'metal';
  filter?: BiquadFilterType;
  wave?: OscillatorType;
  freq?: [number, number];
  freqs?: number[];
  q?: number;
  dur: number;
  gain: number;
  delay?: number;
}

interface AudioData {
  master: number;
  pitchJitter: number;
  useFiles: boolean;
  sounds: Record<string, { path: string; layers: Layer[] }>;
}

/**
 * 사운드 키로 재생. 지금은 소리 파일 대신 Web Audio로 합성한다.
 * data/audio.json의 path는 실제 파일이 생기면 useFiles=true로 바꿔 쓴다.
 * 같은 소리 반복을 피하려고 음높이를 ±5% 무작위로 바꾼다.
 */
export class Audio {
  private readonly data = getData<AudioData>('audio');
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private files = new Map<string, AudioBuffer>();
  volume = 1;

  constructor() {
    const unlock = () => this.ensure();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    bus.on('sfx', ({ key, volume }) => this.play(key, volume));
    bus.on('settingsChanged', ({ settings }) => this.setVolume(settings.volume));
  }

  private ensure(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.data.master * this.volume;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const ch = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    if (this.data.useFiles) void this.loadFiles();
  }

  private async loadFiles(): Promise<void> {
    for (const [key, s] of Object.entries(this.data.sounds)) {
      try {
        const res = await fetch(s.path);
        if (res.ok) this.files.set(key, await this.ctx!.decodeAudioData(await res.arrayBuffer()));
      } catch {
        /* 파일이 없으면 합성음 사용 */
      }
    }
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx) this.master.gain.value = this.data.master * v;
  }

  play(key: string, volume = 1): void {
    const ctx = this.ctx;
    const snd = this.data.sounds[key];
    if (!ctx || !snd || ctx.state !== 'running') return;
    const pitch = 1 + (Math.random() * 2 - 1) * this.data.pitchJitter;
    const file = this.files.get(key);
    if (file) {
      const src = ctx.createBufferSource();
      src.buffer = file;
      src.playbackRate.value = pitch;
      const g = ctx.createGain();
      g.gain.value = volume;
      src.connect(g).connect(this.master);
      src.start();
      return;
    }
    for (const layer of snd.layers) this.synth(layer, pitch, volume);
  }

  private envelope(t0: number, dur: number, peak: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.008, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    g.connect(this.master);
    return g;
  }

  private synth(l: Layer, pitch: number, volume: number): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + (l.delay ?? 0);
    const gain = l.gain * volume;
    if (l.type === 'noise') {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = l.filter ?? 'bandpass';
      f.Q.value = l.q ?? 1;
      const [a, b] = l.freq ?? [1000, 1000];
      f.frequency.setValueAtTime(a * pitch, t0);
      f.frequency.exponentialRampToValueAtTime(Math.max(20, b * pitch), t0 + l.dur);
      src.connect(f).connect(this.envelope(t0, l.dur, gain));
      src.start(t0, Math.random() * 0.5, l.dur + 0.05);
    } else if (l.type === 'tone') {
      const osc = ctx.createOscillator();
      osc.type = l.wave ?? 'sine';
      const [a, b] = l.freq ?? [440, 440];
      osc.frequency.setValueAtTime(a * pitch, t0);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, b * pitch), t0 + l.dur);
      osc.connect(this.envelope(t0, l.dur, gain));
      osc.start(t0);
      osc.stop(t0 + l.dur + 0.05);
    } else {
      // 금속음: 비정수배 배음 여러 개를 겹친다
      const freqs = l.freqs ?? [800];
      freqs.forEach((fr, i) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = fr * pitch;
        const d = l.dur * (1 - i * 0.12);
        osc.connect(this.envelope(t0, Math.max(0.05, d), gain / Math.sqrt(i + 1)));
        osc.start(t0);
        osc.stop(t0 + d + 0.05);
      });
    }
  }
}
