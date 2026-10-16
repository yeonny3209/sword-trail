import type * as THREE from 'three';
import { bus } from '../core/bus';
import { getData } from '../core/config';
import { AttackRunner } from '../combat/AttackRunner';
import { Fighter, type SwordSpec } from '../combat/Fighter';
import { FighterView } from '../combat/FighterView';
import type { AttackData } from '../combat/types';
import type { Physics, CharacterBody } from '../core/Physics';

interface DummyData {
  name: string;
  radius: number;
  height: number;
  color: string;
  hitColor: string;
  hitFlashSeconds: number;
  hp: number;
  posture: number;
  postureRegenDelay: number;
  postureRegen: number;
  sword: SwordSpec;
  attackInterval: number;
  attack: AttackData;
}

/** 훈련용 허수아비 상자. 맞으면 색이 잠깐 바뀌고, 일정 간격으로 앞을 내려친다. */
export class Dummy {
  readonly data = getData<DummyData>('enemies/dummy');
  readonly fighter: Fighter;
  readonly view: FighterView;
  readonly body: CharacterBody;
  private timer = 0;
  private offs: (() => void)[] = [];

  constructor(private readonly scene: THREE.Scene, physics: Physics, x: number, z: number, yaw: number) {
    const d = this.data;
    this.fighter = new Fighter({
      team: 'enemy', name: d.name, kind: 'dummy', radius: d.radius, height: d.height, sword: d.sword,
      hp: d.hp, posture: d.posture, postureRegenDelay: d.postureRegenDelay, postureRegen: d.postureRegen,
    });
    this.fighter.pos.set(x, 0, z);
    this.fighter.yaw = yaw;
    this.fighter.snap();
    this.view = new FighterView(this.fighter, scene, { shape: 'box', color: d.color });
    this.body = physics.createCharacter(d.radius, d.height, x, z);
    const me = this.fighter;
    this.offs.push(
      bus.on('hit', (e) => {
        if (e.target !== me) return;
        this.view.tint(d.hitColor, d.hitFlashSeconds);
        // 허수아비는 죽지 않는다
        me.vitals.hp = me.vitals.maxHp;
      }),
      bus.on('parrySuccess', (e) => {
        if (e.attacker !== me) return;
        me.attack = null;
        this.timer = 0;
      }),
      bus.on('postureBreak', (e) => {
        if (e.fighter === me) this.timer = 0;
      }),
    );
    bus.emit('fighterSpawned', { fighter: me });
  }

  update(): void {
    const f = this.fighter;
    f.beginTick();
    f.stateFrame++;
    if (f.isBroken()) {
      if (f.stateName !== 'broken') f.setState('broken');
    } else if (f.attack) {
      f.attack.tick();
      if (f.attack.done()) {
        f.attack = null;
        f.setState('idle');
      }
    } else {
      if (f.stateName !== 'idle') f.setState('idle');
      this.timer += 1 / 60;
      if (this.timer >= this.data.attackInterval) {
        this.timer = 0;
        f.attack = new AttackRunner(f, this.data.attack);
        f.setState('attack');
        bus.emit('attackStarted', { fighter: f, attack: this.data.attack });
      }
    }
    f.updateSword();
  }

  render(alpha: number, realDt: number): void {
    const run = this.fighter.attack;
    this.view.setGlow(run && run.phase() === 'startup' ? run.data.glow ?? null : null);
    this.view.body.rotation.x = this.fighter.isBroken() ? -0.25 : 0;
    this.view.render(alpha, realDt);
  }

  dispose(): void {
    this.offs.forEach((o) => o());
    this.view.dispose(this.scene);
    this.body.dispose();
    bus.emit('fighterRemoved', { fighter: this.fighter });
  }
}
