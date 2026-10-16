import RAPIER from '@dimforge/rapier3d-compat';

/** 충돌 그룹: 정적 지형과 캐릭터를 나눠서 카메라 광선은 지형만 맞게 한다. */
const GROUP_STATIC = 0x0001;
const GROUP_CHAR = 0x0002;
const groups = (member: number, filter: number) => (member << 16) | filter;

export class Physics {
  world!: RAPIER.World;
  private statics: RAPIER.Collider[] = [];

  async init(): Promise<void> {
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  }

  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step();
  }

  /** 정적 상자(바닥, 벽, 기둥). 중심 좌표와 절반 크기. */
  addStaticBox(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
      .setTranslation(cx, cy, cz)
      .setCollisionGroups(groups(GROUP_STATIC, 0xffff));
    const c = this.world.createCollider(desc);
    this.statics.push(c);
    return c;
  }

  clearStatics(): void {
    for (const c of this.statics) this.world.removeCollider(c, false);
    this.statics = [];
  }

  createCharacter(radius: number, height: number, x: number, z: number): CharacterBody {
    return new CharacterBody(this.world, radius, height, x, z);
  }

  /** 지형에만 닿는 광선. 맞은 거리(없으면 null) */
  raycastStatic(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): number | null {
    const ray = new RAPIER.Ray({ x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz });
    const hit = this.world.castRay(ray, maxDist, true, undefined, groups(0xffff, GROUP_STATIC));
    if (!hit) return null;
    const h = hit as unknown as { timeOfImpact?: number; toi?: number };
    return h.timeOfImpact ?? h.toi ?? null;
  }
}

/** 키네마틱 캐릭터. 위치는 발 기준(y=0이 바닥). */
export class CharacterBody {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly centerOffset: number;
  private vy = 0;
  grounded = true;
  x: number;
  y = 0;
  z: number;

  constructor(private readonly world: RAPIER.World, radius: number, height: number, x: number, z: number) {
    const half = Math.max(0.01, height / 2 - radius);
    this.centerOffset = half + radius;
    this.x = x;
    this.z = z;
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, this.centerOffset + 0.01, z),
    );
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(half, radius).setCollisionGroups(groups(GROUP_CHAR, 0xffff)),
      this.body,
    );
    this.controller = world.createCharacterController(0.02);
    this.controller.enableSnapToGround(0.3);
    this.controller.setApplyImpulsesToDynamicBodies(false);
  }

  /** 수평 이동량(m)을 주면 충돌을 고려해 이동한다. */
  move(dx: number, dz: number, dt: number): void {
    this.vy = this.grounded ? -1 : this.vy - 20 * dt;
    this.controller.computeColliderMovement(this.collider, { x: dx, y: this.vy * dt, z: dz });
    const m = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();
    const t = this.body.translation();
    const nx = t.x + m.x;
    const ny = Math.max(this.centerOffset, t.y + m.y);
    const nz = t.z + m.z;
    this.body.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
    this.x = nx;
    this.y = ny - this.centerOffset;
    this.z = nz;
  }

  teleport(x: number, z: number): void {
    this.body.setTranslation({ x, y: this.centerOffset + 0.01, z }, true);
    this.body.setNextKinematicTranslation({ x, y: this.centerOffset + 0.01, z });
    this.x = x;
    this.z = z;
    this.y = 0;
    this.vy = 0;
  }

  dispose(): void {
    this.world.removeCharacterController(this.controller);
    this.world.removeRigidBody(this.body);
  }
}
