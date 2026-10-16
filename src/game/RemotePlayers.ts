import * as THREE from 'three';
import { CLASS_BY_ID } from '../../shared/data';
import { MoveState, type PlayerInfo } from '../../shared/protocol';
import { InterpBuffer, type Sample } from '../net/Interp';
import type { Nameplates } from '../ui/Nameplates';
import { CharacterModel } from './CharacterModel';

interface Remote {
  info: PlayerInfo;
  model: CharacterModel;
  buf: InterpBuffer;
  last: THREE.Vector3;
  speed: number;
}

/** 같은 존의 다른 플레이어. 서버 스냅샷을 보간해서 부드럽게 움직인다 */
export class RemotePlayers {
  readonly list = new Map<number, Remote>();
  private readonly s: Sample = { t: 0, x: 0, z: 0, y: 0, f: 0, st: 0 };

  constructor(private readonly scene: THREE.Scene, private readonly plates: Nameplates) {}

  add(info: PlayerInfo, time: number): void {
    this.remove(info.id);
    const c = CLASS_BY_ID[info.cls];
    const model = new CharacterModel({ body: c.color, weapon: c.weapon });
    model.root.position.set(info.x, 0, info.z);
    model.root.rotation.y = info.f;
    this.scene.add(model.root);
    const buf = new InterpBuffer();
    buf.push({ t: time, x: info.x, z: info.z, y: 0, f: info.f, st: 0 });
    this.list.set(info.id, { info, model, buf, last: new THREE.Vector3(info.x, 0, info.z), speed: 0 });
    this.plates.add(`p${info.id}`, model.root, 2.15, this.label(info), 'player', true);
    this.plates.setHp(`p${info.id}`, info.hp / info.mhp);
  }

  private label(i: PlayerInfo): string {
    return `<span class="lv">Lv${i.lv}</span> ${i.name}${i.guild ? ` <span class="gd">&lt;${i.guild}&gt;</span>` : ''}`;
  }

  remove(id: number): void {
    const r = this.list.get(id);
    if (!r) return;
    this.scene.remove(r.model.root);
    r.model.dispose();
    this.plates.remove(`p${id}`);
    this.list.delete(id);
  }

  clear(): void {
    for (const id of [...this.list.keys()]) this.remove(id);
  }

  /** 스냅샷 한 줄: [id, x, z, y, f, st] */
  push(row: number[], time: number): void {
    const r = this.list.get(row[0]);
    if (!r) return;
    r.buf.push({ t: time, x: row[1], z: row[2], y: row[3], f: row[4], st: row[5] });
  }

  render(renderTime: number, dt: number): void {
    for (const r of this.list.values()) {
      const s = r.buf.sample(renderTime, this.s);
      if (!s) continue;
      const root = r.model.root;
      root.position.set(s.x, s.y, s.z);
      root.rotation.y = s.f;
      const moved = Math.hypot(s.x - r.last.x, s.z - r.last.z) / Math.max(dt, 1e-3);
      r.speed += (moved - r.speed) * Math.min(1, dt * 10);
      r.last.set(s.x, 0, s.z);
      r.model.animate(dt, r.speed, s.y > 0.05 || s.st === MoveState.Air, s.st === MoveState.Down || s.st === MoveState.Dead ? 1 : 0);
    }
  }
}
