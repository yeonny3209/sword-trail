import * as THREE from 'three';

/** 플레이어 겉모습: 캡슐 몸통 + 방향 표시 코. */
export class PlayerVisual {
  readonly root = new THREE.Group();
  readonly body: THREE.Mesh;
  readonly bodyMat: THREE.MeshStandardMaterial;

  constructor(radius: number, height: number, color: string) {
    this.bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
    this.body = new THREE.Mesh(new THREE.CapsuleGeometry(radius, height - radius * 2, 6, 14), this.bodyMat);
    this.body.position.y = height / 2;
    this.body.castShadow = true;
    const nose = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.12, 0.3),
      new THREE.MeshStandardMaterial({ color: '#2a2a2a' }),
    );
    nose.position.set(0, height * 0.8, radius);
    nose.castShadow = true;
    this.root.add(this.body, nose);
  }
}
