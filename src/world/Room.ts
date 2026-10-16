import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Physics } from '../core/Physics';

export interface SpawnDef { type: string; x: number; z: number }
export interface PillarDef { x: number; z: number; w: number; d: number; h: number }
export interface PropDef { kind: 'bonfire' | 'shrine' | 'rack'; x: number; z: number; label?: string }

export interface RoomDef {
  id: string;
  name: string;
  type: 'camp' | 'combat' | 'elite' | 'rest' | 'boss';
  size: [number, number];
  palette: { floor: string; wall: string; pillar: string; accent?: string };
  playerStart: [number, number, number];
  exit: [number, number];
  pillars: PillarDef[];
  props?: PropDef[];
  dummies?: number[][];
  waves: SpawnDef[][];
}

export interface RoomBuildData { wallHeight: number; wallThickness: number; gateWidth: number }

/** 방 하나의 지형(바닥, 벽, 기둥, 소품, 출구 문). JSON 정의로 만든다. */
export class Room {
  readonly group = new THREE.Group();
  private readonly colliders: RAPIER.Collider[] = [];
  private gateCollider: RAPIER.Collider | null = null;
  private readonly gateMat: THREE.MeshStandardMaterial;
  private readonly gateLight: THREE.PointLight;
  private readonly fires: THREE.PointLight[] = [];
  private time = 0;
  gateOpen = false;

  constructor(private readonly scene: THREE.Scene, private readonly physics: Physics, readonly def: RoomDef, b: RoomBuildData) {
    const [w, d] = def.size;
    const p = def.palette;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color: p.floor, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.01;
    floor.receiveShadow = true;
    this.group.add(floor);

    const wallMat = new THREE.MeshStandardMaterial({ color: p.wall, roughness: 0.95 });
    const t = b.wallThickness, h = b.wallHeight;
    const hw = w / 2, hd = d / 2;
    // 뒤·좌·우 벽
    this.box(0, -hd - t / 2, w + t * 2, t, h, wallMat);
    this.box(-hw - t / 2, 0, t, d, h, wallMat);
    this.box(hw + t / 2, 0, t, d, h, wallMat);
    // 앞 벽: 출구 자리만 비운다
    const gx = def.exit[0], gw = b.gateWidth;
    const leftW = gx - gw / 2 + hw + t, rightW = hw + t - (gx + gw / 2);
    this.box(-hw - t + leftW / 2, hd + t / 2, leftW, t, h, wallMat);
    this.box(hw + t - rightW / 2, hd + t / 2, rightW, t, h, wallMat);

    const pillarMat = new THREE.MeshStandardMaterial({ color: p.pillar, roughness: 0.9 });
    for (const pl of def.pillars) this.box(pl.x, pl.z, pl.w, pl.d, pl.h, pillarMat);

    // 출구 문
    const postMat = new THREE.MeshStandardMaterial({ color: '#2e2b27' });
    for (const s of [-1, 1]) this.box(gx + (s * (gw + 0.6)) / 2, hd + t / 2, 0.6, t + 0.2, h + 0.8, postMat, false);
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(gw + 1.2, 0.5, t + 0.2), postMat);
    lintel.position.set(gx, h + 0.55, hd + t / 2);
    this.group.add(lintel);
    this.gateMat = new THREE.MeshStandardMaterial({
      color: '#000000', emissive: '#a02020', emissiveIntensity: 1, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
    });
    const gate = new THREE.Mesh(new THREE.PlaneGeometry(gw, h), this.gateMat);
    gate.position.set(gx, h / 2, hd + t / 2);
    this.group.add(gate);
    this.gateCollider = physics.addStaticBox(gx, h / 2, hd + t / 2, gw / 2, h / 2, t / 2);
    this.gateLight = new THREE.PointLight('#ff4030', 4, 7);
    this.gateLight.position.set(gx, 1.6, hd - 0.8);
    this.group.add(this.gateLight);

    for (const pr of def.props ?? []) this.prop(pr, p.accent ?? '#e09040');
    scene.add(this.group);
  }

  private box(x: number, z: number, w: number, d: number, h: number, mat: THREE.Material, collide = true): void {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, h / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    this.group.add(m);
    if (collide) this.colliders.push(this.physics.addStaticBox(x, h / 2, z, w / 2, h / 2, d / 2));
  }

  private prop(pr: PropDef, accent: string): void {
    if (pr.kind === 'bonfire') {
      const stones = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.9, 0.3, 10), new THREE.MeshStandardMaterial({ color: '#3a3632' }));
      stones.position.set(pr.x, 0.15, pr.z);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.1, 8), new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 2 }));
      flame.position.set(pr.x, 0.85, pr.z);
      this.group.add(stones, flame);
      const light = new THREE.PointLight(accent, 12, 12);
      light.position.set(pr.x, 1.6, pr.z);
      this.group.add(light);
      this.fires.push(light);
      this.colliders.push(this.physics.addStaticBox(pr.x, 0.5, pr.z, 0.8, 0.5, 0.8));
    } else {
      const color = pr.kind === 'shrine' ? '#8a8f9a' : '#6b4a2e';
      const size: [number, number, number] = pr.kind === 'shrine' ? [1.2, 2.4, 0.6] : [2.0, 1.4, 0.5];
      const m = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial({ color, emissive: pr.kind === 'shrine' ? '#30508a' : '#000', emissiveIntensity: 0.6 }));
      m.position.set(pr.x, size[1] / 2, pr.z);
      m.castShadow = true;
      this.group.add(m);
      this.colliders.push(this.physics.addStaticBox(pr.x, size[1] / 2, pr.z, size[0] / 2, size[1] / 2, size[2] / 2));
    }
  }

  openGate(): void {
    if (this.gateOpen) return;
    this.gateOpen = true;
    if (this.gateCollider) {
      this.physics.removeCollider(this.gateCollider);
      this.gateCollider = null;
    }
    this.gateMat.emissive.set('#40d0ff');
    this.gateMat.opacity = 0.35;
    this.gateLight.color.set('#60d8ff');
  }

  /** 출구 문 앞에 섰는가 */
  atExit(x: number, z: number, radius: number): boolean {
    const [ex, ez] = this.def.exit;
    return this.gateOpen && Math.abs(x - ex) < radius && z > ez - radius - 0.6;
  }

  update(realDt: number): void {
    this.time += realDt;
    for (const f of this.fires) f.intensity = 10 + Math.sin(this.time * 13) * 1.5 + Math.sin(this.time * 7.3) * 1.5;
    this.gateLight.intensity = (this.gateOpen ? 6 : 3) + Math.sin(this.time * 3) * 0.8;
  }

  dispose(): void {
    for (const c of this.colliders) this.physics.removeCollider(c);
    if (this.gateCollider) this.physics.removeCollider(this.gateCollider);
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}
