import * as THREE from 'three';
import { getData } from '../core/config';
import type { QuarterCamera } from '../game/QuarterCamera';
import type { Effects } from './Effects';
import type { BurstSpec, Particles } from './Particles';

/**
 * 내 캐릭터의 움직임 연출: 달릴 때 발밑 먼지, 대시 속도선, 점프 먼지, 착지 충격 고리.
 * 몸이 땅을 딛고 있다는 느낌을 준다.
 */
export class MoveFx {
  private readonly spec = getData<{ particles: { footDust: BurstSpec } }>('fx').particles.footDust;
  private readonly last = new THREE.Vector3();
  private readonly at = new THREE.Vector3();
  private stepT = 0;
  private lineT = 0;
  private wasAir = false;
  private peak = 0;
  private ground = new THREE.Color('#b8a890');
  private init = false;

  constructor(private readonly fx: Effects, private readonly particles: Particles, private readonly cam: QuarterCamera) {}

  /** 지역이 바뀌면 먼지 색을 땅 색에 맞춘다 */
  setGround(color: string): void {
    this.ground.set(color).lerp(new THREE.Color('#ffffff'), 0.25);
  }

  private dust(x: number, z: number, count: number, power = 1): void {
    this.particles.burst(this.at.set(x, 0.08, z), { ...this.spec, color: `#${this.ground.getHexString()}`, count, speed: this.spec.speed * power });
  }

  /** 렌더 프레임마다. p: 내 캐릭터 위치, alive: 쓰러지지 않았는가 */
  update(dt: number, p: THREE.Vector3, alive: boolean): void {
    if (!this.init) {
      this.last.copy(p);
      this.init = true;
    }
    const dx = p.x - this.last.x, dz = p.z - this.last.z;
    const speed = Math.hypot(dx, dz) / Math.max(dt, 1e-3);
    const onGround = p.y < 0.06;
    if (!alive) {
      this.last.copy(p);
      return;
    }
    // 달리기 먼지(빠를수록 자주)
    if (onGround && speed > 3.2 && speed < 40) {
      this.stepT -= dt;
      if (this.stepT <= 0) {
        this.stepT = speed > 9 ? 0.09 : 0.24;
        this.dust(p.x - (dx / (speed * dt)) * 0.3, p.z - (dz / (speed * dt)) * 0.3, speed > 9 ? 6 : 3, speed > 9 ? 1.4 : 1);
      }
    } else this.stepT = 0;
    // 대시·돌진: 뒤로 흩어지는 속도선
    if (onGround && speed > 9.5 && speed < 40) {
      this.lineT -= dt;
      if (this.lineT <= 0) {
        this.lineT = 0.04;
        const yaw = Math.atan2(dx, dz), side = (Math.random() - 0.5) * 1.4;
        const bx = p.x - Math.sin(yaw) * 0.9 + Math.cos(yaw) * side, bz = p.z - Math.cos(yaw) * 0.9 - Math.sin(yaw) * side;
        this.fx.streak(bx, 0.3 + Math.random() * 1.3, bz, yaw + Math.PI, 2.4, 0.05, '#ffffff');
      }
    }
    // 점프·착지
    if (!onGround) this.peak = Math.max(this.peak, p.y);
    if (!this.wasAir && !onGround) this.dust(p.x, p.z, 8, 1.3);
    if (this.wasAir && onGround) {
      const big = this.peak > 1.2;
      this.dust(p.x, p.z, big ? 16 : 8, big ? 2 : 1.3);
      if (big) {
        this.fx.ring(p.x, p.z, 0.8, '#ffffff');
        this.cam.addKick(0, 1, 0.1, 0.01);
      }
      this.peak = 0;
    }
    this.wasAir = !onGround;
    this.last.copy(p);
  }

  /** 몬스터가 땅에 떨어졌다(띄워졌다 착지) */
  land(x: number, z: number, strong: boolean): void {
    this.dust(x, z, strong ? 18 : 10, strong ? 2 : 1.4);
    this.fx.ring(x, z, strong ? 1.2 : 0.7, '#d8d0c0');
  }
}
