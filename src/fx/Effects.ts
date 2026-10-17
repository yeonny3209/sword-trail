import * as THREE from 'three';

const Y_AXIS = new THREE.Vector3(0, 1, 0);

interface Fx {
  obj: THREE.Object3D;
  mat: THREE.Material & { opacity: number };
  t: number;
  life: number;
  update: (k: number, fx: Fx) => void;
}

/** 짧게 나타났다 사라지는 연출: 초승달 베기, 충격파 고리, 검기, 섬광 */
export class Effects {
  private readonly list: Fx[] = [];
  private readonly ringGeo = new THREE.RingGeometry(0.85, 1, 40);
  private readonly crescentGeo = new THREE.RingGeometry(1.4, 2.2, 32, 1, -Math.PI * 0.55, Math.PI * 1.1);
  private readonly waveGeo = new THREE.BoxGeometry(1.6, 0.9, 0.5);
  private readonly flashGeo = new THREE.SphereGeometry(1, 12, 8);

  constructor(private readonly scene: THREE.Scene) {}

  private add(obj: THREE.Mesh, life: number, update: Fx['update']): void {
    this.scene.add(obj);
    this.list.push({ obj, mat: obj.material as THREE.MeshBasicMaterial, t: 0, life, update });
  }

  private mat(color: string, opacity = 0.9): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false });
  }

  /** 수평 초승달 베기 자국 */
  crescent(x: number, y: number, z: number, yaw: number, scale = 1, color = '#cfe6ff', tilt = 0): void {
    const m = new THREE.Mesh(this.crescentGeo, this.mat(color));
    m.position.set(x, y, z);
    m.rotation.set(-Math.PI / 2 + tilt, 0, 0, 'YXZ');
    m.rotation.y = yaw;
    this.add(m, 0.2, (k, f) => {
      f.obj.scale.setScalar(scale * (0.8 + k * 0.5));
      f.mat.opacity = 0.9 * (1 - k);
    });
  }

  /** 땅을 퍼지는 충격파 */
  ring(x: number, z: number, scale = 1, color = '#ffe0a0'): void {
    const m = new THREE.Mesh(this.ringGeo, this.mat(color, 0.8));
    m.position.set(x, 0.06, z);
    m.rotation.x = -Math.PI / 2;
    this.add(m, 0.35, (k, f) => {
      f.obj.scale.setScalar(scale * (0.4 + k * 2.6));
      f.mat.opacity = 0.8 * (1 - k);
    });
  }

  /** 앞으로 날아가는 검기(마검사) */
  wave(x: number, z: number, yaw: number, length: number, color = '#b89cff'): void {
    const m = new THREE.Mesh(this.waveGeo, this.mat(color));
    m.rotation.y = yaw;
    const dx = Math.sin(yaw), dz = Math.cos(yaw);
    this.add(m, 0.22, (k, f) => {
      const d = 0.8 + k * length;
      f.obj.position.set(x + dx * d, 1.0, z + dz * d);
      f.obj.scale.set(1 + k, 1, 1);
      f.mat.opacity = 0.9 * (1 - k * k);
    });
  }

  /** 날아가는 화살(가늘고 빠름) */
  arrow(x: number, z: number, yaw: number, length: number, color = '#ffe8b0'): void {
    const m = new THREE.Mesh(this.waveGeo, this.mat(color));
    m.rotation.y = yaw;
    m.scale.set(0.06, 0.06, 1.6);
    const dx = Math.sin(yaw), dz = Math.cos(yaw);
    this.add(m, 0.18, (k, f) => {
      const d = 0.6 + k * length;
      f.obj.position.set(x + dx * d, 1.3, z + dz * d);
      f.mat.opacity = 1 - k * 0.5;
    });
  }

  /** 섬광 구 */
  flash(x: number, y: number, z: number, scale = 1, color = '#ffffff'): void {
    const m = new THREE.Mesh(this.flashGeo, this.mat(color, 0.35));
    m.position.set(x, y, z);
    this.add(m, 0.12, (k, f) => {
      f.obj.scale.setScalar(scale * (0.3 + k * 0.9));
      f.mat.opacity = 0.35 * (1 - k);
    });
  }

  private readonly arcGeos = new Map<string, THREE.RingGeometry>();
  private readonly streakGeo = new THREE.BoxGeometry(1, 1, 1);

  /**
   * 타격 모양대로 휙 베는 자국(부채꼴). 가운데가 정면(yaw)이고 range·width(도)는 판정과 같다.
   * dir: 휘두르는 방향(+1/-1)으로 자국이 쓸고 지나가는 느낌을 준다
   */
  slashArc(x: number, y: number, z: number, yaw: number, range: number, widthDeg: number, color: string, dir = 1, thick = 0.5): void {
    const w = (Math.min(300, Math.max(40, widthDeg)) * Math.PI) / 180;
    const key = `${range.toFixed(1)}:${Math.round(widthDeg / 10)}:${thick}`;
    let geo = this.arcGeos.get(key);
    if (!geo) {
      geo = new THREE.RingGeometry(range * (1 - thick), range, 36, 1, -Math.PI / 2 - w / 2, w);
      this.arcGeos.set(key, geo);
    }
    const m = new THREE.Mesh(geo, this.mat(color, 0.95));
    m.position.set(x, y, z);
    m.rotation.x = -Math.PI / 2;
    const sweep = 0.9 * dir;
    this.add(m, 0.17, (k, f) => {
      const e = 1 - (1 - k) * (1 - k);
      f.obj.rotation.set(0, 0, 0);
      f.obj.rotation.x = -Math.PI / 2;
      f.obj.rotateOnWorldAxis(Y_AXIS, yaw + (e - 0.5) * sweep);
      f.obj.scale.setScalar(0.75 + e * 0.4);
      f.mat.opacity = 0.95 * (1 - k * k);
    });
  }

  /** 앞으로 쭉 뻗는 찌르기 자국(가늘고 긴 빛줄기) */
  streak(x: number, y: number, z: number, yaw: number, length: number, width: number, color: string): void {
    const m = new THREE.Mesh(this.streakGeo, this.mat(color, 0.95));
    m.rotation.y = yaw;
    const dx = Math.sin(yaw), dz = Math.cos(yaw);
    this.add(m, 0.15, (k, f) => {
      const e = 1 - (1 - k) * (1 - k);
      const len = length * (0.3 + e * 0.9);
      f.obj.scale.set(width * (1 - k * 0.6), 0.07 * (1 - k), len);
      f.obj.position.set(x + dx * len * 0.5, y, z + dz * len * 0.5);
      f.mat.opacity = 0.95 * (1 - k);
    });
  }

  /**
   * 맞은 자리의 충격: 하얀 섬광 + 사방으로 뻗는 별빛 줄기(dir 쪽으로 더 길게).
   * size 1 = 보통, 크게 칠수록 크게
   */
  impact(x: number, y: number, z: number, dx: number, dz: number, color: string, size = 1): void {
    const core = new THREE.Mesh(this.flashGeo, this.mat('#ffffff', 0.9));
    core.position.set(x, y, z);
    this.add(core, 0.1, (k, f) => {
      f.obj.scale.setScalar(size * (0.25 + k * 0.5));
      f.mat.opacity = 0.9 * (1 - k);
    });
    const base = Math.atan2(dx, dz);
    const rays = 7 + Math.round(size * 2);
    for (let i = 0; i < rays; i++) {
      const forward = i < 3;
      const yaw = forward ? base + (Math.random() - 0.5) * 0.7 : Math.random() * Math.PI * 2;
      const pitch = (Math.random() - 0.35) * 1.1;
      const len = size * (forward ? 1.9 : 1.1) * (0.6 + Math.random() * 0.7);
      const m = new THREE.Mesh(this.streakGeo, this.mat(i % 3 === 0 ? '#ffffff' : color, 0.95));
      m.position.set(x, y, z);
      m.rotation.set(-pitch, yaw, 0, 'YXZ');
      const fx = Math.sin(yaw) * Math.cos(pitch), fy = Math.sin(pitch), fz = Math.cos(yaw) * Math.cos(pitch);
      this.add(m, 0.14, (k, f) => {
        const e = 1 - (1 - k) * (1 - k);
        const d = len * (0.2 + e * 0.8);
        f.obj.scale.set(0.045 * size * (1 - k), 0.045 * size * (1 - k), d);
        f.obj.position.set(x + fx * d * 0.6, y + fy * d * 0.6, z + fz * d * 0.6);
        f.mat.opacity = 0.95 * (1 - k * k);
      });
    }
  }

  update(dt: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i];
      f.t += dt;
      const k = Math.min(1, f.t / f.life);
      f.update(k, f);
      if (k >= 1) {
        this.scene.remove(f.obj);
        f.mat.dispose();
        this.list.splice(i, 1);
      }
    }
  }
}
