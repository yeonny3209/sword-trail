import * as THREE from 'three';
import { bus } from '../core/bus';
import { getData } from '../core/config';
import type { Fighter } from '../combat/Fighter';

interface TrailData { seconds: number; maxSamples: number; color: string; enemyColor: string; intensity: number; from: number }

interface Sample { a: THREE.Vector3; b: THREE.Vector3; t: number }

/** 검 하나의 리본 궤적. 판정 구간 동안 검 끝 위치 이력을 띠 모양 메시로 그린다. */
class Ribbon {
  readonly mesh: THREE.Mesh;
  private readonly samples: Sample[] = [];
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly color: THREE.Color;

  constructor(private readonly fighter: Fighter, private readonly d: TrailData) {
    const n = d.maxSamples;
    this.pos = new Float32Array(n * 2 * 3);
    this.col = new Float32Array(n * 2 * 3);
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, e = a + 3;
      idx.push(a, b, c, b, e, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setIndex(idx);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide, depthWrite: false,
    }));
    this.mesh.frustumCulled = false;
    this.color = new THREE.Color(fighter.team === 'player' ? d.color : d.enemyColor).multiplyScalar(d.intensity);
  }

  update(alpha: number, now: number): void {
    const f = this.fighter;
    if (f.alive && f.attack?.isActive()) {
      const a = new THREE.Vector3().lerpVectors(f.prevSeg.a, f.seg.a, alpha);
      const b = new THREE.Vector3().lerpVectors(f.prevSeg.b, f.seg.b, alpha);
      a.lerp(b, this.d.from);
      this.samples.push({ a, b, t: now });
      if (this.samples.length > this.d.maxSamples) this.samples.shift();
    }
    while (this.samples.length && now - this.samples[0].t > this.d.seconds) this.samples.shift();

    const n = this.samples.length;
    this.mesh.visible = n >= 2;
    if (n < 2) return;
    for (let i = 0; i < n; i++) {
      const s = this.samples[i];
      const k = 1 - (now - s.t) / this.d.seconds;
      const o = i * 6;
      this.pos[o] = s.a.x; this.pos[o + 1] = s.a.y; this.pos[o + 2] = s.a.z;
      this.pos[o + 3] = s.b.x; this.pos[o + 4] = s.b.y; this.pos[o + 5] = s.b.z;
      // 안쪽 가장자리는 흐리게, 바깥(검 끝)은 밝게
      this.col[o] = this.color.r * k * 0.25; this.col[o + 1] = this.color.g * k * 0.25; this.col[o + 2] = this.color.b * k * 0.25;
      this.col[o + 3] = this.color.r * k; this.col[o + 4] = this.color.g * k; this.col[o + 5] = this.color.b * k;
    }
    const geo = this.mesh.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.setDrawRange(0, (n - 1) * 6);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/** 모든 전투 참가자의 검 궤적 관리 */
export class SwordTrails {
  private readonly d = getData<{ trail: TrailData }>('fx').trail;
  private readonly ribbons = new Map<number, Ribbon>();
  private time = 0;

  constructor(private readonly scene: THREE.Scene) {
    bus.on('fighterSpawned', ({ fighter }) => {
      const r = new Ribbon(fighter, this.d);
      this.ribbons.set(fighter.id, r);
      scene.add(r.mesh);
    });
    bus.on('fighterRemoved', ({ fighter }) => {
      const r = this.ribbons.get(fighter.id);
      if (!r) return;
      this.scene.remove(r.mesh);
      r.dispose();
      this.ribbons.delete(fighter.id);
    });
  }

  /** frozen: 히트스톱 중에는 궤적도 멈춘다 */
  update(alpha: number, realDt: number, frozen: boolean): void {
    if (!frozen) this.time += realDt;
    for (const r of this.ribbons.values()) r.update(alpha, this.time);
  }
}
