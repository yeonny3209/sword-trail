import * as THREE from 'three';
import { getData } from '../core/config';
import { lerpAngle } from '../core/math';
import type { Fighter } from './Fighter';
import type { Glow } from './types';

export interface ViewOptions {
  shape: 'capsule' | 'box';
  color: string;
  swordColor?: string;
  /** 검 두께 배율(창·대검 등) */
  swordWidth?: number;
  scale?: number;
}

/** Fighter의 겉모습: 몸통(캡슐/상자) + 방향 표시 + 검. 렌더 프레임마다 보간해서 그린다. */
export class FighterView {
  readonly root = new THREE.Group();
  readonly body: THREE.Mesh;
  readonly bodyMat: THREE.MeshStandardMaterial;
  readonly sword: THREE.Mesh;
  readonly swordMat: THREE.MeshStandardMaterial;
  private readonly baseColor: THREE.Color;
  private tintColor = new THREE.Color();
  private tintTime = 0;
  private tintDuration = 0;
  private readonly glowColors: Record<Glow, string>;
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  /** 몸통 흔들림(피격 반응) */
  shakeX = 0;
  sink = 0;

  constructor(private readonly fighter: Fighter, scene: THREE.Scene, o: ViewOptions) {
    this.glowColors = getData<{ glowColors: Record<Glow, string> }>('combat').glowColors;
    const r = fighter.radius, h = fighter.height;
    this.baseColor = new THREE.Color(o.color);
    this.bodyMat = new THREE.MeshStandardMaterial({ color: o.color, roughness: 0.7 });
    const geo = o.shape === 'capsule'
      ? new THREE.CapsuleGeometry(r, h - r * 2, 6, 14)
      : new THREE.BoxGeometry(r * 2, h, r * 2);
    this.body = new THREE.Mesh(geo, this.bodyMat);
    this.body.position.y = h / 2;
    this.body.castShadow = true;
    const nose = new THREE.Mesh(
      new THREE.BoxGeometry(r * 0.45, 0.12, r * 0.6),
      new THREE.MeshStandardMaterial({ color: '#222222' }),
    );
    nose.position.set(0, h * 0.82, r * 0.85);
    this.root.add(this.body, nose);
    this.root.userData.nose = nose;

    const w = o.swordWidth ?? 1;
    this.swordMat = new THREE.MeshStandardMaterial({
      color: o.swordColor ?? '#c9ced6', metalness: 0.6, roughness: 0.3, emissive: '#000000',
    });
    this.sword = new THREE.Mesh(new THREE.BoxGeometry(0.035 * w, 1, 0.09 * w), this.swordMat);
    this.sword.castShadow = true;
    scene.add(this.root, this.sword);
  }

  /** 잠깐 색을 바꾼다(피격 표시 등) */
  tint(color: string, seconds: number): void {
    this.tintColor.set(color);
    this.tintTime = seconds;
    this.tintDuration = seconds;
  }

  setGlow(glow: Glow | null, strength = 1): void {
    if (glow) {
      this.swordMat.emissive.set(this.glowColors[glow]);
      this.swordMat.emissiveIntensity = 1.5 * strength;
    } else {
      this.swordMat.emissive.set('#000000');
    }
  }

  render(alpha: number, realDt: number): void {
    const f = this.fighter;
    this.root.position.lerpVectors(f.prevPos, f.pos, alpha);
    this.root.position.y -= this.sink;
    this.root.rotation.y = lerpAngle(f.prevYaw, f.yaw, alpha);
    this.body.position.x = this.shakeX;

    this.a.lerpVectors(f.prevSeg.a, f.seg.a, alpha);
    this.b.lerpVectors(f.prevSeg.b, f.seg.b, alpha);
    this.a.y -= this.sink;
    this.b.y -= this.sink;
    const len = this.a.distanceTo(this.b);
    this.sword.position.addVectors(this.a, this.b).multiplyScalar(0.5);
    this.sword.scale.set(1, len, 1);
    const dir = this.b.clone().sub(this.a).normalize();
    this.sword.quaternion.setFromUnitVectors(this.up, dir);

    if (this.tintTime > 0) {
      this.tintTime = Math.max(0, this.tintTime - realDt);
      const t = this.tintTime / this.tintDuration;
      this.bodyMat.color.copy(this.baseColor).lerp(this.tintColor, t);
    } else {
      this.bodyMat.color.copy(this.baseColor);
    }
  }

  setVisible(v: boolean): void {
    this.root.visible = v;
    this.sword.visible = v;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.root, this.sword);
    this.body.geometry.dispose();
    this.sword.geometry.dispose();
  }
}
