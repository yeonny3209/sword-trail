import * as THREE from 'three';
import type { NodeDef, NpcDef, PortalDef, PropDef, ZoneDef } from '../../shared/types';
import { LOOT } from '../../shared/items';
import { CharacterModel } from './CharacterModel';

/** 땅에 얼룩을 뿌린 반복 텍스처 */
function groundTexture(base: string, accent: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 220; i++) {
    g.globalAlpha = 0.04 + rnd() * 0.07;
    g.fillStyle = rnd() < 0.6 ? accent : '#000000';
    const x = rnd() * 256, y = rnd() * 256, r = 2 + rnd() * 12;
    g.beginPath();
    g.ellipse(x, y, r, r * (0.5 + rnd() * 0.5), rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface PortalView {
  def: PortalDef;
  ring: THREE.Mesh;
  beam: THREE.Mesh;
}

export interface NpcView {
  def: NpcDef;
  model: CharacterModel;
}

export interface NodeView {
  i: number;
  def: NodeDef;
  /** 캘 수 있을 때 보이는 부분 */
  res: THREE.Group;
  up: boolean;
}

const NODE_TINT: Record<string, string[]> = {
  ore: ['#c8b090', '#e8eef4', '#7fd8ff'],
  herb: ['#7ccf5a', '#5ab0ff', '#f4f0ff'],
  wood: ['#8a6440', '#4a3a30', '#b89a70'],
};

/** 존 정의(JSON)로 3D 장면을 만든다. 존을 옮기면 dispose하고 새로 만든다. */
export class ZoneScene {
  readonly group = new THREE.Group();
  readonly portals: PortalView[] = [];
  readonly npcs: NpcView[] = [];
  readonly nodes: NodeView[] = [];
  private readonly disposables: { dispose(): void }[] = [];
  private time = 0;

  constructor(readonly def: ZoneDef) {
    const [w, d] = def.size;
    const tex = groundTexture(def.ground, def.groundAccent ?? def.ground);
    tex.repeat.set(w / 12, d / 12);
    const groundMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(w + 60, d + 60), groundMat);
    tex.repeat.set((w + 60) / 9, (d + 60) / 9);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);
    this.track(ground.geometry, groundMat, tex);

    // 존 경계 밖은 어둡게
    const edgeMat = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.35 });
    for (const [x, z, ew, ed] of [[0, -d / 2 - 15, w + 60, 30], [0, d / 2 + 15, w + 60, 30], [-w / 2 - 15, 0, 30, d], [w / 2 + 15, 0, 30, d]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(ew, ed), edgeMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.02, z);
      this.group.add(m);
      this.track(m.geometry);
    }
    this.track(edgeMat);

    for (const wl of def.walls) {
      const mat = new THREE.MeshStandardMaterial({ color: wl.color ?? '#777', roughness: 0.9 });
      const box = new THREE.Mesh(new THREE.BoxGeometry(wl.w, wl.h, wl.d), mat);
      box.position.set(wl.x, wl.h / 2, wl.z);
      box.castShadow = box.receiveShadow = true;
      this.group.add(box);
      this.track(box.geometry, mat);
      if (wl.roof) {
        const rm = new THREE.MeshStandardMaterial({ color: wl.roof, roughness: 0.8 });
        const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(wl.w, wl.d) / 2 + 0.6, wl.h * 0.6, 4), rm);
        roof.rotation.y = Math.PI / 4;
        roof.scale.set(wl.w / Math.max(wl.w, wl.d), 1, wl.d / Math.max(wl.w, wl.d));
        roof.position.set(wl.x, wl.h + wl.h * 0.3, wl.z);
        roof.castShadow = true;
        this.group.add(roof);
        this.track(roof.geometry, rm);
        // 문
        const door = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.4), new THREE.MeshStandardMaterial({ color: '#3a2a1e' }));
        const front = wl.z < 0 ? 1 : -1;
        door.position.set(wl.x, 1.2, wl.z + front * (wl.d / 2 + 0.01));
        if (front < 0) door.rotation.y = Math.PI;
        this.group.add(door);
        this.track(door.geometry, door.material as THREE.Material);
      }
    }
    for (const p of def.props) this.prop(p);
    for (const p of def.portals) this.portal(p);
    const tier = (LOOT as unknown as { gather: { tiers: Record<string, number> } }).gather.tiers[def.id] ?? 1;
    def.nodes.forEach((n, i) => this.node(n, i, tier));
    for (const n of def.npcs) {
      const model = new CharacterModel({ body: n.color, weapon: null });
      model.root.position.set(n.x, 0, n.z);
      model.root.rotation.y = n.f;
      this.group.add(model.root);
      this.npcs.push({ def: n, model });
    }
  }

  private track(...items: { dispose(): void }[]): void {
    this.disposables.push(...items);
  }

  /** 채집 노드: 광석(바위+결정), 약초(덤불+꽃), 나무(그루터기+통나무) */
  private node(n: NodeDef, i: number, tier: number): void {
    const tint = NODE_TINT[n.kind][Math.min(2, tier - 1)];
    const base = new THREE.Group();
    base.position.set(n.x, 0, n.z);
    const res = new THREE.Group();
    const m = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => {
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });
      this.track(mat);
      return mat;
    };
    const add = (parent: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      this.track(geo);
      return mesh;
    };
    if (n.kind === 'ore') {
      add(base, new THREE.DodecahedronGeometry(0.6, 0), m('#6a6660'), 0, 0.3, 0).scale.y = 0.7;
      for (const [x, z, s] of [[0.2, 0.1, 1], [-0.25, 0.15, 0.8], [0.05, -0.25, 0.7]]) {
        const c = add(res, new THREE.ConeGeometry(0.12 * s, 0.6 * s, 5), m(tint, { emissive: tint, emissiveIntensity: 0.35, metalness: 0.5 }), x, 0.55, z);
        c.rotation.set(x, 0, z);
      }
    } else if (n.kind === 'herb') {
      add(res, new THREE.SphereGeometry(0.35, 8, 6), m('#3f7a34'), 0, 0.25, 0).scale.y = 0.7;
      for (const [x, z] of [[0.15, 0.1], [-0.18, 0.05], [0, -0.2], [0.1, -0.05]]) add(res, new THREE.SphereGeometry(0.08, 6, 5), m(tint, { emissive: tint, emissiveIntensity: 0.5 }), x, 0.5, z);
      add(base, new THREE.CircleGeometry(0.45, 10), m('#4a3a28'), 0, 0.03, 0).rotation.x = -Math.PI / 2;
    } else {
      add(base, new THREE.CylinderGeometry(0.35, 0.42, 0.45, 8), m('#5a4030'), 0, 0.22, 0);
      const log = add(res, new THREE.CylinderGeometry(0.16, 0.16, 1.2, 7), m(tint), 0.5, 0.18, 0.2);
      log.rotation.set(0, 0.6, Math.PI / 2);
      add(res, new THREE.SphereGeometry(0.1, 6, 5), m('#5f8a42'), 0, 0.5, 0);
    }
    base.add(res);
    this.group.add(base);
    this.nodes.push({ i, def: n, res, up: true });
  }

  setNode(i: number, up: boolean): void {
    const n = this.nodes[i];
    if (!n) return;
    n.up = up;
    n.res.visible = up;
  }

  private prop(p: PropDef): void {
    const s = p.s ?? 1;
    const add = (geo: THREE.BufferGeometry, color: string, x: number, y: number, z: number, shadow = true, extra: THREE.MeshStandardMaterialParameters = {}) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra });
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.track(geo, m);
      return mesh;
    };
    switch (p.kind) {
      case 'tree':
        add(new THREE.CylinderGeometry(0.18 * s, 0.25 * s, 1.6 * s, 6), '#5a4030', p.x, 0.8 * s, p.z);
        add(new THREE.ConeGeometry(1.3 * s, 2.6 * s, 7), '#3f6b3a', p.x, 2.6 * s, p.z);
        add(new THREE.ConeGeometry(1.0 * s, 2.0 * s, 7), '#4a7a42', p.x, 3.5 * s, p.z);
        break;
      case 'rock': {
        const r = add(new THREE.DodecahedronGeometry(0.7 * s, 0), '#8a8680', p.x, 0.35 * s, p.z);
        r.rotation.set(p.x, p.z, 0);
        r.scale.y = 0.7;
        break;
      }
      case 'lamp':
        add(new THREE.CylinderGeometry(0.06, 0.08, 2.6, 6), '#2e2a26', p.x, 1.3, p.z);
        add(new THREE.SphereGeometry(0.22, 10, 8), '#ffd890', p.x, 2.7, p.z, false, { emissive: '#ffb850', emissiveIntensity: 1.6 });
        break;
      case 'crate':
        add(new THREE.BoxGeometry(0.9, 0.9, 0.9), '#8a6a42', p.x, 0.45, p.z);
        break;
      case 'well':
        add(new THREE.TorusGeometry(1.0, 0.25, 6, 14), '#7a7a7a', p.x, 1.05, p.z).rotation.x = Math.PI / 2;
        break;
      case 'grass': {
        const g = add(new THREE.ConeGeometry(0.12, 0.5, 4), '#5f8a42', p.x, 0.25, p.z, false);
        g.scale.setScalar(s);
        break;
      }
      case 'pillar':
        add(new THREE.CylinderGeometry(0.5 * s, 0.6 * s, 3 * s, 8), '#8a8478', p.x, 1.5 * s, p.z);
        break;
      case 'fence':
        add(new THREE.BoxGeometry(2, 0.8, 0.12), '#6a5038', p.x, 0.4, p.z);
        break;
    }
  }

  private portal(p: PortalDef): void {
    const ringMat = new THREE.MeshStandardMaterial({ color: '#60d8ff', emissive: '#40b8ff', emissiveIntensity: 1.4 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(p.r, 0.12, 8, 32), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(p.x, 0.08, p.z);
    const beamMat = new THREE.MeshBasicMaterial({ color: '#7fdcff', transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(p.r * 0.95, p.r, 3.2, 24, 1, true), beamMat);
    beam.position.set(p.x, 1.6, p.z);
    this.group.add(ring, beam);
    this.track(ring.geometry, ringMat, beam.geometry, beamMat);
    this.portals.push({ def: p, ring, beam });
  }

  update(dt: number): void {
    this.time += dt;
    for (const p of this.portals) {
      p.ring.rotation.z += dt * 0.8;
      (p.beam.material as THREE.MeshBasicMaterial).opacity = 0.14 + Math.sin(this.time * 2.5) * 0.06;
    }
    for (const n of this.npcs) n.model.animate(dt, 0, false);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    for (const n of this.npcs) n.model.dispose();
    this.group.removeFromParent();
  }
}
