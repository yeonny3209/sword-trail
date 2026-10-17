import * as THREE from 'three';
import { bus } from '../core/bus';
import { questGoal, routeNext, type Goal } from '../../shared/guide';
import { isComplete, progressOf, QUESTS, type QuestState } from '../../shared/quests';
import type { ZoneDef } from '../../shared/types';
import type { Input } from '../input/Input';
import type { LocalPlayer } from './LocalPlayer';

/** 그만두게 하는 입력(직접 움직이거나 싸우기 시작하면 멈춘다) */
const STOP_KEYS = ['attack', 'back', 'jump', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10'] as const;

/**
 * 자동 이동: 큰 지도에서 누른 곳이나 퀘스트 목표(🧭)까지 걸어간다. 다른 존이면 포탈을 이어 타고 간다.
 * 벽에 막히면 옆으로 비켜 돈다. 이동 키·공격·스킬을 누르거나 맞으면 멈춘다.
 * 실제 이동은 Input.auto 방향을 LocalPlayer가 이동 키처럼 쓴다(서버 검사는 그대로).
 */
export class AutoPilot {
  private goal: Goal | null = null;
  /** 퀘스트 안내 중이면 퀘스트 id(존을 옮기면 다시 계산) */
  private quest: string | null = null;
  private side = 0;
  private sideT = 0;
  private checkT = 0;
  private lastD = Infinity;
  private flip = 1;
  private readonly marker: THREE.Mesh;
  private t = 0;
  /** 지금 존에서 향하는 곳(큰 지도 표시용) */
  here: { x: number; z: number } | null = null;

  constructor(private readonly input: Input, scene: THREE.Scene, private readonly quests: () => QuestState, private readonly count: (id: string) => number) {
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.85, 32), new THREE.MeshBasicMaterial({ color: '#7fe0ff', transparent: true, opacity: 0.8, depthWrite: false }));
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false;
    scene.add(this.marker);
    bus.on('guide', ({ quest }) => (quest ? this.guide(quest) : this.stop('')));
  }

  get active(): boolean {
    return !!this.goal;
  }

  /** 지금 존 안의 한 점으로 */
  goTo(zone: string, x: number, z: number, label = '표시한 곳'): void {
    this.quest = null;
    this.set({ zone, x, z, label, near: 1.2 });
  }

  guide(id: string): void {
    const q = QUESTS[id];
    if (!q) return;
    const qs = this.quests();
    const g = questGoal(q, progressOf(q, qs, this.count), isComplete(q, qs, this.count));
    if (!g) return void bus.emit('toast', { text: '이 목표는 길 안내를 할 수 없습니다.', kind: 'warn' });
    this.quest = id;
    this.set(g);
  }

  private set(g: Goal): void {
    if (!Number.isFinite(g.x) || !Number.isFinite(g.z)) return;
    this.goal = g;
    this.lastD = Infinity;
    this.checkT = 0;
    this.side = 0;
    bus.emit('toast', { text: `🧭 자동 이동: ${g.label} — 이동 키를 누르면 멈춥니다`, kind: 'info' });
  }

  stop(why: string): void {
    if (!this.goal) return;
    this.goal = null;
    this.quest = null;
    this.input.auto = null;
    this.marker.visible = false;
    if (why) bus.emit('toast', { text: why, kind: 'info' });
  }

  /** 새 존에 들어왔다: 퀘스트 안내라면 목표를 다시 계산 */
  onZone(): void {
    if (this.quest) {
      const q = this.quest;
      const g = this.goal;
      this.guide(q);
      if (!this.goal) this.goal = g;
    }
  }

  /** 고정 단계마다: 이동 방향을 정한다 */
  update(dt: number, me: LocalPlayer, zone: ZoneDef): void {
    this.input.auto = null;
    const g = this.goal;
    this.here = null;
    if (!g) return;
    if (this.input.manualMove() || STOP_KEYS.some((k) => this.input.pressed.has(k))) return this.stop('자동 이동을 멈췄습니다.');
    if (me.pstate === 'dead') return this.stop('');
    if (me.pstate !== 'free') return;
    // 다른 존이면 다음 포탈로
    let tx = g.x, tz = g.z, near = g.near;
    if (g.zone !== zone.id) {
      const p = routeNext(zone.id, g.zone);
      if (!p) return this.stop('그곳으로 가는 길을 찾지 못했습니다.');
      tx = p.x;
      tz = p.z;
      near = 0;
    }
    this.marker.visible = true;
    this.here = { x: tx, z: tz };
    this.t += dt;
    this.marker.position.set(tx, 0.06, tz);
    this.marker.scale.setScalar(1 + Math.sin(this.t * 5) * 0.12);
    const dx = tx - me.pos.x, dz = tz - me.pos.z;
    const d = Math.hypot(dx, dz);
    if (g.zone === zone.id && d <= near) return this.stop(`도착: ${g.label}`);
    // 막혔나: 0.6초 동안 거의 못 다가갔으면 옆으로 비켜 걷는다
    this.checkT += dt;
    if (this.checkT > 0.6) {
      if (this.lastD - d < 0.35 && this.sideT <= 0) {
        this.side = this.flip;
        this.flip = -this.flip;
        this.sideT = 0.8;
      }
      this.lastD = d;
      this.checkT = 0;
    }
    let ux = dx / (d || 1), uz = dz / (d || 1);
    if (this.sideT > 0) {
      this.sideT -= dt;
      const sx = -uz * this.side, sz = ux * this.side;
      ux = ux * 0.25 + sx;
      uz = uz * 0.25 + sz;
      const l = Math.hypot(ux, uz) || 1;
      ux /= l;
      uz /= l;
    }
    if (!Number.isFinite(ux) || !Number.isFinite(uz)) return this.stop('');
    this.input.auto = { x: ux, z: uz };
  }
}
