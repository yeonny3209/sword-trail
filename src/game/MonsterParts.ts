import * as THREE from 'three';
import type { MonsterDeco, MonsterDef } from '../../shared/types';
import { outlineOf, OUTLINE_MAT, toon } from './CharacterParts';

/** 몬스터 뼈대: 애니메이션이 움직이는 부위들 */
export interface Rig {
  /** 다리(걸을 때 앞뒤로) — phase로 엇갈림 */
  legs: { o: THREE.Object3D; phase: number; amp: number; axis: 'x' | 'y' | 'z' }[];
  wings: THREE.Object3D[];
  tail: THREE.Object3D[];
  jaw: THREE.Object3D | null;
  /** 팔(거구·골렘): 공격 때 들어 올림 */
  arms: THREE.Object3D[];
  /** 떠 있는 높이(박쥐·원혼) */
  hover: number;
  /** 몸통(숨쉬기) */
  chest: THREE.Object3D | null;
}

/** 부위를 만드는 도구: 만화풍 재질 + 테두리 */
export class Builder {
  readonly mats: THREE.MeshToonMaterial[] = [];
  readonly glowMats: THREE.Material[] = [];
  readonly rig: Rig = { legs: [], wings: [], tail: [], jaw: null, arms: [], hover: 0, chest: null };

  constructor(readonly root: THREE.Group, readonly def: MonsterDef) {}

  mat(color: string, extra: THREE.MeshToonMaterialParameters = {}): THREE.MeshToonMaterial {
    const m = toon(color, extra);
    this.mats.push(m);
    return m;
  }

  /** 스스로 빛나는 부위(눈·핵·불꽃) — 맞아도 번쩍임을 덮어쓰지 않는다 */
  glow(color: string, intensity = 1.4, opacity = 1): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
    this.glowMats.push(m);
    return m;
  }

  part(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x: number, y: number, z: number, outline = true, thick = 0.025): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    if (outline) {
      const o = new THREE.Mesh(outlineOf(geo, thick), OUTLINE_MAT);
      mesh.add(o);
    }
    parent.add(mesh);
    return mesh;
  }

  group(parent: THREE.Object3D, x: number, y: number, z: number): THREE.Group {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  }

  has(d: MonsterDeco): boolean {
    return !!this.def.model.deco?.includes(d);
  }
}

/** 공유 도형(몬스터끼리 같이 씀 — 지우지 않는다) */
const G = {
  ball: new THREE.SphereGeometry(1, 20, 14),
  ballLo: new THREE.SphereGeometry(1, 10, 8),
  cap: new THREE.CapsuleGeometry(1, 1, 4, 10),
  cone: new THREE.ConeGeometry(1, 1, 8),
  cone4: new THREE.ConeGeometry(1, 1, 4),
  rock: new THREE.DodecahedronGeometry(1, 0),
  rock1: new THREE.IcosahedronGeometry(1, 0),
  box: new THREE.BoxGeometry(1, 1, 1),
  ring: new THREE.TorusGeometry(1, 0.12, 6, 18),
  crystal: new THREE.OctahedronGeometry(1, 0),
  mouth: new THREE.TorusGeometry(1, 0.22, 6, 12, Math.PI),
  wing: (() => {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.lineTo(0.35, 0.28);
    s.lineTo(0.62, 0.18);
    s.lineTo(0.9, 0.3);
    s.lineTo(1.0, -0.05);
    s.quadraticCurveTo(0.8, -0.02, 0.72, -0.22);
    s.quadraticCurveTo(0.55, -0.08, 0.45, -0.25);
    s.quadraticCurveTo(0.3, -0.1, 0.15, -0.2);
    s.lineTo(0, 0);
    return new THREE.ShapeGeometry(s);
  })(),
  /** 원혼 몸: 아래는 가는 꼬리, 위는 둥근 머리 */
  teardrop: (() => {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      pts.push(new THREE.Vector2(0.02 + 0.4 * Math.pow(t, 0.7), -0.9 + t * 1.15));
    }
    for (let i = 1; i <= 8; i++) {
      const a = (i / 8) * (Math.PI / 2);
      pts.push(new THREE.Vector2(Math.max(0.001, 0.42 * Math.cos(a)), 0.25 + 0.42 * Math.sin(a)));
    }
    return new THREE.LatheGeometry(pts, 18);
  })(),
};

const sc = (m: THREE.Object3D, x: number, y = x, z = x) => (m.scale.set(x, y, z), m);
const dark = (c: string, k = 0.6) => new THREE.Color(c).multiplyScalar(k).getStyle();
const light = (c: string, k = 0.35) => new THREE.Color(c).lerp(new THREE.Color('#ffffff'), k).getStyle();

/** 장식: 불꽃·서리·수정·이끼·갈기·뿔·왕관을 위치 목록에 붙인다 */
function decorate(b: Builder, top: THREE.Object3D, spots: [number, number, number][], size: number): void {
  if (b.has('flame')) {
    const f = b.glow('#ff8a30', 2.2, 0.9);
    spots.forEach(([x, y, z], i) => sc(b.part(G.cone, f, top, x, y + size * 0.4, z, false), size * 0.35, size * (0.9 + (i % 2) * 0.4), size * 0.35));
  }
  if (b.has('frost')) {
    const ice = b.mat('#cfeeff', { transparent: true, opacity: 0.9 });
    spots.forEach(([x, y, z], i) => {
      const c = sc(b.part(G.crystal, ice, top, x, y + size * 0.3, z, true, 0.04), size * 0.22, size * (0.6 + (i % 3) * 0.2), size * 0.22);
      c.rotation.z = (i % 2 ? 1 : -1) * 0.3;
    });
  }
  if (b.has('crystal')) {
    const cr = b.glow('#8ff0ff', 1.6);
    spots.forEach(([x, y, z], i) => {
      const c = sc(b.part(G.crystal, cr, top, x, y + size * 0.35, z, true, 0.04), size * 0.25, size * 0.75, size * 0.25);
      c.rotation.set(0.3 * (i % 2 ? 1 : -1), i, 0.25);
    });
  }
  if (b.has('moss')) {
    const moss = b.mat('#5a8a3a');
    spots.forEach(([x, y, z]) => sc(b.part(G.ballLo, moss, top, x, y + size * 0.05, z), size * 0.45, size * 0.18, size * 0.45));
  }
}

function eyes(b: Builder, parent: THREE.Object3D, y: number, z: number, gap: number, r: number, color = '#ffd040'): void {
  const e = b.glow(color, 1.8);
  for (const s of [-1, 1]) sc(b.part(G.ballLo, e, parent, gap * s, y, z, false), r, r * 1.2, r * 0.6);
}

function horns(b: Builder, parent: THREE.Object3D, y: number, z: number, gap: number, len: number): void {
  const hm = b.mat('#e8dcc0');
  for (const s of [-1, 1]) {
    const h = sc(b.part(G.cone, hm, parent, gap * s, y + len * 0.4, z), len * 0.18, len, len * 0.18);
    h.rotation.z = -0.5 * s;
    h.rotation.x = -0.3;
  }
}

/** 슬라임: 반투명 몸 + 빛나는 핵 + 큰 눈·입 + 바닥 방울 */
export function slime(b: Builder, color: string): void {
  const body = b.group(b.root, 0, 0, 0);
  b.rig.chest = body;
  sc(b.part(G.ball, b.mat(color, { transparent: true, opacity: 0.85 }), body, 0, 0.45, 0, true, 0.03), 0.6, 0.47, 0.6);
  sc(b.part(G.ballLo, b.glow(light(color, 0.2), 0.8, 0.8), body, 0, 0.38, -0.05, false), 0.22);
  sc(b.part(G.ballLo, b.glow('#ffffff', 0.6, 0.7), body, -0.22, 0.72, 0.25, false), 0.09, 0.06, 0.06);
  for (const [x, z] of [[0.45, 0.2], [-0.4, 0.3], [0.1, -0.5], [-0.3, -0.35]]) sc(b.part(G.ballLo, b.mat(color), body, x, 0.08, z, true, 0.04), 0.15, 0.1, 0.15);
  const white = b.mat('#ffffff'), black = b.mat('#151515');
  for (const s of [-1, 1]) {
    sc(b.part(G.ball, white, body, 0.2 * s, 0.6, 0.45), 0.13, 0.15, 0.08);
    sc(b.part(G.ballLo, black, body, 0.21 * s, 0.6, 0.52, false), 0.065, 0.08, 0.04);
    sc(b.part(G.ballLo, b.glow('#ffffff', 1), body, 0.18 * s, 0.64, 0.55, false), 0.02);
  }
  const mouth = sc(b.part(G.mouth, black, body, 0, 0.45, 0.53, false), 0.09);
  mouth.rotation.z = Math.PI;
  b.rig.jaw = mouth;
  decorate(b, body, [[0, 0.8, 0], [0.25, 0.7, -0.1], [-0.25, 0.72, -0.05]], 0.5);
}

/** 짐승(늑대): 가슴이 넓은 몸통, 주둥이·턱·귀, 갈기, 세 마디 꼬리, 무릎이 있는 네 다리 */
export function beast(b: Builder, color: string): void {
  const fur = b.mat(color), furD = b.mat(dark(color, 0.65)), belly = b.mat(light(color, 0.3));
  const body = b.group(b.root, 0, 0.72, 0);
  b.rig.chest = body;
  sc(b.part(G.cap, fur, body, 0, 0, -0.05), 0.27, 0.36, 0.27).rotation.x = Math.PI / 2;
  sc(b.part(G.ball, fur, body, 0, 0.06, 0.3), 0.33, 0.32, 0.34);
  sc(b.part(G.ball, belly, body, 0, -0.1, 0.3, false), 0.24, 0.2, 0.26);
  const head = b.group(body, 0, 0.18, 0.62);
  sc(b.part(G.ball, fur, head, 0, 0.02, 0), 0.22, 0.2, 0.22);
  sc(b.part(G.box, fur, head, 0, -0.03, 0.22), 0.17, 0.12, 0.26);
  sc(b.part(G.ballLo, b.mat('#1a1414'), head, 0, 0.02, 0.36, false), 0.05, 0.04, 0.04);
  const jaw = b.group(head, 0, -0.08, 0.12);
  sc(b.part(G.box, furD, jaw, 0, -0.02, 0.1), 0.14, 0.05, 0.22);
  const teeth = b.mat('#f4f0e0');
  for (const s of [-1, 1]) sc(b.part(G.cone4, teeth, jaw, 0.05 * s, 0.02, 0.18, false), 0.015, 0.05, 0.015).rotation.x = Math.PI;
  b.rig.jaw = jaw;
  for (const s of [-1, 1]) {
    const ear = sc(b.part(G.cone4, furD, head, 0.12 * s, 0.2, -0.04), 0.07, 0.18, 0.05);
    ear.rotation.z = -0.25 * s;
  }
  eyes(b, head, 0.07, 0.16, 0.09, 0.035);
  if (b.has('mane')) {
    const mane = b.mat(dark(color, 0.8));
    for (let i = 0; i < 9; i++) {
      const a = (i / 8 - 0.5) * 2.6;
      const c = sc(b.part(G.cone, mane, body, Math.sin(a) * 0.26, 0.2 + Math.cos(a) * 0.12, 0.42), 0.08, 0.26, 0.08);
      c.rotation.set(-0.9, 0, -a * 0.6);
    }
  }
  let prev: THREE.Object3D = b.group(body, 0, 0.08, -0.5);
  for (let i = 0; i < 3; i++) {
    const seg = b.group(prev, 0, 0, i ? -0.16 : 0);
    sc(b.part(G.cap, i === 2 ? furD : fur, seg, 0, 0, -0.08), 0.06 - i * 0.012, 0.08, 0.06 - i * 0.012).rotation.x = Math.PI / 2;
    seg.rotation.x = 0.35;
    b.rig.tail.push(seg);
    prev = seg;
  }
  for (const [x, z, ph] of [[-0.15, 0.32, 0], [0.15, 0.32, Math.PI], [-0.15, -0.32, Math.PI], [0.15, -0.32, 0]] as const) {
    const hip = b.group(body, x, -0.05, z);
    sc(b.part(G.cap, fur, hip, 0, -0.18, 0), 0.075, 0.16, 0.085);
    const knee = b.group(hip, 0, -0.34, 0);
    sc(b.part(G.cap, furD, knee, 0, -0.12, 0.02), 0.05, 0.12, 0.05);
    sc(b.part(G.ballLo, furD, knee, 0, -0.29, 0.05), 0.07, 0.04, 0.09);
    b.rig.legs.push({ o: hip, phase: ph, amp: 0.65, axis: 'x' });
  }
  decorate(b, body, [[0, 0.28, 0.05], [0, 0.26, -0.22], [0, 0.22, -0.45]], 0.35);
}

/** 골렘: 바위 몸통·어깨·주먹, 가슴의 빛나는 핵과 금, 짧은 다리 */
export function golem(b: Builder, color: string): void {
  const rock = b.mat(color), rockD = b.mat(dark(color, 0.7));
  const body = b.group(b.root, 0, 1.45, 0);
  b.rig.chest = body;
  sc(b.part(G.rock, rock, body, 0, 0, 0, true, 0.03), 0.62, 0.68, 0.48);
  sc(b.part(G.rock1, rockD, body, 0, -0.55, 0, true, 0.03), 0.45, 0.32, 0.38);
  sc(b.part(G.rock, rockD, body, 0, 0.78, 0.08, true, 0.03), 0.3, 0.26, 0.28);
  eyes(b, body, 0.8, 0.32, 0.11, 0.05, '#ff7030');
  sc(b.part(G.crystal, b.glow('#ff8040', 2), body, 0, 0.1, 0.42, false), 0.12, 0.16, 0.08);
  const crack = b.glow('#ff9050', 1.4);
  for (const [x, y, r] of [[0.2, 0.25, 0.6], [-0.22, -0.05, -0.5], [0.12, -0.28, 0.3]]) sc(b.part(G.box, crack, body, x, y, 0.43, false), 0.18, 0.02, 0.02).rotation.z = r;
  for (const s of [-1, 1]) {
    const sh = b.group(body, 0.72 * s, 0.35, 0);
    sc(b.part(G.rock, rock, sh, 0, 0, 0, true, 0.03), 0.34, 0.3, 0.32);
    const arm = b.group(sh, 0, -0.1, 0);
    sc(b.part(G.rock1, rockD, arm, 0, -0.45, 0.05, true, 0.03), 0.22, 0.32, 0.22);
    sc(b.part(G.rock, rock, arm, 0, -0.9, 0.1, true, 0.03), 0.3, 0.28, 0.3);
    b.rig.arms.push(arm);
    const leg = b.group(body, 0.3 * s, -0.75, 0);
    sc(b.part(G.rock1, rockD, leg, 0, -0.35, 0, true, 0.03), 0.24, 0.38, 0.26);
    b.rig.legs.push({ o: leg, phase: s > 0 ? 0 : Math.PI, amp: 0.4, axis: 'x' });
  }
  decorate(b, body, [[0.72, 0.6, 0], [-0.72, 0.6, 0], [0.2, 0.55, -0.2], [-0.25, 0.6, -0.15]], 0.5);
}

/** 거미: 큰 배·머리가슴, 빛나는 눈 여섯, 독니, 두 마디씩 굽은 다리 여덟 */
export function spider(b: Builder, color: string): void {
  const shell = b.mat(color), shellD = b.mat(dark(color, 0.55)), mark = b.mat(light(color, 0.5));
  const body = b.group(b.root, 0, 0.62, 0);
  b.rig.chest = body;
  sc(b.part(G.ball, shell, body, 0, 0.12, -0.42, true, 0.03), 0.48, 0.4, 0.55);
  sc(b.part(G.ballLo, mark, body, 0, 0.48, -0.45, false), 0.18, 0.06, 0.24);
  sc(b.part(G.ball, shellD, body, 0, 0, 0.18), 0.3, 0.24, 0.32);
  const head = b.group(body, 0, 0.02, 0.46);
  sc(b.part(G.ball, shell, head, 0, 0, 0), 0.2, 0.17, 0.18);
  const eye = b.glow(b.has('frost') ? '#80e8ff' : '#ff3030', 2);
  for (const [x, y] of [[-0.07, 0.08], [0.07, 0.08], [-0.13, 0.03], [0.13, 0.03], [-0.04, 0.13], [0.04, 0.13]]) sc(b.part(G.ballLo, eye, head, x, y, 0.15, false), 0.03);
  const jaw = b.group(head, 0, -0.08, 0.14);
  const fang = b.mat('#2a2020');
  for (const s of [-1, 1]) sc(b.part(G.cone4, fang, jaw, 0.06 * s, -0.04, 0.03), 0.03, 0.14, 0.03).rotation.x = Math.PI * 0.85;
  b.rig.jaw = jaw;
  // 다리: 위 마디는 바깥·위로, 아래 마디는 바깥·아래로 꺾여 땅을 짚는다
  const L1 = 0.4, L2 = 0.95, e1 = 0.6, e2 = -1.04;
  for (let i = 0; i < 4; i++) {
    for (const s of [-1, 1]) {
      const hip = b.group(body, 0.2 * s, 0.02, 0.26 - i * 0.15);
      hip.rotation.y = s * (Math.PI / 2 - (1.5 - i) * 0.45);
      const leg = b.group(hip, 0, 0, 0);
      const u = sc(b.part(G.cap, shellD, leg, 0, Math.sin(e1) * L1 / 2, Math.cos(e1) * L1 / 2), 0.04, L1 / 3, 0.04);
      u.rotation.x = Math.PI / 2 - e1;
      const kx = Math.sin(e1) * L1, kz = Math.cos(e1) * L1;
      sc(b.part(G.ballLo, shellD, leg, 0, kx, kz), 0.05);
      const l = sc(b.part(G.cap, shell, leg, 0, kx + Math.sin(e2) * L2 / 2, kz + Math.cos(e2) * L2 / 2), 0.032, L2 / 3, 0.032);
      l.rotation.x = Math.PI / 2 - e2;
      b.rig.legs.push({ o: leg, phase: (i % 2 ? Math.PI : 0) + (s > 0 ? 0 : Math.PI), amp: 0.28, axis: 'y' });
    }
  }
  decorate(b, body, [[0, 0.45, -0.3], [0.2, 0.4, -0.55], [-0.2, 0.4, -0.55]], 0.35);
}

/** 박쥐: 떠서 날갯짓, 큰 귀·송곳니, 막이 있는 날개 */
export function bat(b: Builder, color: string): void {
  b.rig.hover = 1.25;
  const fur = b.mat(color), skin = b.mat(dark(color, 0.75), { side: THREE.DoubleSide });
  const body = b.group(b.root, 0, 0, 0);
  b.rig.chest = body;
  sc(b.part(G.ball, fur, body, 0, 0, 0), 0.24, 0.3, 0.22);
  const head = b.group(body, 0, 0.3, 0.06);
  sc(b.part(G.ball, fur, head, 0, 0, 0), 0.18, 0.16, 0.17);
  for (const s of [-1, 1]) sc(b.part(G.cone4, skin, head, 0.1 * s, 0.17, -0.02), 0.07, 0.22, 0.04).rotation.z = -0.3 * s;
  eyes(b, head, 0.03, 0.14, 0.07, 0.03, b.has('flame') ? '#ffd040' : '#ff4040');
  const jaw = b.group(head, 0, -0.07, 0.12);
  const teeth = b.mat('#f8f4e8');
  for (const s of [-1, 1]) sc(b.part(G.cone4, teeth, jaw, 0.035 * s, -0.02, 0, false), 0.015, 0.06, 0.015).rotation.x = Math.PI;
  b.rig.jaw = jaw;
  for (const s of [-1, 1]) {
    const w = b.group(body, 0.16 * s, 0.1, 0);
    const m = b.part(G.wing, skin, w, 0, 0, 0, false);
    m.scale.set(0.95 * s, 0.95, 1);
    m.rotation.x = -Math.PI / 2;
    const bone = b.mat(dark(color, 0.5));
    sc(b.part(G.cap, bone, w, 0.45 * s, 0, 0.12, false), 0.02, 0.45, 0.02).rotation.z = Math.PI / 2;
    b.rig.wings.push(w);
    sc(b.part(G.cone4, bone, body, 0.08 * s, -0.32, 0), 0.03, 0.12, 0.03).rotation.x = Math.PI;
  }
  decorate(b, body, [[0, 0.2, -0.15], [0.1, 0.1, -0.18], [-0.1, 0.1, -0.18]], 0.25);
}

/** 원혼: 떠 있는 물방울 몸, 텅 빈 눈, 흐느적거리는 팔·꼬리. 반투명하게 빛남 */
export function ghost(b: Builder, color: string): void {
  b.rig.hover = 0.5;
  const ecto = b.mat(color, { transparent: true, opacity: 0.72, emissive: color, emissiveIntensity: 0.25 });
  const body = b.group(b.root, 0, 0.9, 0);
  b.rig.chest = body;
  sc(b.part(G.teardrop, ecto, body, 0, 0, 0, true, 0.02), 1.0, 1.0, 1.0);
  const hood = b.mat(dark(color, 0.45), { transparent: true, opacity: 0.85 });
  sc(b.part(G.ball, hood, body, 0, 0.55, -0.02, false), 0.38, 0.3, 0.36);
  const hole = b.mat('#0a0a14');
  for (const s of [-1, 1]) {
    sc(b.part(G.ballLo, hole, body, 0.12 * s, 0.48, 0.3, false), 0.07, 0.1, 0.04);
    sc(b.part(G.ballLo, b.glow(b.has('frost') ? '#a0f0ff' : '#c8f0ff', 2.2), body, 0.12 * s, 0.48, 0.33, false), 0.025);
  }
  const jaw = b.group(body, 0, 0.3, 0.32);
  sc(b.part(G.ballLo, hole, jaw, 0, 0, 0, false), 0.08, 0.05, 0.03);
  b.rig.jaw = jaw;
  for (const s of [-1, 1]) {
    const arm = b.group(body, 0.36 * s, 0.25, 0.05);
    let prev: THREE.Object3D = arm;
    for (let i = 0; i < 3; i++) {
      const seg = b.group(prev, 0, -0.14, i ? 0.04 : 0);
      sc(b.part(G.cap, ecto, seg, 0, -0.06, 0, false), 0.07 - i * 0.015, 0.1, 0.07 - i * 0.015);
      prev = seg;
      if (i === 0) b.rig.arms.push(seg);
    }
  }
  let prev: THREE.Object3D = b.group(body, 0, -0.75, -0.1);
  for (let i = 0; i < 3; i++) {
    const seg = b.group(prev, 0, -0.08, -0.08);
    sc(b.part(G.cone, ecto, seg, 0, 0, 0, false), 0.16 - i * 0.04, 0.24, 0.16 - i * 0.04).rotation.x = Math.PI * 0.75;
    b.rig.tail.push(seg);
    prev = seg;
  }
  decorate(b, body, [[0.15, 0.65, -0.1], [-0.15, 0.68, -0.1], [0, 0.72, -0.2]], 0.3);
}

/** 거구(설인): 굽은 등, 땅까지 닿는 긴 팔과 큰 주먹, 짧은 다리, 털 뭉치, 뿔 */
export function brute(b: Builder, color: string): void {
  const fur = b.mat(color), face = b.mat(dark(color, 0.55)), furL = b.mat(light(color, 0.2));
  const body = b.group(b.root, 0, 1.25, 0);
  b.rig.chest = body;
  const t = sc(b.part(G.ball, fur, body, 0, 0.1, 0, true, 0.03), 0.62, 0.6, 0.5);
  t.rotation.x = 0.25;
  sc(b.part(G.ball, furL, body, 0, -0.05, 0.28, false), 0.4, 0.38, 0.25);
  const head = b.group(body, 0, 0.62, 0.32);
  sc(b.part(G.ball, fur, head, 0, 0, 0), 0.27, 0.25, 0.25);
  sc(b.part(G.ball, face, head, 0, -0.04, 0.16), 0.18, 0.15, 0.12);
  eyes(b, head, 0.03, 0.27, 0.07, 0.032, b.has('frost') ? '#60d8ff' : '#ffcc30');
  const jaw = b.group(head, 0, -0.12, 0.2);
  sc(b.part(G.box, face, jaw, 0, -0.02, 0.02), 0.2, 0.07, 0.1);
  b.rig.jaw = jaw;
  horns(b, head, 0.18, -0.02, 0.17, 0.3);
  for (let i = 0; i < 7; i++) {
    const a = (i / 6 - 0.5) * 2.4;
    sc(b.part(G.cone, furL, body, Math.sin(a) * 0.5, 0.48, -0.1 + Math.cos(a) * -0.2), 0.12, 0.3, 0.12).rotation.set(-0.6, 0, -a * 0.5);
  }
  for (const s of [-1, 1]) {
    const sh = b.group(body, 0.62 * s, 0.32, 0.05);
    sc(b.part(G.ball, fur, sh, 0, 0, 0), 0.26);
    const arm = b.group(sh, 0, -0.05, 0);
    sc(b.part(G.cap, fur, arm, 0, -0.4, 0.04), 0.15, 0.36, 0.15);
    sc(b.part(G.ball, face, arm, 0, -0.95, 0.08), 0.2, 0.18, 0.2);
    b.rig.arms.push(arm);
    const leg = b.group(body, 0.28 * s, -0.5, 0);
    sc(b.part(G.cap, fur, leg, 0, -0.32, 0), 0.17, 0.22, 0.18);
    sc(b.part(G.ballLo, face, leg, 0, -0.68, 0.08), 0.18, 0.08, 0.22);
    b.rig.legs.push({ o: leg, phase: s > 0 ? 0 : Math.PI, amp: 0.45, axis: 'x' });
  }
  decorate(b, body, [[0.6, 0.55, 0], [-0.6, 0.55, 0], [0, 0.65, -0.3]], 0.45);
}

/** 사람형 몬스터 장식(뿔·왕관·그림자·불꽃·서리 기운) — 머리 높이 h */
export function humanoidDeco(b: Builder, h: number): void {
  if (b.has('horns')) horns(b, b.root, h + 0.1, 0, 0.16, 0.34);
  if (b.has('crown')) {
    const gold = b.glow('#ffd860', 0.9);
    const c = sc(b.part(G.ring, gold, b.root, 0, h + 0.18, 0, false), 0.2, 0.2, 0.2);
    c.rotation.x = Math.PI / 2;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      sc(b.part(G.cone4, gold, b.root, Math.sin(a) * 0.2, h + 0.27, Math.cos(a) * 0.2, false), 0.035, 0.13, 0.035);
    }
  }
  const aura = b.has('shadow') ? '#7040c0' : b.has('flame') ? '#ff6020' : b.has('frost') ? '#80d8ff' : '';
  if (aura) {
    const m = b.glow(aura, 1.5, 0.35);
    const r = sc(b.part(G.cone, m, b.root, 0, 0.7, 0, false), 0.55, 1.5, 0.55);
    r.rotation.x = Math.PI;
    b.rig.tail.push(r);
  }
}
