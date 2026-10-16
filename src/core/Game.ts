import * as THREE from 'three';
import { getData } from './config';
import { GameLoop } from './GameLoop';
import { Physics } from './Physics';
import { bus } from './bus';
import { Arena } from '../world/Arena';
import { Input } from '../input/Input';
import { Player } from '../player/Player';
import { CameraRig } from '../player/CameraRig';
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
  private input!: Input;
  private player!: Player;
  private rig!: CameraRig;
  private arena!: Arena;
  private renderPos = new THREE.Vector3();

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
    this.arena = new Arena(this.scene, this.physics);
    this.input = new Input(this.renderer.domElement);
    this.renderer.domElement.addEventListener('click', () => this.input.requestLock());
    this.player = new Player(this.scene, this.physics);
    this.rig = new CameraRig(this.camera, this.physics);
    this.fps = new FpsCounter(this.ui);
    this.loop = new GameLoop(60, this.update, this.render);
    this.loop.start();
  }

  private update = (dt: number, frame: number): void => {
    this.input.beginTick();
    this.player.update(dt, this.input, this.rig.yaw);
    bus.emit('tick', { frame, dt });
    this.physics.step(dt);
  };

  private render = (alpha: number, realDt: number): void => {
    const m = this.input.consumeMouse();
    this.rig.rotate(m.dx, m.dy);
    this.player.render(alpha);
    this.renderPos.copy(this.player.visual.root.position);
    this.rig.update(this.renderPos, realDt);
    this.arena.follow(this.renderPos.x, this.renderPos.z);
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
