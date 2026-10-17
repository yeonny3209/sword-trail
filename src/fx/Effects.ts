import * as THREE from 'three';

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
