import * as THREE from 'three';
import type { HitShape } from '../../shared/geom';

const Y = new THREE.Vector3(0, 1, 0);

interface Decal {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  key: string;
}

/**
 * 강한 공격의 범위를 바닥에 붉게 미리 보여 준다(보스·붉은 빛 공격). 시간이 갈수록 진해져서
 * "여기서 비켜야 한다"를 알 수 있다. 몬스터마다 하나씩 쓰고, 공격이 끝나면 숨긴다.
 */
export class Telegraphs {
  private readonly decals = new Map<number, Decal>();
  private readonly geos = new Map<string, THREE.BufferGeometry>();

  constructor(private readonly scene: THREE.Scene) {}

  private geo(s: HitShape): [string, THREE.BufferGeometry] {
    const key = `${s.type}:${s.range.toFixed(1)}:${s.width}`;
    let g = this.geos.get(key);
    if (!g) {
      if (s.type === 'box') {
        g = new THREE.PlaneGeometry(s.width, s.range);
        g.translate(0, -s.range / 2, 0);
      } else if (s.type === 'circle') g = new THREE.CircleGeometry(s.range, 48);
      else {
        const w = (s.width * Math.PI) / 180;
        g = new THREE.CircleGeometry(s.range, 40, -Math.PI / 2 - w / 2, w);
      }
      this.geos.set(key, g);
    }
    return [key, g];
  }

  /** progress 0~1: 공격까지 남은 정도(1에 가까울수록 곧 맞음) */
  show(id: number, s: HitShape, x: number, z: number, yaw: number, progress: number): void {
    const [key, geo] = this.geo(s);
    let d = this.decals.get(id);
    if (d && d.key !== key) {
      this.drop(id);
      d = undefined;
    }
    if (!d) {
      const mat = new THREE.MeshBasicMaterial({ color: '#ff3a24', transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 2;
      this.scene.add(mesh);
      d = { mesh, mat, key };
      this.decals.set(id, d);
    }
    const ox = s.type === 'circle' ? Math.sin(yaw) * (s.offset ?? 0) : 0;
    const oz = s.type === 'circle' ? Math.cos(yaw) * (s.offset ?? 0) : 0;
    d.mesh.position.set(x + ox, 0.07, z + oz);
    d.mesh.rotation.set(-Math.PI / 2, 0, 0);
    if (s.type !== 'circle') d.mesh.rotateOnWorldAxis(Y, yaw);
    // 점점 진해지고 맞기 직전 깜빡임
    const blink = progress > 0.8 ? 0.12 * Math.sin(progress * 60) : 0;
    d.mat.opacity = 0.16 + progress * 0.42 + blink;
  }

  hide(id: number): void {
    this.drop(id);
  }

  private drop(id: number): void {
    const d = this.decals.get(id);
    if (!d) return;
    this.scene.remove(d.mesh);
    d.mat.dispose();
    this.decals.delete(id);
  }
}
