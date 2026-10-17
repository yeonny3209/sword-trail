import * as THREE from 'three';
import { getData } from '../core/config';

export interface BurstSpec {
  count: number;
  color: string;
  speed: number;
  life: number;
  size: number;
  gravity: number;
  /** 바닥에 닿으면 튕김(0~1) */
  bounce?: number;
}

const VERT = `
attribute float size;
attribute vec3 color;
varying vec3 vColor;
uniform float uScale;
void main() {
  vColor = color;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = `
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = pow(1.0 - d, 1.6);
  gl_FragColor = vec4(vColor * (0.6 + a), a);
}`;

/** 불꽃·섬광 파티클. 고정 크기 풀을 돌려 쓴다(가산 혼합). 입자마다 크기가 있고 시간이 지나면 작아지며 사라진다 */
export class Particles {
  private readonly max: number;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly vel: Float32Array;
  private readonly base: Float32Array;
  private readonly baseSize: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly grav: Float32Array;
  private readonly bounce: Float32Array;
  private readonly geo = new THREE.BufferGeometry();
  private readonly points: THREE.Points;
  private readonly mat: THREE.ShaderMaterial;
  private next = 0;
  private readonly tmp = new THREE.Color();

  constructor(scene: THREE.Scene) {
    this.max = getData<{ particles: { max: number } }>('fx').particles.max;
    const m = this.max;
    this.pos = new Float32Array(m * 3).fill(-9999);
    this.col = new Float32Array(m * 3);
    this.size = new Float32Array(m);
    this.vel = new Float32Array(m * 3);
    this.base = new Float32Array(m * 3);
    this.baseSize = new Float32Array(m);
    this.life = new Float32Array(m);
    this.maxLife = new Float32Array(m);
    this.grav = new Float32Array(m);
    this.bounce = new Float32Array(m);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: { uScale: { value: 800 } },
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  /** 화면 크기가 바뀌면: 월드 크기 → 화면 픽셀 환산 */
  resize(heightPx: number, fovDeg: number, pixelRatio: number): void {
    this.mat.uniforms.uScale.value = (heightPx * pixelRatio * 0.5) / Math.tan((fovDeg * Math.PI) / 360);
  }

  burst(at: THREE.Vector3, spec: BurstSpec, dir?: THREE.Vector3): void {
    this.tmp.set(spec.color);
    for (let n = 0; n < spec.count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      const i3 = i * 3;
      let vx = Math.random() * 2 - 1, vy = Math.random() * 1.6 - 0.3, vz = Math.random() * 2 - 1;
      if (dir) { vx += dir.x * 1.6; vy += dir.y * 1.2; vz += dir.z * 1.6; }
      const len = Math.hypot(vx, vy, vz) || 1;
      const sp = spec.speed * (0.35 + Math.random() * 0.65);
      this.vel[i3] = (vx / len) * sp;
      this.vel[i3 + 1] = (vy / len) * sp;
      this.vel[i3 + 2] = (vz / len) * sp;
      this.pos[i3] = at.x; this.pos[i3 + 1] = at.y; this.pos[i3 + 2] = at.z;
      this.base[i3] = this.tmp.r; this.base[i3 + 1] = this.tmp.g; this.base[i3 + 2] = this.tmp.b;
      this.baseSize[i] = spec.size * (0.5 + Math.random() * 0.8);
      this.maxLife[i] = this.life[i] = spec.life * (0.6 + Math.random() * 0.4);
      this.grav[i] = spec.gravity;
      this.bounce[i] = spec.bounce ?? 0;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      const i3 = i * 3;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[i3 + 1] = -9999;
        this.size[i] = 0;
        continue;
      }
      this.vel[i3 + 1] -= this.grav[i] * dt;
      const drag = Math.exp(-3 * dt);
      this.vel[i3] *= drag; this.vel[i3 + 2] *= drag;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.pos[i3 + 1] < 0.03 && this.vel[i3 + 1] < 0) {
        this.pos[i3 + 1] = 0.03;
        this.vel[i3 + 1] *= -this.bounce[i];
        this.vel[i3] *= 0.6; this.vel[i3 + 2] *= 0.6;
      }
      const k = this.life[i] / this.maxLife[i];
      this.col[i3] = this.base[i3] * k;
      this.col[i3 + 1] = this.base[i3 + 1] * k;
      this.col[i3 + 2] = this.base[i3 + 2] * k;
      this.size[i] = this.baseSize[i] * (0.35 + 0.65 * k);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
  }
}
