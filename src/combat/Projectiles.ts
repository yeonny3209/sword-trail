import * as THREE from 'three';
import { bus } from '../core/bus';
import type { Physics } from '../core/Physics';
import type { ProjectileSpec } from '../enemies/types';
import type { Fighter } from './Fighter';
import type { AttackData, HitSource, Segment } from './types';

const UP = new THREE.Vector3(0, 1, 0);

/** 화살 같은 투사체. 검과 같은 HitSource로 판정된다. */
class Projectile implements HitSource {
  readonly hitList = new Set<number>();
  readonly prevSeg: Segment = { a: new THREE.Vector3(), b: new THREE.Vector3() };
  readonly seg: Segment = { a: new THREE.Vector3(), b: new THREE.Vector3() };
  readonly radius: number;
  readonly consumeOnContact = true;
  consumed = false;
  readonly mesh: THREE.Mesh;
  private readonly pos: THREE.Vector3;
  private readonly prevPos = new THREE.Vector3();
  private readonly dir: THREE.Vector3;
  private age = 0;

  constructor(readonly owner: Fighter, readonly data: AttackData, private readonly spec: ProjectileSpec, x: number, y: number, z: number, dir: THREE.Vector3, geo: THREE.BufferGeometry) {
    this.radius = spec.radius;
    this.pos = new THREE.Vector3(x, y, z);
    this.prevPos.copy(this.pos);
    this.dir = dir.clone().normalize();
    this.mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: spec.color, emissive: spec.color, emissiveIntensity: 0.4 }));
    this.mesh.scale.set(1, spec.length, 1);
    this.mesh.quaternion.setFromUnitVectors(UP, this.dir);
    this.updateSeg();
    this.prevSeg.a.copy(this.seg.a);
    this.prevSeg.b.copy(this.seg.b);
  }

  origin(): THREE.Vector3 {
    return this.pos;
  }

  isActive(): boolean {
    return !this.consumed && this.age < this.spec.life;
  }

  private updateSeg(): void {
    this.seg.a.copy(this.pos).addScaledVector(this.dir, -this.spec.length / 2);
    this.seg.b.copy(this.pos).addScaledVector(this.dir, this.spec.length / 2);
  }

  tick(dt: number, physics: Physics): void {
    this.prevSeg.a.copy(this.seg.a);
    this.prevSeg.b.copy(this.seg.b);
    this.prevPos.copy(this.pos);
    this.age += dt;
    const step = this.spec.speed * dt;
    // 벽·기둥에 막히면 사라진다
    const hit = physics.raycastStatic(this.pos.x, this.pos.y, this.pos.z, this.dir.x, this.dir.y, this.dir.z, step + this.spec.length / 2);
    if (hit !== null) this.consumed = true;
    this.pos.addScaledVector(this.dir, step);
    this.updateSeg();
  }

  render(alpha: number): void {
    this.mesh.position.lerpVectors(this.prevPos, this.pos, alpha);
  }
}

/** 투사체 생성·이동·제거. 'fireProjectile' 이벤트로 만든다. */
export class Projectiles {
  readonly list: Projectile[] = [];
  private readonly geo = new THREE.CylinderGeometry(0.025, 0.025, 1, 6);

  constructor(private readonly scene: THREE.Scene, private readonly physics: Physics) {
    bus.on('fireProjectile', (e) => {
      const p = new Projectile(e.owner, e.attack, e.spec, e.x, e.y, e.z, new THREE.Vector3(e.dx, e.dy, e.dz), this.geo);
      this.list.push(p);
      this.scene.add(p.mesh);
      bus.emit('sfx', { key: 'swing', volume: 0.5 });
    });
    bus.on('clearEnemies', () => this.clear());
  }

  update(dt: number): void {
    for (const p of this.list) p.tick(dt, this.physics);
  }

  /** 판정 후: 소멸한 투사체 제거 */
  sweep(): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      if (!p.isActive()) {
        this.scene.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
        this.list.splice(i, 1);
      }
    }
  }

  render(alpha: number): void {
    for (const p of this.list) p.render(alpha);
  }

  clear(): void {
    for (const p of this.list) {
      this.scene.remove(p.mesh);
      (p.mesh.material as THREE.Material).dispose();
    }
    this.list.length = 0;
  }
}
