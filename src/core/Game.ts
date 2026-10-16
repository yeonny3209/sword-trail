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
import { Debug } from '../ui/Debug';
import { Hud } from '../ui/Hud';
import { CombatSystem } from '../combat/CombatSystem';
import { Dummy } from '../enemies/Dummy';
import { FxSystem } from '../fx/FxSystem';
import { Audio } from '../audio/Audio';
import { SfxRouter } from '../audio/SfxRouter';

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
  private combat!: CombatSystem;
  private debug!: Debug;
  private hud!: Hud;
  private dummies: Dummy[] = [];
  private fx!: FxSystem;
  /** 히트스톱 남은 프레임 */
  private freeze = 0;

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
    this.combat = new CombatSystem();
    this.debug = new Debug(this.scene, this.camera, this.ui);
    this.hud = new Hud(this.ui);
    this.fx = new FxSystem(this.scene, this.ui);
    new Audio();
    new SfxRouter();
    bus.on('hitstop', ({ frames }) => (this.freeze = Math.max(this.freeze, frames)));
    this.player = new Player(this.scene, this.physics);
    for (const [x, z, yaw] of getData<{ positions: number[][] }>('enemies/dummy').positions) {
      this.dummies.push(new Dummy(this.scene, this.physics, x, z, yaw));
    }
    this.rig = new CameraRig(this.camera, this.physics);
    this.fps = new FpsCounter(this.ui);
    this.loop = new GameLoop(60, this.update, this.render);
    this.loop.start();
  }

  private update = (dt: number, frame: number): void => {
    if (this.freeze > 0) {
      // 히트스톱: 논리는 멈추고 입력은 쌓아 둔다
      this.freeze--;
      return;
    }
    this.input.beginTick();
    if (this.input.pressed.has('debug')) bus.emit('debugToggle', {});
    bus.emit('tick', { frame, dt });
    this.player.update(dt, frame, this.input, this.rig.yaw);
    for (const d of this.dummies) d.update();
    this.combat.update(frame, dt);
    this.physics.step(dt);
  };

  private render = (alpha: number, realDt: number): void => {
    const frozen = this.freeze > 0;
    if (frozen) alpha = 1;
    const m = this.input.consumeMouse();
    this.rig.rotate(m.dx, m.dy);
    this.player.render(alpha, realDt);
    for (const d of this.dummies) d.render(alpha, realDt);
    this.renderPos.copy(this.player.view.root.position);
    this.rig.update(this.renderPos, realDt);
    this.arena.follow(this.renderPos.x, this.renderPos.z);
    this.fx.render(this.camera, alpha, realDt, frozen);
    this.debug.render();
    this.hud.render(realDt);
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
