import * as THREE from 'three';
import type { ZoneDef } from '../../shared/types';

/** 하늘: 위는 짙고 지평선은 밝은 그라데이션과 은은한 구름(카메라를 따라다닌다). 카메라를 낮추면 보인다 */
export class SkyDome {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;

  constructor(sky: string, sun: string) {
    const horizon = new THREE.Color(sky);
    const zenith = horizon.clone().multiplyScalar(0.55).lerp(new THREE.Color('#1c2a5a'), 0.35);
    this.mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uHorizon: { value: horizon }, uZenith: { value: zenith }, uSun: { value: new THREE.Color(sun) }, uTime: { value: 0 } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        varying vec3 vDir; uniform vec3 uHorizon; uniform vec3 uZenith; uniform vec3 uSun; uniform float uTime;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
        void main(){
          float h = clamp(vDir.y, 0.0, 1.0);
          vec3 col = mix(uHorizon, uZenith, pow(h, 0.55));
          vec2 uv = vDir.xz / (vDir.y + 0.35) * 1.6 + vec2(uTime * 0.012, 0.0);
          float c = noise(uv * 2.0) * 0.6 + noise(uv * 4.5) * 0.3;
          col = mix(col, uSun, smoothstep(0.55, 0.9, c) * 0.35 * smoothstep(0.0, 0.25, h));
          float glow = pow(max(0.0, dot(normalize(vDir), normalize(vec3(0.5, 0.35, -0.8)))), 24.0);
          col += uSun * glow * 0.35;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(180, 24, 16), this.mat);
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
  }

  update(dt: number, at: THREE.Vector3): void {
    this.mat.uniforms.uTime.value += dt;
    this.mesh.position.copy(at);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.mesh.removeFromParent();
  }
}

interface Kind {
  count: number;
  color: string;
  size: number;
  /** 아래로 떨어지는 속도(음수 = 위로 떠오름) */
  fall: number;
  sway: number;
  /** 반짝임(깜빡임) */
  twinkle: boolean;
}

const KINDS: Record<NonNullable<ZoneDef['ambient']>, Kind> = {
  dust: { count: 70, color: '#fff0d0', size: 0.09, fall: 0.05, sway: 0.5, twinkle: false },
  leaf: { count: 60, color: '#d8e88a', size: 0.16, fall: 0.9, sway: 1.6, twinkle: false },
  firefly: { count: 55, color: '#d8ff70', size: 0.2, fall: -0.05, sway: 0.9, twinkle: true },
  mist: { count: 70, color: '#e8f0ff', size: 0.34, fall: 0.03, sway: 0.7, twinkle: false },
  ash: { count: 150, color: '#ffa060', size: 0.12, fall: 0.8, sway: 1.8, twinkle: true },
  snow: { count: 190, color: '#ffffff', size: 0.15, fall: 1.5, sway: 1.2, twinkle: false },
  ember: { count: 120, color: '#ff8a40', size: 0.14, fall: -1.4, sway: 1.2, twinkle: true },
  wisp: { count: 70, color: '#b8a0ff', size: 0.22, fall: -0.15, sway: 1.0, twinkle: true },
};

const BOX = [44, 18, 44];

/** 카메라 주위에 떠다니는 입자(재·눈·불씨·반딧불·낙엽·먼지). 입자 하나하나가 부드럽게 흔들리며 원래 상자 안을 맴돈다 */
export class AmbientParticles {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly seed: Float32Array;
  private readonly cfg: Kind;
  private readonly mat: THREE.ShaderMaterial;
  private time = 0;

  constructor(kind: NonNullable<ZoneDef['ambient']>) {
    this.cfg = KINDS[kind];
    const n = this.cfg.count;
    this.pos = new Float32Array(n * 3);
    this.seed = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      this.seed[i * 3] = Math.random();
      this.seed[i * 3 + 1] = Math.random();
      this.seed[i * 3 + 2] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(this.seed, 3));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color(this.cfg.color) }, uSize: { value: this.cfg.size }, uScale: { value: 800 }, uTime: { value: 0 }, uTwinkle: { value: this.cfg.twinkle ? 1 : 0 } },
      vertexShader: `
        attribute vec3 seed; uniform float uSize; uniform float uScale; uniform float uTime; uniform float uTwinkle; varying float vA;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = uSize * (0.6 + seed.x * 0.8) * uScale / max(0.1, -mv.z);
          float tw = uTwinkle > 0.5 ? 0.45 + 0.55 * sin(uTime * (1.5 + seed.y * 3.0) + seed.z * 6.28) : 1.0;
          vA = tw;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uColor; varying float vA;
        void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0) discard; float a = pow(1.0 - d, 1.4) * vA; gl_FragColor = vec4(uColor * a, a); }`,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
  }

  resize(heightPx: number, fovDeg: number, pixelRatio: number): void {
    this.mat.uniforms.uScale.value = (heightPx * pixelRatio * 0.5) / Math.tan((fovDeg * Math.PI) / 360);
  }

  /** center: 카메라가 보는 곳(플레이어 근처) */
  update(dt: number, center: THREE.Vector3): void {
    this.time += dt;
    this.mat.uniforms.uTime.value = this.time;
    const c = this.cfg, n = c.count;
    for (let i = 0; i < n; i++) {
      const sx = this.seed[i * 3], sy = this.seed[i * 3 + 1], sz = this.seed[i * 3 + 2];
      // 상자 안에서 위치를 시간으로 굴린다(떨어지면 위로, 떠오르면 아래로 돌아옴)
      const fall = (this.time * c.fall + sy * BOX[1] * 4) % BOX[1];
      const y = c.fall >= 0 ? BOX[1] - fall : fall;
      const swayX = Math.sin(this.time * 0.6 + sx * 20) * c.sway, swayZ = Math.cos(this.time * 0.5 + sz * 20) * c.sway;
      // 입자는 세계에 고정된 자리를 갖고, 카메라 둘레 상자 안에 있는 것만 그 안에 감아 보여 준다
      const x = center.x + wrap(sx * 400 + swayX - center.x, BOX[0]);
      const z = center.z + wrap(sz * 400 + swayZ - center.z, BOX[2]);
      this.pos[i * 3] = x;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z;
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.mat.dispose();
    this.points.removeFromParent();
  }
}

function wrap(v: number, size: number): number {
  return ((((v + size / 2) % size) + size) % size) - size / 2;
}
