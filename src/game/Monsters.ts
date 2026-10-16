import * as THREE from 'three';
import { applyReaction, disabled, newBody, stepBody, type Body } from '../../shared/combat';
import { MONSTERS } from '../../shared/data';
import { shapeHits } from '../../shared/geom';
import { MonState, type MonsterInfo } from '../../shared/protocol';
import type { HitDef, MonsterAttackDef, MonsterDef, ZoneDef } from '../../shared/types';
import { InterpBuffer, type Sample } from '../net/Interp';
import type { Nameplates } from '../ui/Nameplates';
import { MonsterModel } from './MonsterModel';

export interface MonView {
  id: number;
  def: MonsterDef;
  model: MonsterModel;
  buf: InterpBuffer;
  hp: number;
  mhp: number;
  st: MonState;
  /** 내가 때려서 직접 계산하는 반응(예측) */
  body: Body;
  predict: number;
  /** 0 = 예측 위치, 1 = 서버 위치 */
  blend: number;
  pos: THREE.Vector3;
  yaw: number;
  speed: number;
  atk: { k: number; t0: number; a: MonsterAttackDef; reported: boolean } | null;
  dying: number;
}

/** 같은 존의 몬스터들. 서버 상태를 보간하고, 내가 때린 몬스터는 반응을 먼저 계산해서 즉시 보여 준다 */
export class Monsters {
  readonly list = new Map<number, MonView>();
  private readonly s: Sample = { t: 0, x: 0, z: 0, y: 0, f: 0, st: 0 };

  constructor(private readonly scene: THREE.Scene, private readonly plates: Nameplates, private readonly delayMs: () => number) {}

  add(info: MonsterInfo, time: number): void {
    this.remove(info.id);
    const def = MONSTERS[info.kind];
    if (!def) return;
    const model = new MonsterModel(def);
    model.root.position.set(info.x, 0, info.z);
    this.scene.add(model.root);
    const buf = new InterpBuffer();
    buf.push({ t: time, x: info.x, z: info.z, y: 0, f: info.f, st: 0 });
    const v: MonView = {
      id: info.id, def, model, buf, hp: info.hp, mhp: info.mhp, st: MonState.Idle,
      body: newBody(info.x, info.z), predict: 0, blend: 1, pos: new THREE.Vector3(info.x, 0, info.z),
      yaw: info.f, speed: 0, atk: null, dying: 0,
    };
    this.list.set(info.id, v);
    this.plates.add(`m${info.id}`, model.root, def.height * def.model.scale + 0.45, `<span class="lv">Lv${def.lv}</span> ${def.name}`, 'monster', true, 30);
    this.plates.setHp(`m${info.id}`, info.hp / info.mhp);
  }

  remove(id: number): void {
    const v = this.list.get(id);
    if (!v) return;
    this.scene.remove(v.model.root);
    v.model.dispose();
    this.plates.remove(`m${id}`);
    this.list.delete(id);
  }

  clear(): void {
    for (const id of [...this.list.keys()]) this.remove(id);
  }

  /** 스냅샷 한 줄: [id, x, z, y, f, st, hp] */
  push(row: number[], time: number): void {
    const v = this.list.get(row[0]);
    if (!v || v.dying) return;
    v.buf.push({ t: time, x: row[1], z: row[2], y: row[3], f: row[4], st: row[5] });
    v.hp = row[6];
    this.plates.setHp(`m${v.id}`, v.hp / v.mhp);
  }

  setHp(id: number, hp: number): void {
    const v = this.list.get(id);
    if (!v) return;
    v.hp = Math.max(0, hp);
    this.plates.setHp(`m${id}`, v.hp / v.mhp);
  }

  die(id: number): void {
    const v = this.list.get(id);
    if (!v) return;
    v.dying = 1.2;
    v.atk = null;
    this.plates.remove(`m${id}`);
  }

  /** 서버가 알린 공격 예고: 화면 위치가 지연돼 있으니 그만큼 늦춰 시작 */
  attack(id: number, k: number): void {
    const v = this.list.get(id);
    const a = v?.def.attacks[k];
    if (!v || !a) return;
    v.atk = { k, t0: performance.now() + this.delayMs(), a, reported: false };
  }

  /** 내가 때렸다: 반응을 먼저 계산(서버도 같은 공식으로 계산) */
  predictHit(v: MonView, hit: HitDef, dirX: number, dirZ: number): void {
    if (v.predict <= 0) {
      v.body = newBody(v.pos.x, v.pos.z);
      v.body.y = v.pos.y;
      if (v.pos.y > 0.05) v.body.air = true;
    }
    applyReaction(v.body, hit, dirX, dirZ, v.def.weight, v.def.superArmor);
    v.predict = 0.35;
    v.blend = 0;
    if (!v.def.superArmor) v.atk = null;
    v.model.flash();
  }

  /** 고정 단계: 예측 중인 몬스터의 반응 물리(히트스톱 중에는 멈춤) */
  step(dt: number, zone: ZoneDef, frozen: boolean): void {
    if (frozen) return;
    for (const v of this.list.values()) {
      if (v.predict <= 0) continue;
      stepBody(v.body, dt, zone.walls, zone.size, v.def.radius);
      if (!disabled(v.body)) v.predict -= dt;
    }
  }

  /**
   * 몬스터 공격이 내게 닿는지(보이는 위치 기준). 닿으면 콜백.
   */
  checkAttacks(px: number, pz: number, py: number, invul: boolean, onHurt: (v: MonView, a: MonsterAttackDef) => void): void {
    const now = performance.now();
    for (const v of this.list.values()) {
      const at = v.atk;
      if (!at || at.reported || v.dying) continue;
      const t = (now - at.t0) / 1000;
      if (t > at.a.windup + at.a.active + at.a.recover) {
        v.atk = null;
        continue;
      }
      if (t < at.a.windup || t > at.a.windup + at.a.active || invul) continue;
      if (shapeHits(at.a.shape, v.pos.x, v.pos.z, v.yaw, px, pz, 0.4, py)) {
        at.reported = true;
        onHurt(v, at.a);
      }
    }
  }

  render(renderTime: number, dt: number): void {
    const now = performance.now();
    for (const v of [...this.list.values()]) {
      if (v.dying > 0) {
        v.dying -= dt;
        v.model.root.position.y -= dt * 0.8;
        v.model.root.rotation.x = Math.min(1.4, v.model.root.rotation.x + dt * 3);
        if (v.dying <= 0) this.remove(v.id);
        continue;
      }
      const s = v.buf.sample(renderTime, this.s);
      if (!s) continue;
      const prevX = v.pos.x, prevZ = v.pos.z;
      if (v.predict > 0) {
        v.pos.set(v.body.x, v.body.y, v.body.z);
      } else {
        v.blend = Math.min(1, v.blend + dt * 5);
        const b = v.blend;
        v.pos.set(v.body.x + (s.x - v.body.x) * b, v.body.y + (s.y - v.body.y) * b, v.body.z + (s.z - v.body.z) * b);
        if (b >= 1) v.pos.set(s.x, s.y, s.z);
        v.st = s.st;
        v.yaw = s.f;
      }
      const root = v.model.root;
      root.position.copy(v.pos);
      root.rotation.y = v.yaw;
      const moved = Math.hypot(v.pos.x - prevX, v.pos.z - prevZ) / Math.max(dt, 1e-3);
      v.speed += (Math.min(moved, 10) - v.speed) * Math.min(1, dt * 8);
      let windup = 0, attacking = false;
      if (v.atk) {
        const t = (now - v.atk.t0) / 1000;
        if (t >= 0 && t < v.atk.a.windup) windup = t / v.atk.a.windup;
        else if (t >= v.atk.a.windup && t < v.atk.a.windup + v.atk.a.active) attacking = true;
      }
      const down = v.predict > 0 ? (v.body.down > 0 ? 1 : 0) : v.st === MonState.Down ? 1 : 0;
      const air = v.predict > 0 ? v.body.air : v.st === MonState.Air;
      v.model.animate(dt, v.predict > 0 ? 0 : v.speed, air, down, windup, attacking);
      v.model.telegraph(windup > 0 ? (v.atk!.a.heavy ? '#ff3020' : '#fff4d0') : null, windup);
    }
  }
}
