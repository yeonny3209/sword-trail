import * as THREE from 'three';

interface S { a: THREE.Vector3; b: THREE.Vector3; t: number }

const MAX = 48;
const LIFE = 0.13;

/** 검 끝을 따라가는 띠 모양 잔상(가산 혼합). 휘두르는 동안 샘플을 쌓고 시간이 지나면 사라진다 */
export class TrailRibbon {
  readonly mesh: THREE.Mesh;
  private readonly samples: S[] = [];
  private readonly pos = new Float32Array(MAX * 6);
  private readonly col = new Float32Array(MAX * 6);
  private readonly color: THREE.Color;
  private time = 0;

  constructor(color: string, intensity = 1) {
    const idx: number[] = [];
    for (let i = 0; i < MAX - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setIndex(idx);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
    }));
    this.mesh.frustumCulled = false;
    this.color = new THREE.Color(color).multiplyScalar(intensity);
  }

  /** on이면 지금 검 위치(a = 날 중간, b = 끝)를 기록 */
  update(dt: number, on: boolean, a: THREE.Vector3, b: THREE.Vector3): void {
    this.time += dt;
    if (on) {
      this.samples.push({ a: a.clone(), b: b.clone(), t: this.time });
      if (this.samples.length > MAX) this.samples.shift();
    }
    while (this.samples.length && this.time - this.samples[0].t > LIFE) this.samples.shift();
    const n = this.samples.length;
    this.mesh.visible = n >= 2;
    if (n < 2) return;
    for (let i = 0; i < n; i++) {
      const s = this.samples[i];
      const k = Math.max(0, 1 - (this.time - s.t) / LIFE) * (i / n + 0.3);
      const o = i * 6;
      this.pos[o] = s.a.x; this.pos[o + 1] = s.a.y; this.pos[o + 2] = s.a.z;
      this.pos[o + 3] = s.b.x; this.pos[o + 4] = s.b.y; this.pos[o + 5] = s.b.z;
      this.col[o] = this.color.r * k * 0.2; this.col[o + 1] = this.color.g * k * 0.2; this.col[o + 2] = this.color.b * k * 0.2;
      this.col[o + 3] = this.color.r * k; this.col[o + 4] = this.color.g * k; this.col[o + 5] = this.color.b * k;
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.setDrawRange(0, (n - 1) * 6);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
