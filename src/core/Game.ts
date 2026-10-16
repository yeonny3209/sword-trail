import * as THREE from 'three';
import { getData } from './config';
import { GameLoop } from './GameLoop';
import { Physics } from './Physics';
import { bus } from './bus';
import { Arena } from '../world/Arena';
import { PlayerVisual } from '../player/PlayerVisual';
import { FpsCounter } from '../ui/FpsCounter';

interface CameraData { fov: number; near: number; far: number }

/** 조립 지점. 각 시스템을 만들고 루프에 연결만 한다. */
export class Game {
  readonly scene = new THREE.Scene();
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly physics = new Physics();
  private loop!: GameLoop;
  private fps!: FpsCounter;

  constructor(private readonly mount: HTMLElement, private readonly ui: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(this.renderer.domElement);
    const c = getData<{ camera: CameraData }>('world').camera;
    this.camera = new THREE.PerspectiveCamera(c.fov, 1, c.near, c.far);
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  async start(): Promise<void> {
    await this.physics.init();
    new Arena(this.scene, this.physics);
    const player = new PlayerVisual(0.4, 1.8, '#e8b04a');
    this.scene.add(player.root);
    this.camera.position.set(0, 4, -7);
    this.camera.lookAt(0, 1, 0);
    this.fps = new FpsCounter(this.ui);
    this.loop = new GameLoop(60, this.update, this.render);
    this.loop.start();
  }

  private update = (dt: number, frame: number): void => {
    bus.emit('tick', { frame, dt });
    this.physics.step(dt);
  };

  private render = (_alpha: number, realDt: number): void => {
    this.fps.update(realDt);
    this.renderer.render(this.scene, this.camera);
  };

  private resize = (): void => {
    const w = this.mount.clientWidth || window.innerWidth;
    const h = this.mount.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };
}
