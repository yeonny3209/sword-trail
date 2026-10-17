import * as THREE from 'three';
import type { PortalDef, WallDef } from '../../shared/types';
import { toon } from './CharacterParts';

/** 만든 도형·재질을 나중에 한꺼번에 지우도록 모은다 */
type Track = (...items: { dispose(): void }[]) => void;

const shade = (c: string, k: number) => `#${new THREE.Color(c).multiplyScalar(k).getHexString()}`;
const tint = (c: string, to: string, k: number) => `#${new THREE.Color(c).lerp(new THREE.Color(to), k).getHexString()}`;

function box(g: THREE.Group, track: Track, mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, shadow = true): THREE.Mesh {
  const geo = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  g.add(m);
  track(geo);
  return m;
}

/**
 * 집: 돌 기단, 목조 뼈대(모서리 기둥·가로 들보), 회벽, 불 켜진 창문과 덧문, 박공지붕(처마·용마루), 굴뚝, 문틀·문·계단, 간판.
 * 정면은 마을 가운데(z가 0인 쪽)를 본다.
 */
export function house(wl: WallDef, track: Track): THREE.Group {
  const g = new THREE.Group();
  g.position.set(wl.x, 0, wl.z);
  const front = wl.z < 0 ? 1 : -1;
  const wall = toon(tint(wl.color ?? '#8a7a6a', '#f0e6d0', 0.45));
  const timber = toon(shade(wl.color ?? '#8a6a50', 0.45));
  const stone = toon('#7a7468');
  const roof = toon(wl.roof ?? '#5a3a2a');
  const roofD = toon(shade(wl.roof ?? '#5a3a2a', 0.7));
  const glass = new THREE.MeshStandardMaterial({ color: '#ffd890', emissive: '#ffb050', emissiveIntensity: 1.1 });
  track(wall, timber, stone, roof, roofD, glass);
  const W = wl.w, D = wl.d, H = wl.h;
  box(g, track, stone, W + 0.3, 0.6, D + 0.3, 0, 0.3, 0);
  box(g, track, wall, W, H - 0.6, D, 0, 0.6 + (H - 0.6) / 2, 0);
  // 뼈대: 모서리 기둥과 가로 들보
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, track, timber, 0.32, H - 0.6, 0.32, sx * (W / 2 - 0.05), 0.6 + (H - 0.6) / 2, sz * (D / 2 - 0.05));
  for (const y of [H * 0.52, H - 0.15]) {
    box(g, track, timber, W + 0.06, 0.22, 0.12, 0, y, front * (D / 2 + 0.02), false);
    box(g, track, timber, W + 0.06, 0.22, 0.12, 0, y, -front * (D / 2 + 0.02), false);
    box(g, track, timber, 0.12, 0.22, D + 0.06, W / 2 + 0.02, y, 0, false);
    box(g, track, timber, 0.12, 0.22, D + 0.06, -W / 2 - 0.02, y, 0, false);
  }
  // 정면: 문(가운데)과 양옆 창문, 옆면에도 창문
  const fz = front * (D / 2 + 0.06);
  box(g, track, timber, 2.0, 2.9, 0.14, 0, 0.6 + 1.45, fz, false);
  const door = box(g, track, toon('#4a3020'), 1.5, 2.5, 0.1, 0, 0.6 + 1.25, fz + front * 0.04, false);
  track(door.material as THREE.Material);
  box(g, track, stone, 2.2, 0.25, 0.9, 0, 0.12, front * (D / 2 + 0.5));
  const win = (x: number, z: number, rotY: number) => {
    const wg = new THREE.Group();
    wg.position.set(x, H * 0.7, z);
    wg.rotation.y = rotY;
    box(wg, track, timber, 1.25, 1.15, 0.12, 0, 0, 0, false);
    box(wg, track, glass, 1.0, 0.9, 0.1, 0, 0, 0.03, false);
    box(wg, track, timber, 0.08, 0.9, 0.12, 0, 0, 0.05, false);
    box(wg, track, timber, 1.0, 0.08, 0.12, 0, 0, 0.05, false);
    for (const s of [-1, 1]) {
      const sh = box(wg, track, roofD, 0.5, 1.0, 0.06, s * 0.9, 0, 0.06, false);
      sh.rotation.y = s * 0.5;
    }
    g.add(wg);
  };
  for (const s of [-1, 1]) win(s * W * 0.3, fz, front > 0 ? 0 : Math.PI);
  win(W / 2 + 0.06, 0, Math.PI / 2);
  win(-W / 2 - 0.06, 0, -Math.PI / 2);
  // 박공지붕: 앞뒤로 기운 두 판 + 양옆 삼각벽 + 용마루
  const rise = Math.min(3.2, D * 0.38), over = 0.7;
  const slope = Math.hypot(D / 2 + over, rise);
  const ang = Math.atan2(rise, D / 2 + over);
  for (const s of [-1, 1]) {
    const p = box(g, track, roof, W + over * 2, 0.28, slope, 0, H + rise / 2, s * (D / 4 + over / 2));
    p.rotation.x = s * ang;
    // 기와 줄
    for (let i = 1; i < 4; i++) {
      const r = box(g, track, roofD, W + over * 2, 0.08, 0.12, 0, H + rise * (1 - i / 4) + 0.18, s * ((D / 2 + over) * (i / 4)), false);
      r.rotation.x = s * ang;
    }
  }
  const tri = new THREE.Shape();
  tri.moveTo(-D / 2, 0);
  tri.lineTo(D / 2, 0);
  tri.lineTo(0, rise);
  tri.lineTo(-D / 2, 0);
  const gable = new THREE.ExtrudeGeometry(tri, { depth: W - 0.1, bevelEnabled: false });
  gable.translate(0, 0, -(W - 0.1) / 2);
  gable.rotateY(Math.PI / 2);
  const gm = new THREE.Mesh(gable, wall);
  gm.position.y = H;
  gm.castShadow = true;
  g.add(gm);
  track(gable);
  box(g, track, timber, W + over * 2 + 0.2, 0.3, 0.3, 0, H + rise + 0.1, 0);
  // 굴뚝
  box(g, track, stone, 0.9, 2.2, 0.9, W * 0.3, H + rise * 0.6 + 0.6, -front * D * 0.18);
  box(g, track, toon('#3a3430'), 1.05, 0.2, 1.05, W * 0.3, H + rise * 0.6 + 1.75, -front * D * 0.18);
  // 간판(문 위)
  const sign = box(g, track, timber, 2.2, 0.6, 0.1, 0, 0.6 + 3.1, fz + front * 0.1, false);
  sign.position.y = Math.min(H * 0.52 - 0.45, 3.2);
  return g;
}

/** 낮은 담: 돌담 + 위 덮개돌 + 일정 간격 기둥 */
export function lowWall(wl: WallDef, track: Track): THREE.Group {
  const g = new THREE.Group();
  g.position.set(wl.x, 0, wl.z);
  const c = wl.color ?? '#5a5048';
  const st = toon(tint(c, '#9a9080', 0.3)), cap = toon(tint(c, '#c0b8a8', 0.35)), post = toon(shade(c, 0.85));
  track(st, cap, post);
  box(g, track, st, wl.w, wl.h, wl.d, 0, wl.h / 2, 0);
  box(g, track, cap, wl.w + 0.2, 0.2, wl.d + 0.2, 0, wl.h + 0.1, 0);
  const long = wl.w >= wl.d, len = Math.max(wl.w, wl.d), n = Math.max(2, Math.round(len / 6));
  for (let i = 0; i <= n; i++) {
    const t = -len / 2 + (len * i) / n;
    box(g, track, post, long ? 0.7 : wl.w + 0.35, wl.h + 0.5, long ? wl.d + 0.35 : 0.7, long ? t : 0, (wl.h + 0.5) / 2, long ? 0 : t);
  }
  return g;
}

/** 기둥: 받침·몸통(원기둥)·머리 */
export function pillar(wl: WallDef, track: Track): THREE.Group {
  const g = new THREE.Group();
  g.position.set(wl.x, 0, wl.z);
  const c = wl.color ?? '#777';
  const body = toon(c), trim = toon(tint(c, '#ffffff', 0.25));
  track(body, trim);
  const r = Math.min(wl.w, wl.d) / 2;
  box(g, track, trim, wl.w * 1.15, 0.5, wl.d * 1.15, 0, 0.25, 0);
  const geo = new THREE.CylinderGeometry(r * 0.78, r * 0.86, wl.h - 1, 12);
  const m = new THREE.Mesh(geo, body);
  m.position.y = 0.5 + (wl.h - 1) / 2;
  m.castShadow = m.receiveShadow = true;
  g.add(m);
  track(geo);
  box(g, track, trim, wl.w * 1.15, 0.5, wl.d * 1.15, 0, wl.h - 0.25, 0);
  return g;
}

/** 그 밖의 벽: 돌덩이(윗면 테두리) */
export function block(wl: WallDef, track: Track): THREE.Group {
  const g = new THREE.Group();
  g.position.set(wl.x, 0, wl.z);
  const c = wl.color ?? '#777';
  const m = toon(c), top = toon(tint(c, '#ffffff', 0.18));
  track(m, top);
  box(g, track, m, wl.w, wl.h, wl.d, 0, wl.h / 2, 0);
  box(g, track, top, wl.w + 0.12, 0.16, wl.d + 0.12, 0, wl.h, 0);
  return g;
}

/** 벽 하나를 모양에 맞게: 지붕 있음 = 집, 낮고 길면 담, 가늘고 높으면 기둥 */
export function buildWall(wl: WallDef, track: Track): THREE.Group {
  if (wl.roof) return house(wl, track);
  if (wl.h <= 1.8 && Math.max(wl.w, wl.d) > 6) return lowWall(wl, track);
  if (Math.max(wl.w, wl.d) <= 3 && wl.h >= 3) return pillar(wl, track);
  return block(wl, track);
}

/** 포탈 받침: 돌 원판 + 룬 고리 두 겹 + 양옆 선돌(빛나는 룬) */
export function portalBase(p: PortalDef, track: Track): { group: THREE.Group; runes: THREE.Mesh } {
  const g = new THREE.Group();
  g.position.set(p.x, 0, p.z);
  const stone = toon('#6a6878'), rune = new THREE.MeshStandardMaterial({ color: '#60d8ff', emissive: '#40b8ff', emissiveIntensity: 1.6 });
  track(stone, rune);
  const disc = new THREE.CylinderGeometry(p.r + 0.5, p.r + 0.7, 0.16, 32);
  const dm = new THREE.Mesh(disc, stone);
  dm.position.y = 0.08;
  dm.receiveShadow = true;
  g.add(dm);
  const inner = new THREE.RingGeometry(p.r * 0.55, p.r * 0.62, 6);
  const runes = new THREE.Mesh(inner, rune);
  runes.rotation.x = -Math.PI / 2;
  runes.position.y = 0.17;
  g.add(runes);
  track(disc, inner);
  // 바깥쪽 양옆 선돌
  const ang = Math.atan2(-p.x, -p.z) + Math.PI / 2;
  for (const s of [-1, 1]) {
    const sg = new THREE.Group();
    sg.position.set(Math.sin(ang) * s * (p.r + 0.9), 0, Math.cos(ang) * s * (p.r + 0.9));
    const geo = new THREE.BoxGeometry(0.55, 2.6, 0.45);
    const m = new THREE.Mesh(geo, stone);
    m.position.y = 1.3;
    m.rotation.y = ang;
    m.castShadow = true;
    sg.add(m);
    const rg = new THREE.BoxGeometry(0.12, 1.4, 0.48);
    const r = new THREE.Mesh(rg, rune);
    r.position.y = 1.4;
    r.rotation.y = ang;
    sg.add(r);
    const capG = new THREE.OctahedronGeometry(0.25, 0);
    const cap = new THREE.Mesh(capG, rune);
    cap.position.y = 2.9;
    sg.add(cap);
    track(geo, rg, capG);
    g.add(sg);
  }
  return { group: g, runes };
}
