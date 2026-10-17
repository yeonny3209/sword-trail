import * as THREE from 'three';
import { bus } from '../core/bus';
import { getData } from '../core/config';
import { GameLoop } from '../core/GameLoop';
import { dist2 } from '../../shared/geom';
import { ZONES } from '../../shared/data';
import { MOVE_SEND_HZ, type S2C } from '../../shared/protocol';
import { Audio } from '../audio/Audio';
import { Effects } from '../fx/Effects';
import { Particles, type BurstSpec } from '../fx/Particles';
import { Input } from '../input/Input';
import { Connection } from '../net/Connection';
import { ChatBox } from '../ui/ChatBox';
import { DamageNumbers } from '../ui/DamageNumbers';
import { Hud } from '../ui/Hud';
import { Nameplates } from '../ui/Nameplates';
import { DeathOverlay, SkillBar } from '../ui/SkillBar';
import { UiHub } from './UiHub';
import { SocialHub } from './SocialHub';
import { ScreenFx } from '../ui/ScreenFx';
import { Music } from '../audio/Music';
import { MoveFx } from '../fx/MoveFx';
import { PostFx } from '../fx/PostFx';
import { HelperHub } from './HelperHub';
import { BuffBar } from '../ui/BuffBar';
import { CombatClient } from './CombatClient';
import { LocalPlayer } from './LocalPlayer';
import { Monsters } from './Monsters';
import { QuarterCamera } from './QuarterCamera';
import { RemotePlayers } from './RemotePlayers';
import { ZoneScene } from './ZoneScene';

interface LightData { sun: number; ambient: number; shadowSize: number; shadowExtent: number }

/** 게임 화면의 조립 지점: 렌더러·카메라·네트워크·내 캐릭터·원격 개체·전투·UI */
export class GameClient {
  readonly scene = new THREE.Scene();
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.5, 300);
  readonly cam: QuarterCamera;
  readonly net = new Connection();
  readonly input: Input;
  readonly plates: Nameplates;
  readonly hud: Hud;
  readonly remotes: RemotePlayers;
  readonly monsters: Monsters;
  private readonly fx: Effects;
  private readonly particles: Particles;
  private readonly moveFx: MoveFx;
  private readonly post: PostFx;
  readonly helpers: HelperHub;
  readonly combat: CombatClient;
  private readonly skillbar: SkillBar;
  private readonly death: DeathOverlay;
  readonly ui: UiHub;
  private chat: ChatBox;
  readonly social: SocialHub;
  private readonly sun: THREE.DirectionalLight;
  private zone: ZoneScene | null = null;
  me: LocalPlayer | null = null;
  private loop: GameLoop;
  private lastSend = 0;
  private lastSentKey = '';
  private portalCooldown = 0;
  private interpDelay = getData<{ net: { interpDelayMs: number } }>('client').net.interpDelayMs;
  private readonly overlay: HTMLDivElement;
  private readonly aim = new THREE.Vector3();
  /** 슬로모션 남은 시간(실제 초) */
  private slowT = 0;

  constructor(private readonly mount: HTMLElement, ui: HTMLElement, private readonly onExit: () => void) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(this.renderer.domElement);
    const L = getData<{ light: LightData }>('client').light;
    this.sun = new THREE.DirectionalLight('#fff2dc', L.sun);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(L.shadowSize, L.shadowSize);
    Object.assign(this.sun.shadow.camera, { left: -L.shadowExtent, right: L.shadowExtent, top: L.shadowExtent, bottom: -L.shadowExtent, near: 1, far: 90 });
    this.sun.shadow.bias = -0.0006;
    this.scene.add(new THREE.HemisphereLight('#dfe8ff', '#5a5040', L.ambient), this.sun, this.sun.target);
    this.cam = new QuarterCamera(this.camera);
    this.input = new Input(this.renderer.domElement);
    this.plates = new Nameplates(ui, this.camera);
    this.hud = new Hud(ui);
    this.remotes = new RemotePlayers(this.scene, this.plates);
    this.remotes.delayFrames = Math.round((this.interpDelay / 1000) * 60);
    this.monsters = new Monsters(this.scene, this.plates, () => this.interpDelay);
    let numbers!: DamageNumbers;
    const bursts = getData<{ particles: Record<string, BurstSpec> }>('fx').particles;
    this.combat = new CombatClient({
      scene: this.scene, net: this.net, monsters: this.monsters, remotes: this.remotes, cam: this.cam,
      fx: (this.fx = new Effects(this.scene)), particles: (this.particles = new Particles(this.scene)), numbers: (numbers = new DamageNumbers(ui, this.camera)),
      bursts, me: () => this.me, zone: () => this.zone?.def ?? null,
      ally: (id) => !!this.social.ui.party?.members.some((p) => p.id === id),
    });
    this.remotes.onRemove = (r) => this.combat.forget(r.model);
    this.moveFx = new MoveFx(this.fx, this.particles, this.cam);
    this.monsters.onLand = (v, strong) => this.moveFx.land(v.pos.x, v.pos.z, strong);
    this.post = new PostFx(this.renderer, this.scene, this.camera);
    this.skillbar = new SkillBar(ui);
    this.death = new DeathOverlay(ui, (town) => this.net.send({ t: 'revive', town }));
    this.chat = new ChatBox(ui, (ch, text, to) => this.social.chat(ch, text, to) || this.net.send({ t: 'chat', ch, text, to }));
    this.ui = new UiHub(ui, (m) => this.net.send(m), (text) => this.chat.addHtml(text), () => this.zone);
    this.social = new SocialHub(ui, this.chat, this.remotes, (m) => this.net.send(m));
    this.ui.npcHandlers.guild = () => this.social.ui.guildWin.open();
    this.ui.quests.onChange = () => this.refreshNpcPlates();
    this.helpers = new HelperHub({
      ui, scene: this.scene, input: this.input, cam: this.cam, plates: this.plates, numbers, skillbar: this.skillbar,
      monsters: this.monsters, remotes: this.remotes, hub: this.ui, send: (m) => this.net.send(m), me: () => this.me,
    });
    new ScreenFx(ui);
    new BuffBar(ui);
    bus.on('slowmo', ({ scale, ms }) => {
      if (scale < this.loop.timeScale || this.slowT <= 0) this.loop.timeScale = scale;
      this.slowT = Math.max(this.slowT, ms / 1000);
    });
    this.monsters.onAttackFx = (v, a) => {
      if (a.fx === 'arrow') this.fx.arrow(v.pos.x, v.pos.z, v.yaw, a.range);
      else if (a.fx === 'wave') this.fx.wave(v.pos.x, v.pos.z, v.yaw, a.range, '#ffcf70');
      else if (a.heavy) this.fx.ring(v.pos.x, v.pos.z, 1.2, '#ff5040');
    };
    this.renderer.domElement.addEventListener('mousedown', (e) => {
      if (!this.zone || !this.me) return;
      const ndc = this.input.mouseNdc();
      if (e.button !== 0) return;
      if (this.ui.clickNpc(ndc, this.camera, this.zone.npcs) || this.ui.gathering.click(ndc, this.camera, this.me)) this.input.cancel('attack');
    });
    // 오른쪽 버튼은 끌면 카메라 회전, 짧게 누르면 플레이어 메뉴
    this.input.onRightTap = (x, y) => {
      if (this.zone && this.me) this.social.rightClick(this.input.mouseNdc(), this.camera, x, y);
    };
    new Audio();
    new Music();
    this.overlay = document.createElement('div');
    this.overlay.className = 'conn-overlay';
    ui.appendChild(this.overlay);
    window.addEventListener('resize', this.resize);
    this.resize();
    bus.on('net', (m) => this.onNet(m));
    bus.on('connection', ({ state, reason }) => {
      this.overlay.style.display = state === 'open' ? 'none' : '';
      this.overlay.innerHTML = state === 'connecting' ? '<div>접속 중…</div>'
        : `<div>${reason ?? '연결이 끊겼습니다.'}<br><button class="btn">캐릭터 선택으로</button></div>`;
      this.overlay.querySelector('button')?.addEventListener('click', () => this.exit());
    });
    this.loop = new GameLoop(60, this.update, this.render);
  }

  start(charId: number): void {
    this.net.connect(charId);
    this.social.connect(charId);
    this.loop.start();
  }

  private exit(): void {
    this.net.close();
    this.social.close();
    location.reload();
    this.onExit();
  }

  private onNet(m: S2C): void {
    switch (m.t) {
      case 'welcome': {
        this.loadZone(m.zone);
        this.remotes.clear();
        this.monsters.clear();
        if (this.me) {
          this.combat.forget(this.me.model);
          this.scene.remove(this.me.model.root);
          this.me.model.dispose();
        }
        const me = new LocalPlayer(m.you);
        me.onAction = (def, i) => this.net.send({ t: 'act', a: def.id, f: me.yaw, i });
        me.onFrame = (run) => this.combat.onPlayerFrame(me, run);
        this.me = me;
        this.scene.add(me.model.root);
        this.plates.add('self', me.model.root, 2.15, `${m.you.name}`, 'self');
        this.cam.snap(m.you.x, m.you.z);
        for (const p of m.players) this.remotes.add(p, m.time);
        for (const mo of m.monsters) this.monsters.add(mo, m.time);
        this.hud.setSelf(m.you);
        this.skillbar.bind(me);
        this.ui.bind(me);
        this.social.bind(me);
        this.death.hide();
        this.death.inTown = ZONES[m.zone]?.type === 'town';
        if (m.you.hp <= 0) me.die();
        this.portalCooldown = 1.5;
        break;
      }
      case 'snap':
        for (const row of m.p) if (row[0] !== this.me?.self.id) this.remotes.push(row, m.time);
        for (const row of m.m) this.monsters.push(row, m.time);
        break;
      case 'join':
        this.remotes.add(m.p, this.net.serverNow());
        break;
      case 'leave':
        this.remotes.remove(m.id);
        break;
      case 'pos':
        if (this.me?.pstate === 'dead') {
          this.me.revive(m.x, m.z);
          this.death.hide();
        } else this.me?.place(m.x, m.z);
        break;
      case 'me':
        if (this.me) {
          Object.assign(this.me.self, m.s);
          this.hud.setSelf(this.me.self);
        }
        break;
      case 'lvup':
        if (m.id !== this.me?.self.id) this.remotes.setLevel(m.id, m.lv);
        break;
      case 'mstatus':
        this.monsters.setStatus(m.id, m.s);
        break;
      case 'died':
        this.me?.die();
        this.death.show(m.wait);
        break;
      case 'cdfail':
        this.me?.cds.delete(m.a);
        break;
      case 'goto':
        this.overlay.style.display = '';
        this.overlay.innerHTML = `<div>${ZONES[m.zone]?.name ?? ''}(으)로 이동 중…</div>`;
        break;
    }
  }

  private loadZone(id: string): void {
    if (this.zone?.def.id === id) return;
    this.zone?.dispose();
    this.plates.clear('npc');
    this.plates.clear('portal');
    const def = ZONES[id];
    this.zone = new ZoneScene(def);
    this.zone.resize(this.mount.clientHeight || window.innerHeight, this.camera.fov, this.renderer.getPixelRatio());
    this.scene.add(this.zone.group);
    this.scene.background = new THREE.Color(def.sky);
    this.scene.fog = new THREE.Fog(def.sky, def.fog?.[0] ?? 38, def.fog?.[1] ?? 75);
    this.sun.color.set(def.sun ?? '#fff2dc');
    this.moveFx.setGround(def.ground);
    bus.emit('zoneTheme', { type: def.type, ambient: def.ambient });
    for (const n of this.zone.npcs) {
      this.plates.add(`npc${n.def.id}`, n.model.root, 2.15, `<span class="title">${n.def.title}</span>${n.def.name}`, 'npc');
    }
    for (const p of this.zone.portals) this.plates.add(`portal${p.def.id}`, p.ring, 3.4, p.def.label, 'portal', false, 80);
    this.hud.setZone(id);
    this.helpers.setZone(def);
    this.refreshNpcPlates();
  }

  /** NPC 이름표: 퀘스트 받을 것 !, 보고할 것 ? */
  private refreshNpcPlates(): void {
    for (const n of this.zone?.npcs ?? []) {
      this.plates.setHtml(`npc${n.def.id}`, `${this.ui.quests.markerFor(n.def.id)}<span class="title">${n.def.title}</span>${n.def.name}`);
    }
  }

  private update = (dt: number, frame: number): void => {
    this.input.beginTick();
    if (this.input.pressed.has('camreset')) this.cam.resetAngle();
    bus.emit('tick', { frame, dt });
    if (this.zone) this.ui.update(this.input, this.zone.npcs, this.zone.def.type === 'town', dt);
    this.social.update(this.input, dt);
    const me = this.me, zone = this.zone;
    if (!me || !zone) return;
    // 마우스가 가리키는 땅 쪽이 공격 방향
    const ndc = this.input.mouseNdc();
    if (this.cam.groundPoint(ndc.x, ndc.y, this.aim)) me.aimYaw = this.helpers.assist.aim(me, Math.atan2(this.aim.x - me.pos.x, this.aim.z - me.pos.z), this.monsters);
    this.helpers.update(dt, me, zone.def);
    const frozen = this.combat.frozen();
    if (!frozen) me.update(dt, this.input, zone.def);
    else me.prev.copy(me.pos);
    this.monsters.step(dt, zone.def, frozen);
    this.combat.step();
    this.checkPortal(dt);
    this.sendMove();
  };

  private checkPortal(dt: number): void {
    const me = this.me!, zone = this.zone!;
    this.portalCooldown -= dt;
    if (this.portalCooldown > 0 || me.pstate === 'dead') return;
    for (const p of zone.def.portals) {
      if (dist2(me.pos.x, me.pos.z, p.x, p.z) < p.r * p.r) {
        this.portalCooldown = 3;
        this.sendMove(true);
        this.net.send({ t: 'portal', id: p.id });
        return;
      }
    }
  }

  /** 10Hz로 내 위치를 보낸다(변화가 없으면 1초마다) */
  private sendMove(force = false): void {
    const me = this.me!;
    if (me.pstate === 'dead') return;
    const now = performance.now();
    const key = `${me.pos.x.toFixed(2)},${me.pos.z.toFixed(2)},${me.pos.y.toFixed(1)},${me.yaw.toFixed(2)},${me.state}`;
    if (!force && (now - this.lastSend < 1000 / MOVE_SEND_HZ || (key === this.lastSentKey && now - this.lastSend < 1000))) return;
    this.lastSend = now;
    this.lastSentKey = key;
    this.net.send({ t: 'move', x: me.pos.x, z: me.pos.z, y: me.pos.y, f: me.yaw, st: me.state });
  }

  private render = (alpha: number, dt: number): void => {
    const me = this.me;
    this.cam.zoomBy(this.input.consumeWheel());
    const drag = this.input.consumeDrag();
    this.cam.rotateBy(drag.dx);
    this.cam.tiltBy(drag.dy);
    this.input.viewYaw = this.cam.theta;
    if (me) {
      me.render(this.combat.frozen() ? 1 : alpha, dt);
      this.cam.update(me.model.root.position, dt);
      const p = me.model.root.position;
      this.sun.position.set(p.x + 14, 26, p.z + 10);
      this.sun.target.position.set(p.x, 0, p.z);
    }
    this.zone?.update(dt, this.camera.position, me?.model.root.position);
    const renderTime = this.net.serverNow() - this.interpDelay;
    this.remotes.render(renderTime, dt);
    // 슬로모션 중에는 연출·몬스터 동작도 느리게(위치는 서버 시간 그대로)
    if (this.slowT > 0) {
      this.slowT -= dt;
      if (this.slowT <= 0) this.loop.timeScale = 1;
    }
    const sdt = dt * this.loop.timeScale;
    this.monsters.render(renderTime, sdt);
    this.combat.render(sdt);
    this.helpers.render(dt, me);
    this.plates.render();
    this.skillbar.render();
    this.hud.setNet(this.net.rtt, this.remotes.list.size + 1, this.social.ui.online);
    if (me) this.moveFx.update(dt, me.model.root.position, me.pstate !== 'dead');
    this.post.render();
  };

  private resize = (): void => {
    const w = this.mount.clientWidth || window.innerWidth;
    const h = this.mount.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.post?.resize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.particles.resize(h, this.camera.fov, this.renderer.getPixelRatio());
    this.zone?.resize(h, this.camera.fov, this.renderer.getPixelRatio());
  };
}
