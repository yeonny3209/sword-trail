import * as THREE from 'three';
import { getData } from '../core/config';
import { damp } from '../core/math';

interface CamData { fov: number; height: number; back: number; zoomMin: number; zoomMax: number; zoomStep: number; follow: number }

/**
 * 쿼터뷰 카메라: 처음엔 플레이어 남쪽 위에서 비스듬히 내려다본다(화면 위 = 북쪽 = -Z).
 * 마우스 휠로 확대·축소, 오른쪽 드래그로 캐릭터 주위를 돌린다(theta, Home으로 되돌림). 흔들림은 마지막에 더한다.
 */
export class QuarterCamera {
  readonly d = getData<{ camera: CamData }>('client').camera;
  private zoom = 1;
  private targetZoom = 1;
  private readonly focus = new THREE.Vector3();
  /** 카메라가 캐릭터 둘레를 돈 각도: 0 = 남쪽에서 북쪽을 봄 */
  theta = 0;
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

  /** 드래그 거리(px)만큼 돌린다. 오른쪽으로 끌면 장면이 오른쪽으로 돈다 */
  rotateBy(dx: number): void {
    if (dx) this.theta = (this.theta + dx * 0.007) % (Math.PI * 2);
  }

  resetAngle(): void {
    this.theta = 0;
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
    const back = this.d.back * this.zoom;
    c.position.set(this.focus.x + Math.sin(this.theta) * back, this.focus.y + this.d.height * this.zoom, this.focus.z + Math.cos(this.theta) * back);
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
