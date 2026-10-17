import * as THREE from 'three';
import { bus } from '../core/bus';
import { shapeHits } from '../../shared/geom';
import { MoveState, type S2C } from '../../shared/protocol';
import { ACTIONS, CLASS_BY_ID } from '../../shared/data';
import type { ClassId } from '../../shared/types';
import type { HitDef, MonsterAttackDef, ZoneDef } from '../../shared/types';
import type { Effects } from '../fx/Effects';
import type { Particles, BurstSpec } from '../fx/Particles';
import { TrailRibbon } from '../fx/Trails';
import { HitFx } from '../fx/HitFx';
import type { Connection } from '../net/Connection';
import type { DamageNumbers } from '../ui/DamageNumbers';
import type { CharacterModel } from './CharacterModel';
import type { ActionRunner } from './combat/ActionRunner';
import type { LocalPlayer } from './LocalPlayer';
import type { Monsters, MonView } from './Monsters';
import type { QuarterCamera } from './QuarterCamera';
import type { RemotePlayers } from './RemotePlayers';

export interface CombatCtx {
  scene: THREE.Scene;
  net: Connection;
  monsters: Monsters;
  remotes: RemotePlayers;
  cam: QuarterCamera;
  fx: Effects;
  particles: Particles;
  numbers: DamageNumbers;
  bursts: Record<string, BurstSpec>;
  me: () => LocalPlayer | null;
  zone: () => ZoneDef | null;
  /** 같은 편(파티원)이면 결투장에서도 때리지 않는다 */
  ally: (id: number) => boolean;
}

const FX_COLOR: Record<string, string> = { slash: '#cfe6ff', heavy: '#ffd890', pierce: '#e0f4ff', x: '#ff9070', magic: '#c4a0ff' };

/**
 * 전투 화면 처리: 내 행동의 판정 → 즉시 손맛(히트스톱·흔들림·불꽃·소리) → 서버에 보고.
 * 몬스터 공격이 내게 닿는지도 여기서 보고, 서버의 피해·보상 메시지를 화면에 반영한다.
 */
export class CombatClient {
  /** 남은 히트스톱 프레임(내 캐릭터와 내가 때린 몬스터만 멈춘다) */
  hitstop = 0;
  /** 때린 순간 칼날이 번쩍이는 남은 시간 */
  private glowT = 0;
  readonly hitfx: HitFx;
  private readonly trails = new Map<CharacterModel, TrailRibbon[]>();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();

  constructor(private readonly c: CombatCtx) {
    this.hitfx = new HitFx(c.fx, c.particles, c.cam);
    bus.on('net', (m) => this.onNet(m));
    // 다른 플레이어가 휘두를 때도 같은 베기 자국
    c.remotes.onSlash = (r, hit, i) => {
      const p = r.model.root.position;
      this.hitfx.slash(p.x, p.y, p.z, r.model.root.rotation.y, hit, i === 0);
    };
  }

  frozen(): boolean {
    return this.hitstop > 0;
  }

  /** 고정 단계: 히트스톱 감소, 몬스터 공격 판정 */
  step(): void {
    if (this.hitstop > 0) this.hitstop--;
    const me = this.c.me(), zone = this.c.zone();
    if (!me || !zone || me.pstate === 'dead') return;
    this.c.monsters.checkAttacks(me.pos.x, me.pos.z, me.pos.y, me.invulnerable(), (v, atk) => this.onHurt(me, v, atk, zone));
  }

  /** 내 행동의 한 프레임(LocalPlayer가 프레임을 넘기기 직전에 부른다) */
  onPlayerFrame(me: LocalPlayer, run: ActionRunner): void {
    for (const key of run.sfxNow()) bus.emit('sfx', { key });
    const fwd = (d: number) => [me.pos.x + Math.sin(me.yaw) * d, me.pos.z + Math.cos(me.yaw) * d] as const;
    for (const [kind, arg] of run.fxNow()) {
      const color = run.def.cast?.color ?? FX_COLOR[run.def.hits[0]?.fx ?? 'slash'] ?? '#cfe6ff';
      if (kind === 'crescent') {
        const [x, z] = fwd(0.8);
        this.c.fx.crescent(x, me.pos.y + 1.2, z, me.yaw, arg ?? 1, color, -0.9);
      } else if (kind === 'ring') {
        // 아군 대상 스킬은 내 발밑에서 퍼진다
        const off = run.def.cast?.ally ? 0 : (run.def.hits[0]?.shape.offset ?? 1.2);
        const [x, z] = fwd(off);
        this.c.fx.ring(x, z, arg ?? 1, color);
        if (!run.def.cast) this.c.cam.addShake(0.12);
      } else if (kind === 'wave') this.c.fx.wave(me.pos.x, me.pos.z, me.yaw, arg ?? 6, color);
      else if (kind === 'flash') this.c.fx.flash(me.pos.x, me.pos.y + 1, me.pos.z, 2.2, color);
    }
    run.def.hits.forEach((h, i) => {
      if (run.frame === h.f[0]) this.hitfx.slash(me.pos.x, me.pos.y, me.pos.z, me.yaw, h, i === 0);
    });
    for (const hi of run.activeHits()) {
      const hit = run.def.hits[hi];
      for (const v of this.c.monsters.list.values()) {
        if (v.dying || v.hp <= 0 || !run.canHit(hi, `m${v.id}`)) continue;
        if (!shapeHits(hit.shape, me.pos.x, me.pos.z, me.yaw, v.pos.x, v.pos.z, v.def.radius, v.pos.y)) continue;
        run.markHit(hi, `m${v.id}`);
        this.onLocalHit(me, v, hit, hi, run);
      }
      if (this.c.zone()?.pvp) this.pvpHits(me, run, hi, hit);
    }
  }

  /** 결투장: 다른 플레이어를 맞혔는지(보이는 위치 기준) → 서버에 보고 */
  private pvpHits(me: LocalPlayer, run: ActionRunner, hi: number, hit: HitDef): void {
    for (const r of this.c.remotes.list.values()) {
      const p = r.model.root.position;
      if (r.st === MoveState.Dead || r.st === MoveState.Down || r.info.hp <= 0 || this.c.ally(r.info.id) || !run.canHit(hi, `p${r.info.id}`)) continue;
      if (!shapeHits(hit.shape, me.pos.x, me.pos.z, me.yaw, p.x, p.z, 0.45, p.y)) continue;
      run.markHit(hi, `p${r.info.id}`);
      this.c.net.send({ t: 'phit', i: run.instance, h: hi, p: r.info.id });
      this.hitstop = Math.max(this.hitstop, this.hitfx.landed(new THREE.Vector3(p.x, p.y + 1.1, p.z), p.x - me.pos.x, p.z - me.pos.z, hit, 'flesh'));
      r.model.flash(0.14);
      this.c.numbers.hit();
    }
  }

  /** 결투장: 다른 플레이어에게 맞았다는 알림 → 무적이 아니면 반응하고 확인을 보낸다 */
  private onPvpHit(m: Extract<S2C, { t: 'phit' }>): void {
    const me = this.c.me(), zone = this.c.zone();
    const hit = ACTIONS[m.a]?.hits[m.h];
    if (!me || !zone || !hit || me.pstate === 'dead' || me.invulnerable()) return;
    me.hurt(hit, m.x, m.z, zone);
    me.model.flash(0.15);
    this.c.net.send({ t: 'phurt', k: m.k });
    bus.emit('screen', { kind: 'hurt', alpha: 0.6, ms: 450 });
    this.c.cam.addShake(Math.min(0.35, 0.12 + hit.stop * 0.02));
    this.hitstop = Math.max(this.hitstop, 3);
    bus.emit('sfx', { key: 'hurt' });
  }

  private onLocalHit(me: LocalPlayer, v: MonView, hit: HitDef, hi: number, run: ActionRunner): void {
    const dir = hit.shape.type === 'box' ? [Math.sin(me.yaw), Math.cos(me.yaw)] : [v.pos.x - me.pos.x, v.pos.z - me.pos.z];
    this.c.monsters.predictHit(v, hit, dir[0], dir[1]);
    this.c.net.send({ t: 'hit', i: run.instance, h: hi, m: v.id });
    const at = new THREE.Vector3(v.pos.x, v.pos.y + v.def.height * v.def.model.scale * 0.6, v.pos.z);
    this.hitstop = Math.max(this.hitstop, this.hitfx.landed(at, dir[0], dir[1], hit, v.def.hitMat ?? 'flesh'));
    me.model.setGlow('#ffffff', 2.2);
    this.glowT = 0.08;
    this.c.numbers.hit();
  }

  private onHurt(me: LocalPlayer, v: MonView, atk: MonsterAttackDef, zone: ZoneDef): void {
    const hit: HitDef = { f: [0, 0], shape: atk.shape, dmg: atk.dmg, kx: atk.kx, kz: atk.kz, stun: atk.stun, stop: 4 };
    me.hurt(hit, v.pos.x, v.pos.z, zone);
    me.model.flash(0.15);
    this.c.net.send({ t: 'hurt', m: v.id, k: v.atk?.k ?? 0 });
    this.c.cam.addShake(atk.heavy ? 0.6 : 0.3);
    bus.emit('screen', { kind: 'hurt', alpha: atk.heavy ? 0.85 : 0.55, ms: 450 });
    this.c.cam.addKick(me.pos.x - v.pos.x, me.pos.z - v.pos.z, atk.heavy ? 0.45 : 0.22, atk.heavy ? 0.05 : 0.02);
    this.hitstop = Math.max(this.hitstop, atk.heavy ? 7 : 4);
    bus.emit('sfx', { key: 'hurt' });
  }

  private posOf(kind: 'm' | 'p', id: number): THREE.Vector3 | null {
    const me = this.c.me();
    if (kind === 'm') {
      const v = this.c.monsters.list.get(id);
      return v ? new THREE.Vector3(v.pos.x, v.pos.y + v.def.height * v.def.model.scale + 0.3, v.pos.z) : null;
    }
    if (me && me.self.id === id) return me.pos.clone().setY(me.pos.y + 2.1);
    const r = this.c.remotes.list.get(id);
    return r ? r.model.root.position.clone().setY(r.model.root.position.y + 2.1) : null;
  }

  private onNet(m: S2C): void {
    const me = this.c.me();
    switch (m.t) {
      case 'dmg': {
        const pos = this.posOf(m.tk, m.id);
        if (m.dot) {
          // 독 같은 지속 피해: 맞는 연출 없이 작은 숫자만
          const v = this.c.monsters.list.get(m.id);
          if (v) this.c.monsters.setHp(m.id, v.hp - m.n);
          if (pos) this.c.numbers.add(pos, String(m.n), 'dot');
          return;
        }
        if (m.tk === 'm') {
          const v = this.c.monsters.list.get(m.id);
          if (v) this.c.monsters.setHp(m.id, v.hp - m.n);
          if (m.by !== me?.self.id) v?.model.flash();
        }
        if (!pos) return;
        const mine = m.by === me?.self.id && (m.tk === 'm' || !!m.pvp);
        const kind = m.tk === 'p' && !mine ? 'p' : !mine ? 'o' : m.crit ? 'c' : 'n';
        const tag = mine && m.tk === 'm' ? [m.counter ? 'COUNTER' : '', m.back ? 'BACK' : ''].filter(Boolean).join(' ') : '';
        this.c.numbers.add(pos, String(m.n), kind, tag, m.n);
        if (mine && m.tk === 'm' && (m.crit || m.back || m.counter)) {
          const v = this.c.monsters.list.get(m.id);
          if (v) {
            const at = new THREE.Vector3(v.pos.x, v.pos.y + v.def.height * v.def.model.scale * 0.6, v.pos.z);
            const dx = me ? v.pos.x - me.pos.x : 0, dz = me ? v.pos.z - me.pos.z : 1;
            if (m.crit) {
              this.hitfx.crit(at, dx, dz);
              this.hitstop = Math.max(this.hitstop, this.hitfx.juice.critStop);
            } else this.c.fx.ring(at.x, at.z, m.counter ? 1.1 : 0.8, m.counter ? '#ff8a40' : '#8fd8ff');
          }
        }
        break;
      }
      case 'mdie': {
        const v = this.c.monsters.list.get(m.id);
        if (v && !v.dying) {
          const at = new THREE.Vector3(v.pos.x, v.pos.y + v.def.height * v.def.model.scale * 0.55, v.pos.z);
          this.hitstop = Math.max(this.hitstop, this.hitfx.kill(at, !!v.def.boss, m.by === me?.self.id));
          if (m.by === me?.self.id) this.streakCount();
        }
        this.c.monsters.die(m.id);
        break;
      }
      case 'matk':
        this.c.monsters.attack(m.id, m.k);
        break;
      case 'mspawn':
        this.c.monsters.add(m.m, this.c.net.serverNow());
        break;
      case 'reward': {
        if (!me) return;
        const p = me.pos.clone().setY(2.6);
        this.c.numbers.add(p, `+${m.exp} EXP`, 'exp');
        if (m.gold) this.c.numbers.add(p.setY(3.1), `+${m.gold} G`, 'gold');
        bus.emit('sfx', { key: 'pickup', volume: 0.5 });
        break;
      }
      case 'lvup': {
        const pos = this.posOf('p', m.id);
        if (pos) {
          this.c.fx.ring(pos.x, pos.z, 1.6, '#ffe080');
          this.c.fx.flash(pos.x, pos.y - 1, pos.z, 2, '#ffe080');
          this.c.numbers.add(pos, `LEVEL UP! Lv${m.lv}`, 'lvup');
        }
        if (m.id === me?.self.id) bus.emit('sfx', { key: 'gate' });
        break;
      }
      case 'act':
        this.c.remotes.play(m.id, m.a, m.f);
        break;
      case 'phit':
        this.onPvpHit(m);
        break;
      case 'heal': {
        const pos = this.posOf('p', m.id);
        if (pos) this.c.numbers.add(pos, `+${m.n}`, 'heal');
        break;
      }
      case 'cast':
        this.onCast(m);
        break;
    }
  }

  /** 치유·버프·디버프·소생이 닿았다: 대상 발밑에 빛과 입자, 소리 */
  private onCast(m: Extract<S2C, { t: 'cast' }>): void {
    const spark = m.kind === 'debuff' ? 'curseSpark' : m.kind === 'buff' ? 'buffSpark' : 'healSpark';
    const color = m.color ?? (m.kind === 'debuff' ? '#b060e0' : m.kind === 'buff' ? '#ffe080' : '#8fffb0');
    const one = (x: number, y: number, z: number, big = 1) => {
      this.c.fx.ring(x, z, 0.9 * big, color);
      this.c.fx.flash(x, y + 0.6, z, 0.9 * big, color);
      this.c.particles.burst(this.a.set(x, y + 0.2, z), this.c.bursts[spark]);
    };
    for (const id of m.ids) {
      const p = this.posOf('p', id);
      if (p) one(p.x, 0, p.z);
    }
    for (const id of m.mids) {
      const v = this.c.monsters.list.get(id);
      if (v) one(v.pos.x, v.pos.y, v.pos.z, 1.1);
    }
    const me = this.c.me();
    const mine = m.by === me?.self.id || m.ids.includes(me?.self.id ?? -1);
    bus.emit('sfx', { key: m.kind === 'debuff' ? 'curse' : m.kind === 'buff' ? 'buff' : 'heal', volume: mine ? 1 : 0.5 });
    if (m.kind === 'revive') bus.emit('sfx', { key: 'gate', volume: 0.7 });
  }

  /** 렌더 프레임: 검 궤적, 연출, 파티클, 숫자 */
  render(dt: number): void {
    const me = this.c.me();
    if (this.glowT > 0) {
      this.glowT -= dt;
      if (this.glowT <= 0) me?.model.setGlow(null);
    }
    // 검 궤적은 직업 색을 밝게 섞은 색
    if (me) this.trail(me.model, !!me.action?.trailOn(), dt, this.trailColor(me.self.cls));
    for (const r of this.c.remotes.list.values()) this.trail(r.model, !!r.action?.trailOn(), dt, this.trailColor(r.info.cls));
    this.c.fx.update(dt);
    this.c.particles.update(dt);
    this.c.numbers.render(dt);
  }

  private streakN = 0;
  private streakAt = 0;
  private readonly trailColors = new Map<string, string>();

  /** 6초 안에 이어서 잡으면 연속 처치 */
  private streakCount(): void {
    const now = performance.now();
    this.streakN = now - this.streakAt < 6000 ? this.streakN + 1 : 1;
    this.streakAt = now;
    if (this.streakN >= 3) bus.emit('streak', { n: this.streakN });
  }

  private trailColor(cls: ClassId): string {
    let c = this.trailColors.get(cls);
    if (!c) {
      c = `#${new THREE.Color(CLASS_BY_ID[cls].color).lerp(new THREE.Color('#ffffff'), 0.55).getHexString()}`;
      this.trailColors.set(cls, c);
    }
    return c;
  }

  private trail(model: CharacterModel, on: boolean, dt: number, color: string): void {
    let list = this.trails.get(model);
    if (!list) {
      list = model.weaponPivots.map(() => new TrailRibbon(color, 1.35));
      for (const t of list) this.c.scene.add(t.mesh);
      this.trails.set(model, list);
    }
    model.root.updateMatrixWorld(true);
    model.weaponPivots.forEach((_p, i) => {
      model.bladeTips[i].getWorldPosition(this.b);
      model.bladeBases[i].getWorldPosition(this.a);
      list![i].update(dt, on, this.a, this.b);
    });
  }

  /** 모델이 사라질 때 궤적도 지운다 */
  forget(model: CharacterModel): void {
    for (const t of this.trails.get(model) ?? []) {
      this.c.scene.remove(t.mesh);
      t.dispose();
    }
    this.trails.delete(model);
  }
}
