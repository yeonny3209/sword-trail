import * as THREE from 'three';
import { getData } from '../core/config';
import { damp, lerpAngle, turnTowards } from '../core/math';
import type { CharacterBody, Physics } from '../core/Physics';
import type { Input } from '../input/Input';
import { PlayerVisual } from './PlayerVisual';

export interface PlayerData {
  radius: number;
  height: number;
  color: string;
  moveSpeed: number;
  lockMoveSpeed: number;
  acceleration: number;
  deceleration: number;
  turnSpeed: number;
  spawn: [number, number];
}

/** 플레이어: 카메라 기준 WASD 이동, 이동 방향으로 몸 회전. */
export class Player {
  readonly data = getData<PlayerData>('player');
  readonly visual: PlayerVisual;
  readonly body: CharacterBody;
  readonly pos = new THREE.Vector3();
  readonly prevPos = new THREE.Vector3();
  yaw = 0;
  prevYaw = 0;
  private vel = new THREE.Vector2();

  constructor(scene: THREE.Scene, physics: Physics) {
    const d = this.data;
    this.visual = new PlayerVisual(d.radius, d.height, d.color);
    scene.add(this.visual.root);
    this.body = physics.createCharacter(d.radius, d.height, d.spawn[0], d.spawn[1]);
    this.pos.set(d.spawn[0], 0, d.spawn[1]);
    this.prevPos.copy(this.pos);
  }

  update(dt: number, input: Input, camYaw: number): void {
    this.prevPos.copy(this.pos);
    this.prevYaw = this.yaw;
    const d = this.data;
    const axis = input.moveAxis();
    // 카메라 기준 방향: 앞 = (sin yaw, cos yaw), 오른쪽 = (-cos yaw, sin yaw)
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
    const wantX = (fx * axis.y - fz * axis.x) * d.moveSpeed;
    const wantZ = (fz * axis.y + fx * axis.x) * d.moveSpeed;
    const moving = axis.x !== 0 || axis.y !== 0;
    const k = damp(moving ? d.acceleration / d.moveSpeed : d.deceleration / d.moveSpeed, dt);
    this.vel.x += (wantX - this.vel.x) * k;
    this.vel.y += (wantZ - this.vel.y) * k;
    if (moving) this.yaw = turnTowards(this.yaw, Math.atan2(wantX, wantZ), d.turnSpeed * dt);
    this.body.move(this.vel.x * dt, this.vel.y * dt, dt);
    this.pos.set(this.body.x, this.body.y, this.body.z);
  }

  /** 렌더 보간 */
  render(alpha: number): void {
    this.visual.root.position.lerpVectors(this.prevPos, this.pos, alpha);
    this.visual.root.rotation.y = lerpAngle(this.prevYaw, this.yaw, alpha);
  }
}
