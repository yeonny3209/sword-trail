import * as THREE from 'three';
import { getData } from '../core/config';
import { damp } from '../core/math';

interface CamData { fov: number; height: number; back: number; zoomMin: number; zoomMax: number; zoomStep: number; follow: number }

/**
 * 쿼터뷰 고정 카메라: 플레이어 남쪽 위에서 비스듬히 내려다본다(화면 위 = 북쪽 = -Z).
 * 마우스 휠로 확대·축소, 흔들림은 마지막에 더한다.
 */
export class QuarterCamera {
  readonly d = getData<{ camera: CamData }>('client').camera;
  private zoom = 1;
  private targetZoom = 1;
  private readonly focus = new THREE.Vector3();
  private shake = 0;
  private shakeT = 0;
  enabledShake = true;

  constructor(readonly camera: THREE.PerspectiveCamera) {
    camera.fov = this.d.fov;
    camera.updateProjectionMatrix();
  }

  zoomBy(steps: number): void {
    this.targetZoom = Math.min(this.d.zoomMax, Math.max(this.d.zoomMin, this.targetZoom + steps * this.d.zoomStep));
  }

  snap(x: number, z: number): void {
    this.focus.set(x, 0, z);
  }

  addShake(amount: number): void {
    if (this.enabledShake) this.shake = Math.min(1, this.shake + amount);
  }

  update(target: THREE.Vector3, dt: number): void {
    this.zoom += (this.targetZoom - this.zoom) * damp(10, dt);
    this.focus.x += (target.x - this.focus.x) * damp(this.d.follow, dt);
    this.focus.z += (target.z - this.focus.z) * damp(this.d.follow, dt);
    this.focus.y = target.y * 0.35;
    const c = this.camera;
    c.position.set(this.focus.x, this.focus.y + this.d.height * this.zoom, this.focus.z + this.d.back * this.zoom);
    c.lookAt(this.focus.x, this.focus.y + 0.8, this.focus.z);
    if (this.shake > 0) {
      this.shakeT += dt * 40;
      const s = this.shake * this.shake * 0.45;
      c.position.x += Math.sin(this.shakeT * 1.3) * s;
      c.position.y += Math.sin(this.shakeT * 1.7 + 1) * s;
      this.shake = Math.max(0, this.shake - dt * 2.8);
    }
  }

  /** 화면 좌표(NDC) → 땅(y=0) 위의 점 */
  groundPoint(ndcX: number, ndcY: number, out: THREE.Vector3): THREE.Vector3 | null {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    return ray.ray.intersectPlane(plane, out);
  }
}
