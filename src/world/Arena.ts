import * as THREE from 'three';
import { getData } from '../core/config';
import type { Physics } from '../core/Physics';

interface WorldData {
  background: string;
  fog: { near: number; far: number };
  floor: { size: number; color: string };
  ambient: { color: string; intensity: number };
  sun: { color: string; intensity: number; position: [number, number, number]; shadowMapSize: number; shadowExtent: number };
}

/** 바닥과 조명. 방이 바뀌어도 유지되는 기본 환경. */
export class Arena {
  readonly sun: THREE.DirectionalLight;

  constructor(scene: THREE.Scene, physics: Physics) {
    const d = getData<WorldData>('world');
    scene.background = new THREE.Color(d.background);
    scene.fog = new THREE.Fog(d.background, d.fog.near, d.fog.far);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(d.floor.size, d.floor.size),
      new THREE.MeshStandardMaterial({ color: d.floor.color, roughness: 0.95 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    const grid = new THREE.GridHelper(d.floor.size, d.floor.size / 2, 0x555555, 0x666666);
    grid.position.y = 0.005;
    scene.add(grid);
    physics.addStaticBox(0, -0.5, 0, d.floor.size / 2, 0.5, d.floor.size / 2);

    scene.add(new THREE.AmbientLight(d.ambient.color, d.ambient.intensity));
    const sun = new THREE.DirectionalLight(d.sun.color, d.sun.intensity);
    sun.position.set(...d.sun.position);
    sun.castShadow = true;
    sun.shadow.mapSize.set(d.sun.shadowMapSize, d.sun.shadowMapSize);
    const e = d.sun.shadowExtent;
    Object.assign(sun.shadow.camera, { left: -e, right: e, top: e, bottom: -e, near: 1, far: 80 });
    sun.shadow.bias = -0.0005;
    scene.add(sun, sun.target);
    this.sun = sun;
  }

  /** 그림자 범위를 플레이어 주변으로 옮긴다. */
  follow(x: number, z: number): void {
    const p = getData<WorldData>('world').sun.position;
    this.sun.position.set(x + p[0], p[1], z + p[2]);
    this.sun.target.position.set(x, 0, z);
  }
}
