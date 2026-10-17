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
  /** 내려다보는 각도(라디안): 클수록 위에서 곧장 내려다봄, 작을수록 옆에서 봄 */
  pitch: number;
  private readonly pitch0: number;
  private readonly dist: number;
  private shake = 0;
  private shakeT = 0;
  /** 맞은 방향으로 밀렸다 돌아오는 반동(세계 좌표)과 줌 펀치(확 당겨졌다 돌아옴) */
  private readonly kick = new THREE.Vector3();
  private punch = 0;
  enabledShake = true;

  constructor(readonly camera: THREE.PerspectiveCamera) {
    this.pitch = this.pitch0 = Math.atan2(this.d.height, this.d.back);
    this.dist = Math.hypot(this.d.height, this.d.back);
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

  /** 세로 드래그: 아래로 끌면 더 위에서(내려다봄), 위로 끌면 더 옆에서 본다 */
  tiltBy(dy: number): void {
    if (dy) this.pitch = Math.min(1.45, Math.max(0.35, this.pitch + dy * 0.005));
  }

  resetAngle(): void {
    this.theta = 0;
    this.pitch = this.pitch0;
  }

  snap(x: number, z: number): void {
    this.focus.set(x, 0, z);
  }

  addShake(amount: number): void {
    if (this.enabledShake) this.shake = Math.min(1, this.shake + amount);
  }

  /** 타격 반동: (dx, dz) 방향으로 amount(m)만큼 밀리고 zoom만큼 당겨졌다가 돌아온다 */
  addKick(dx: number, dz: number, amount: number, zoom = 0): void {
    if (!this.enabledShake) return;
    const l = Math.hypot(dx, dz) || 1;
    this.kick.x += (dx / l) * amount;
    this.kick.z += (dz / l) * amount;
    this.punch = Math.min(0.14, this.punch + zoom);
  }

  update(target: THREE.Vector3, dt: number): void {
    this.zoom += (this.targetZoom - this.zoom) * damp(10, dt);
    this.focus.x += (target.x - this.focus.x) * damp(this.d.follow, dt);
    this.focus.z += (target.z - this.focus.z) * damp(this.d.follow, dt);
    this.focus.y = target.y * 0.35;
    const c = this.camera;
    const zk = this.zoom * (1 - this.punch);
    const back = Math.cos(this.pitch) * this.dist * zk;
    c.position.set(this.focus.x + Math.sin(this.theta) * back + this.kick.x, this.focus.y + Math.sin(this.pitch) * this.dist * zk, this.focus.z + Math.cos(this.theta) * back + this.kick.z);
    const decay = Math.exp(-14 * dt);
    this.kick.multiplyScalar(decay);
    this.punch *= Math.exp(-12 * dt);
    c.lookAt(this.focus.x, this.focus.y + 0.8, this.focus.z);
    if (this.shake > 0) {
      this.shakeT += dt * 40;
      const s = this.shake * 0.55;
      c.position.x += Math.sin(this.shakeT * 1.3) * s;
      c.position.y += Math.sin(this.shakeT * 1.7 + 1) * s;
      c.position.z += Math.sin(this.shakeT * 1.1 + 2) * s * 0.6;
      this.shake = Math.max(0, this.shake - dt * 3.4);
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
