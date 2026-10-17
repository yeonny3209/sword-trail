import * as THREE from 'three';
import { bus } from '../core/bus';
import { ITEMS, LOOT } from '../../shared/items';
import type { C2S } from '../../shared/protocol';
import type { LocalPlayer } from './LocalPlayer';
import type { NodeView, ZoneScene } from './ZoneScene';

interface GatherData { seconds: number; range: number; tiers: Record<string, number> }
const KIND_NAME: Record<string, string> = { ore: '광석', herb: '약초', wood: '나무' };

/**
 * 채집: 노드 앞에서 스페이스(또는 클릭) → 1.6초 진행 막대 → 서버에 완료 보고.
 * 움직이거나 맞거나 공격하면 끊긴다.
 */
export class Gathering {
  private readonly g = (LOOT as unknown as { gather: GatherData }).gather;
  private active: { node: NodeView; t: number; x: number; z: number } | null = null;
  private readonly bar: HTMLDivElement;
  private readonly ray = new THREE.Raycaster();

  constructor(ui: HTMLElement, private readonly send: (m: C2S) => void, private readonly say: (html: string) => void,
    private readonly zone: () => ZoneScene | null) {
    this.bar = document.createElement('div');
    this.bar.className = 'castbar';
    this.bar.style.display = 'none';
    ui.appendChild(this.bar);
    bus.on('net', (m) => {
      const z = this.zone();
      if (m.t === 'nodes' && z) {
        for (const n of z.nodes) z.setNode(n.i, true);
        for (const i of m.down) z.setNode(i, false);
      } else if (m.t === 'node') z?.setNode(m.i, m.up);
      else if (m.t === 'gathered') {
        this.say(`채집: ${ITEMS[m.id]?.name ?? m.id} ${m.n}개 <small>(숙련도 ${m.lv})</small>`);
        bus.emit('sfx', { key: 'pickup' });
      }
    });
  }

  /** 이름 표시용 */
  nodeName(n: NodeView): string {
    const tier = this.g.tiers[this.zone()?.def.id ?? ''] ?? 1;
    return ITEMS[`${n.def.kind}_${tier}`]?.name ?? KIND_NAME[n.def.kind];
  }

  /** 지금 캘 수 있는 노드 위치(지도 표시) */
  upNodes(): { x: number; z: number }[] {
    return (this.zone()?.nodes ?? []).filter((n) => n.up).map((n) => n.def);
  }

  nearest(x: number, z: number): NodeView | null {
    let best: NodeView | null = null, bd = this.g.range * this.g.range;
    for (const n of this.zone()?.nodes ?? []) {
      if (!n.up) continue;
      const d = (n.def.x - x) ** 2 + (n.def.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  get busy(): boolean {
    return !!this.active;
  }

  start(n: NodeView, me: LocalPlayer): void {
    if (this.active || me.pstate !== 'free' || me.air) return;
    this.send({ t: 'gather', i: n.i });
    this.active = { node: n, t: 0, x: me.pos.x, z: me.pos.z };
    me.yaw = Math.atan2(n.def.x - me.pos.x, n.def.z - me.pos.z);
    this.bar.style.display = '';
    this.bar.innerHTML = `<span>${this.nodeName(n)} 채집 중…</span><div class="fill"></div>`;
  }

  /** 클릭한 곳이 노드면 채집(가까울 때) */
  click(ndc: { x: number; y: number }, camera: THREE.Camera, me: LocalPlayer): boolean {
    const z = this.zone();
    if (!z) return false;
    this.ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
    const groups = z.nodes.filter((n) => n.up).map((n) => n.res.parent!);
    const hit = this.ray.intersectObjects(groups, true)[0];
    if (!hit) return false;
    const n = z.nodes.find((v) => { let o: THREE.Object3D | null = hit.object; while (o) { if (o === v.res.parent) return true; o = o.parent; } return false; });
    if (!n) return false;
    if ((n.def.x - me.pos.x) ** 2 + (n.def.z - me.pos.z) ** 2 > this.g.range * this.g.range) {
      this.say('조금 더 가까이 가야 합니다.');
      return true;
    }
    this.start(n, me);
    return true;
  }

  cancel(): void {
    this.active = null;
    this.bar.style.display = 'none';
  }

  update(dt: number, me: LocalPlayer): void {
    const a = this.active;
    if (!a) return;
    if (Math.hypot(me.pos.x - a.x, me.pos.z - a.z) > 0.25 || me.pstate !== 'free' || !a.node.up) {
      this.say('채집이 끊겼습니다.');
      return this.cancel();
    }
    a.t += dt;
    (this.bar.querySelector('.fill') as HTMLDivElement).style.width = `${Math.min(100, (a.t / this.g.seconds) * 100)}%`;
    if (a.t >= this.g.seconds) {
      this.send({ t: 'gatherdone', i: a.node.i });
      this.cancel();
    }
  }
}
