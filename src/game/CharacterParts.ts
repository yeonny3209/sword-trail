import * as THREE from 'three';

import type { CharacterLook } from '../../shared/types';

/** 캐릭터 겉모습 설정(직업마다 data/classes.json의 look) */
export type Look = CharacterLook;

export const DEG = Math.PI / 180;

/** 만화풍 3단 명암 */
const gradient = (() => {
  const t = new THREE.DataTexture(new Uint8Array([95, 175, 255]), 3, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();

export function toon(color: string, extra: THREE.MeshToonMaterialParameters = {}): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: gradient, ...extra });
}

/** 테두리(뒤집힌 껍데기): 법선 방향으로 조금 부풀린 도형을 뒷면만 검게 그린다 */
const outlineGeos = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
export const OUTLINE_MAT = new THREE.MeshBasicMaterial({ color: '#16121c', side: THREE.BackSide });

export function outlineOf(geo: THREE.BufferGeometry, thick = 0.02): THREE.BufferGeometry {
  let g = outlineGeos.get(geo);
  if (g) return g;
  g = geo.clone();
  const pos = g.attributes.position, nor = g.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i, pos.getX(i) + nor.getX(i) * thick, pos.getY(i) + nor.getY(i) * thick, pos.getZ(i) + nor.getZ(i) * thick);
  }
  pos.needsUpdate = true;
  outlineGeos.set(geo, g);
  return g;
}

/** 위쪽을 +Z로 눕힌 캡슐(팔·다리·꼬리 등 가로로 뻗는 부위) */
function capsuleZ(r: number, len: number): THREE.CapsuleGeometry {
  const g = new THREE.CapsuleGeometry(r, len, 4, 10);
  g.rotateX(Math.PI / 2);
  return g;
}

/** 공용 도형(모든 캐릭터가 같이 씀 — 지우지 않는다) */
export const GEO = {
  /** 허리가 잘록하고 가슴이 넓은 몸통(아래 = 엉덩이) */
  torso: (() => {
    const pts = [[0, 0], [0.2, 0.01], [0.23, 0.1], [0.215, 0.22], [0.27, 0.38], [0.29, 0.5], [0.24, 0.6], [0.11, 0.66], [0, 0.67]]
      .map(([r, y]) => new THREE.Vector2(r, y));
    const g = new THREE.LatheGeometry(pts, 16);
    g.scale(1, 1, 0.74);
    return g;
  })(),
  chest: (() => {
    const g = new THREE.CylinderGeometry(0.3, 0.25, 0.36, 16, 1, false, -Math.PI / 2, Math.PI);
    g.scale(1, 1, 0.8);
    return g;
  })(),
  belt: new THREE.TorusGeometry(0.225, 0.038, 6, 20).rotateX(Math.PI / 2).scale(1, 1, 0.78),
  buckle: new THREE.BoxGeometry(0.1, 0.08, 0.04),
  neck: new THREE.CylinderGeometry(0.08, 0.09, 0.12, 8),
  head: new THREE.SphereGeometry(0.26, 18, 14).scale(1, 1.06, 0.98),
  eye: new THREE.SphereGeometry(0.038, 8, 6).scale(0.8, 1.25, 0.5),
  shine: new THREE.SphereGeometry(0.012, 5, 4),
  hairCap: new THREE.SphereGeometry(0.278, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.52),
  hairBack: new THREE.SphereGeometry(0.27, 14, 10, Math.PI * 0.5, Math.PI, Math.PI * 0.3, Math.PI * 0.45),
  spike: new THREE.ConeGeometry(0.07, 0.22, 5),
  fringe: new THREE.BoxGeometry(0.42, 0.08, 0.1),
  longHair: new THREE.CapsuleGeometry(0.2, 0.3, 4, 10).scale(1.15, 1, 0.55),
  pony: capsuleZ(0.07, 0.32),
  helm: new THREE.SphereGeometry(0.3, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
  visor: new THREE.BoxGeometry(0.4, 0.06, 0.08),
  pauldronS: new THREE.SphereGeometry(0.14, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
  pauldronB: new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.6),
  upperArm: capsuleZ(0.075, 0.2),
  foreArm: capsuleZ(0.066, 0.18),
  hand: new THREE.SphereGeometry(0.078, 10, 8),
  hangArm: new THREE.CapsuleGeometry(0.072, 0.42, 4, 8),
  thigh: new THREE.CapsuleGeometry(0.095, 0.28, 4, 8),
  boot: new THREE.CapsuleGeometry(0.09, 0.22, 4, 8),
  toe: new THREE.BoxGeometry(0.15, 0.09, 0.2),
  pelvis: new THREE.CylinderGeometry(0.21, 0.2, 0.16, 12).scale(1, 1, 0.78),
  cape: (() => {
    const g = new THREE.PlaneGeometry(0.56, 0.9, 1, 6);
    g.translate(0, -0.45, 0);
    return g;
  })(),
  grip: new THREE.CylinderGeometry(0.03, 0.03, 0.2, 8).rotateX(Math.PI / 2),
  pommel: new THREE.SphereGeometry(0.045, 8, 6),
};

/** 칼날: 끝이 뾰족한 납작한 판(+Z 방향으로 length) — 길이·폭마다 한 번만 만든다 */
const bladeGeos = new Map<string, THREE.BufferGeometry>();
export function bladeGeo(length: number, width: number, curved = false): THREE.BufferGeometry {
  const key = `${length.toFixed(2)}:${width.toFixed(2)}:${curved}`;
  let g = bladeGeos.get(key);
  if (g) return g;
  const w = 0.055 * width + 0.03, tip = Math.min(length * 0.25, w * 2.6);
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  if (curved) s.quadraticCurveTo(w * 0.9, length * 0.6, 0, length);
  else {
    s.lineTo(w / 2, length - tip);
    s.lineTo(0, length);
  }
  s.lineTo(-w / 2, length - tip);
  s.lineTo(-w / 2, 0);
  g = new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 1 });
  g.translate(0, 0, -0.01);
  // 모양(XY, 길이 +Y)을 눕혀 길이를 +Z로, 폭은 위아래(Y)·두께는 좌우(X)가 되게
  g.rotateX(Math.PI / 2);
  g.rotateZ(Math.PI / 2);
  g.computeVertexNormals();
  bladeGeos.set(key, g);
  return g;
}

export function guardGeo(width: number): THREE.BufferGeometry {
  const key = `guard:${width.toFixed(2)}`;
  let g = bladeGeos.get(key);
  if (!g) {
    g = new THREE.BoxGeometry(0.06, 0.2 + width * 0.1, 0.05);
    bladeGeos.set(key, g);
  }
  return g;
}

/** 이름·색에서 고르는 기본 모습(NPC·몬스터) */
export function defaultLook(body: string, enemy: boolean): Look {
  let h = 0;
  for (const c of body) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const styles: Look['hairStyle'][] = ['short', 'spiky', 'long', 'pony', 'wild'];
  const hairs = ['#3a2a20', '#1e1a1a', '#7a5030', '#c8a060', '#8a8a90'];
  const dark = new THREE.Color(body).multiplyScalar(0.55).getStyle();
  return {
    hairStyle: styles[h % styles.length], hairColor: hairs[(h >>> 3) % hairs.length],
    armor: enemy ? '#5a5560' : dark, accent: enemy ? '#3a3238' : '#c8a060', boots: '#3a3028',
    pauldron: enemy ? 'small' : 'none', helm: enemy,
  };
}
