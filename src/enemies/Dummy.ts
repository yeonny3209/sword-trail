import type * as THREE from 'three';
import { bus } from '../core/bus';
import { getData } from '../core/config';
import { Fighter, type SwordSpec } from '../combat/Fighter';
import { FighterView } from '../combat/FighterView';
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
}

/** 훈련용 허수아비 상자. 맞으면 색이 잠깐 바뀐다. */
export class Dummy {
  readonly data = getData<DummyData>('enemies/dummy');
  readonly fighter: Fighter;
  readonly view: FighterView;
  readonly body: CharacterBody;
  private offs: (() => void)[] = [];

  constructor(private readonly scene: THREE.Scene, physics: Physics, x: number, z: number, yaw: number) {
    const d = this.data;
    this.fighter = new Fighter({
      team: 'enemy', name: d.name, radius: d.radius, height: d.height, sword: d.sword,
      hp: d.hp, posture: d.posture, postureRegenDelay: d.postureRegenDelay, postureRegen: d.postureRegen,
    });
    this.fighter.pos.set(x, 0, z);
    this.fighter.yaw = yaw;
    this.fighter.snap();
    this.view = new FighterView(this.fighter, scene, { shape: 'box', color: d.color });
    this.body = physics.createCharacter(d.radius, d.height, x, z);
    this.offs.push(
      bus.on('hit', (e) => {
        if (e.target !== this.fighter) return;
        this.view.tint(d.hitColor, d.hitFlashSeconds);
        // 허수아비는 죽지 않는다
        this.fighter.vitals.hp = this.fighter.vitals.maxHp;
      }),
    );
    bus.emit('fighterSpawned', { fighter: this.fighter });
  }

  update(): void {
    const f = this.fighter;
    f.beginTick();
    f.stateFrame++;
    f.updateSword();
  }

  render(alpha: number, realDt: number): void {
    this.view.render(alpha, realDt);
  }

  dispose(): void {
    this.offs.forEach((o) => o());
    this.view.dispose(this.scene);
    this.body.dispose();
    bus.emit('fighterRemoved', { fighter: this.fighter });
  }
}
