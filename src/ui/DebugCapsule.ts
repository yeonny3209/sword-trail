import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

/** 선분 + 반지름으로 정의된 캡슐을 와이어프레임으로 그린다. */
export class DebugCapsule {
  readonly group = new THREE.Group();
  private readonly mat: THREE.MeshBasicMaterial;
  private readonly cyl: THREE.Mesh;
  private readonly s1: THREE.Mesh;
  private readonly s2: THREE.Mesh;
  private readonly dir = new THREE.Vector3();

  constructor(color: string) {
    this.mat = new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.9, depthTest: false });
    this.cyl = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10, 1, true), this.mat);
    const sg = new THREE.SphereGeometry(1, 10, 6);
    this.s1 = new THREE.Mesh(sg, this.mat);
    this.s2 = new THREE.Mesh(sg, this.mat);
    this.group.add(this.cyl, this.s1, this.s2);
    this.group.renderOrder = 999;
  }

  set(a: THREE.Vector3, b: THREE.Vector3, r: number, color?: string, opacity = 0.9): void {
    if (color) this.mat.color.set(color);
    this.mat.opacity = opacity;
    const len = a.distanceTo(b);
    this.cyl.position.addVectors(a, b).multiplyScalar(0.5);
    this.cyl.scale.set(r, Math.max(len, 0.001), r);
    this.dir.subVectors(b, a);
    if (len > 1e-6) this.cyl.quaternion.setFromUnitVectors(UP, this.dir.normalize());
    this.s1.position.copy(a);
    this.s2.position.copy(b);
    this.s1.scale.setScalar(r);
    this.s2.scale.setScalar(r);
  }

  dispose(): void {
    this.cyl.geometry.dispose();
    this.s1.geometry.dispose();
    this.mat.dispose();
  }
}
