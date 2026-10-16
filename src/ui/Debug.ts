import * as THREE from 'three';
import { bus } from '../core/bus';
import type { Fighter } from '../combat/Fighter';
import { DebugCapsule } from './DebugCapsule';

interface Entry {
  fighter: Fighter;
  hurt: DebugCapsule;
  blade: DebugCapsule;
  label: HTMLDivElement;
}

/**
 * F1 디버그 화면: 판정 캡슐(판정 구간에만 빨강), 현재 상태 이름, 프레임 번호, 전투 이벤트 기록.
 */
export class Debug {
  visible = false;
  private entries = new Map<number, Entry>();
  private readonly panel: HTMLDivElement;
  private readonly log: string[] = [];
  private frame = 0;
  private readonly tmp = new THREE.Vector3();

  constructor(private readonly scene: THREE.Scene, private readonly camera: THREE.Camera, private readonly ui: HTMLElement) {
    this.panel = document.createElement('div');
    this.panel.className = 'debug-panel';
    ui.appendChild(this.panel);
    this.setVisible(false);

    bus.on('debugToggle', () => this.setVisible(!this.visible));
    bus.on('tick', ({ frame }) => (this.frame = frame));
    bus.on('fighterSpawned', ({ fighter }) => this.add(fighter));
    bus.on('fighterRemoved', ({ fighter }) => this.remove(fighter));
    bus.on('hit', (e) =>
      this.push(`${e.finisher ? '결정타' : '피격'}: ${e.attacker.name} → ${e.target.name} (${e.damage} / 자세 ${Math.round(e.postureDamage)})`, e.finisher ? 'finisher' : 'hit'),
    );
    bus.on('postureBreak', (e) => this.push(`자세 붕괴: ${e.fighter.name}${e.guardBreak ? ' (가드 브레이크)' : ''}`, 'break'));
    bus.on('death', (e) => this.push(`사망: ${e.fighter.name}`, 'death'));
  }

  protected push(text: string, kind: string): void {
    this.log.unshift(`<span class="ev-${kind}">[${this.frame}] ${text}</span>`);
    if (this.log.length > 12) this.log.pop();
  }

  private add(fighter: Fighter): void {
    const hurt = new DebugCapsule('#3cff6e');
    const blade = new DebugCapsule('#888888');
    this.scene.add(hurt.group, blade.group);
    hurt.group.visible = blade.group.visible = this.visible;
    const label = document.createElement('div');
    label.className = 'debug-label';
    label.style.display = this.visible ? '' : 'none';
    this.ui.appendChild(label);
    this.entries.set(fighter.id, { fighter, hurt, blade, label });
  }

  private remove(fighter: Fighter): void {
    const e = this.entries.get(fighter.id);
    if (!e) return;
    this.scene.remove(e.hurt.group, e.blade.group);
    e.hurt.dispose();
    e.blade.dispose();
    e.label.remove();
    this.entries.delete(fighter.id);
  }

  private setVisible(v: boolean): void {
    this.visible = v;
    this.panel.style.display = v ? '' : 'none';
    for (const e of this.entries.values()) {
      e.hurt.group.visible = e.blade.group.visible = v;
      e.label.style.display = v ? '' : 'none';
    }
  }

  render(): void {
    if (!this.visible) return;
    const w = window.innerWidth, h = window.innerHeight;
    let player: Fighter | null = null;
    for (const e of this.entries.values()) {
      const f = e.fighter;
      if (f.team === 'player') player = f;
      const [a, b] = f.hurtCapsule();
      const hurtColor = f.iframe ? '#3ca0ff' : f.blocking ? '#ffd23c' : f.isBroken() ? '#ff40ff' : '#3cff6e';
      e.hurt.set(a, b, f.radius, hurtColor, 0.5);
      const active = !!f.attack?.isActive();
      const r = f.attack?.radius ?? 0.12;
      e.blade.set(f.seg.a, f.seg.b, r, active ? '#ff2020' : '#909090', active ? 1 : 0.25);

      this.tmp.set(f.pos.x, f.pos.y + f.height + 0.5, f.pos.z).project(this.camera);
      const onScreen = this.tmp.z < 1;
      e.label.style.display = onScreen ? '' : 'none';
      e.label.style.transform = `translate(${((this.tmp.x + 1) / 2) * w}px, ${((1 - this.tmp.y) / 2) * h}px) translate(-50%, -100%)`;
      const atk = f.attack ? ` ${f.attack.data.id} ${f.attack.frame}/${f.attack.total} [${f.attack.phase()}]` : '';
      e.label.textContent = `${f.stateName} f${f.stateFrame}${atk}${f.hasToken ? ' ★토큰' : ''}`;
    }
    const p = player;
    const pv = p?.vitals;
    this.panel.innerHTML = [
      `<b>디버그 (F1)</b> 프레임 ${this.frame}`,
      p ? `상태: <b>${p.stateName}</b> (상태 프레임 ${p.stateFrame})` : '',
      p?.attack ? `공격: ${p.attack.data.id} 프레임 ${p.attack.frame}/${p.attack.total} [${p.attack.phase()}] 캔슬 ${p.attack.data.cancelFrame}` : '공격: -',
      pv ? `HP ${Math.round(pv.hp)}/${pv.maxHp} · 스태미나 ${Math.round(pv.stamina)}/${pv.maxStamina} · 자세 ${Math.round(pv.posture)}/${pv.maxPosture}` : '',
      '<hr>',
      ...this.log,
    ].join('<br>');
  }
}
