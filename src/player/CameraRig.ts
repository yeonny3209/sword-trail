import * as THREE from 'three';
import { getData } from '../core/config';
import { clamp, damp, lerpAngle, yawTo } from '../core/math';
import type { Physics } from '../core/Physics';

export interface CameraData {
  distance: number;
  pivotHeight: number;
  defaultPitch: number;
  pitchMin: number;
  pitchMax: number;
  followSharpness: number;
  lockPitch: number;
  lockYawSharpness: number;
  lockMaxRange: number;
  lockSwitchFlick: number;
  collisionPadding: number;
  minDistance: number;
}

/**
 * 3인칭 카메라. 플레이어 뒤쪽 위에서 바라보고, 벽에 막히면 앞으로 당긴다.
 * 적 고정 시에는 플레이어와 적의 중간을 바라본다.
 */
export class CameraRig {
  readonly data = getData<{ camera: CameraData }>('player').camera;
  yaw = 0;
  pitch: number;
  private pivot = new THREE.Vector3();
  private dist: number;
  /** 고정 대상 위치(없으면 null) */
  lockPoint: THREE.Vector3 | null = null;

  constructor(private readonly camera: THREE.PerspectiveCamera, private readonly physics: Physics) {
    this.pitch = this.data.defaultPitch;
    this.dist = this.data.distance;
  }

  /** 마우스 회전. 고정 중에는 수평 회전 대신 대상 전환에 쓰이므로 무시 */
  rotate(dx: number, dy: number): void {
    if (!this.lockPoint) this.yaw -= dx;
    this.pitch = clamp(this.pitch + dy, this.data.pitchMin, this.data.pitchMax);
  }

  snapBehind(yaw: number): void {
    this.yaw = yaw;
    this.pitch = this.data.defaultPitch;
  }

  update(target: THREE.Vector3, dt: number): void {
    const d = this.data;
    const want = new THREE.Vector3(target.x, target.y + d.pivotHeight, target.z);
    if (this.lockPoint) {
      const desiredYaw = yawTo(target.x, target.z, this.lockPoint.x, this.lockPoint.z);
      this.yaw = lerpAngle(this.yaw, desiredYaw, damp(d.lockYawSharpness, dt));
      this.pitch += (d.lockPitch - this.pitch) * damp(4, dt);
    }
    this.pivot.lerp(want, damp(d.followSharpness, dt));
    if (this.pivot.distanceToSquared(want) > 25) this.pivot.copy(want);

    // 카메라 방향: yaw 앞쪽의 반대편 위
    const cp = Math.cos(this.pitch);
    const back = new THREE.Vector3(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    let dist = d.distance;
    const hit = this.physics.raycastStatic(this.pivot.x, this.pivot.y, this.pivot.z, back.x, back.y, back.z, d.distance);
    if (hit !== null) dist = Math.max(d.minDistance, hit - d.collisionPadding);
    this.dist = dist < this.dist ? dist : this.dist + (dist - this.dist) * damp(6, dt);

    this.camera.position.copy(this.pivot).addScaledVector(back, this.dist);
    if (this.lockPoint) {
      const mid = new THREE.Vector3().addVectors(this.pivot, this.lockPoint).multiplyScalar(0.5);
      mid.y = this.pivot.y - 0.2;
      this.camera.lookAt(mid);
    } else {
      this.camera.lookAt(this.pivot);
    }
  }
}
