import * as THREE from 'three';
import { getData } from '../core/config';

export interface BurstSpec { count: number; color: string; speed: number; life: number; size: number; gravity: number }

/** 불꽃·섬광 파티클. 고정 크기 풀을 돌려 쓴다(가산 혼합, 어두워지면 사라짐). */
export class Particles {
  private readonly max: number;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly vel: Float32Array;
  private readonly base: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly grav: Float32Array;
  private readonly geo = new THREE.BufferGeometry();
  private readonly points: THREE.Points;
  private next = 0;
  private readonly tmp = new THREE.Color();

  constructor(scene: THREE.Scene) {
    this.max = getData<{ particles: { max: number } }>('fx').particles.max;
    const m = this.max;
    this.pos = new Float32Array(m * 3).fill(-9999);
    this.col = new Float32Array(m * 3);
    this.vel = new Float32Array(m * 3);
    this.base = new Float32Array(m * 3);
    this.life = new Float32Array(m);
    this.maxLife = new Float32Array(m);
    this.grav = new Float32Array(m);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.12, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  burst(at: THREE.Vector3, spec: BurstSpec, dir?: THREE.Vector3): void {
    this.tmp.set(spec.color);
    (this.points.material as THREE.PointsMaterial).size = spec.size;
    for (let n = 0; n < spec.count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      const i3 = i * 3;
      let vx = Math.random() * 2 - 1, vy = Math.random() * 1.6 - 0.3, vz = Math.random() * 2 - 1;
      if (dir) { vx += dir.x * 1.2; vy += dir.y * 1.2; vz += dir.z * 1.2; }
      const len = Math.hypot(vx, vy, vz) || 1;
      const sp = spec.speed * (0.4 + Math.random() * 0.6);
      this.vel[i3] = (vx / len) * sp;
      this.vel[i3 + 1] = (vy / len) * sp;
      this.vel[i3 + 2] = (vz / len) * sp;
      this.pos[i3] = at.x; this.pos[i3 + 1] = at.y; this.pos[i3 + 2] = at.z;
      this.base[i3] = this.tmp.r; this.base[i3 + 1] = this.tmp.g; this.base[i3 + 2] = this.tmp.b;
      this.maxLife[i] = this.life[i] = spec.life * (0.6 + Math.random() * 0.4);
      this.grav[i] = spec.gravity;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      const i3 = i * 3;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[i3 + 1] = -9999;
        this.col[i3] = this.col[i3 + 1] = this.col[i3 + 2] = 0;
        continue;
      }
      this.vel[i3 + 1] -= this.grav[i] * dt;
      const drag = Math.exp(-4 * dt);
      this.vel[i3] *= drag; this.vel[i3 + 2] *= drag;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const k = this.life[i] / this.maxLife[i];
      this.col[i3] = this.base[i3] * k;
      this.col[i3 + 1] = this.base[i3 + 1] * k;
      this.col[i3 + 2] = this.base[i3 + 2] * k;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}
