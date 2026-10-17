import { bus } from '../core/bus';
import { settings } from '../core/Settings';
import { monsterGoal } from '../../shared/guide';
import type { C2S } from '../../shared/protocol';
import type { ZoneDef } from '../../shared/types';
import type { Input } from '../input/Input';
import { AchWindow } from '../ui/AchWindow';
import { DamageMeter } from '../ui/DamageMeter';
import type { DamageNumbers } from '../ui/DamageNumbers';
import { HelpOverlay } from '../ui/HelpOverlay';
import { BossBar, Minimap, type MapDot } from '../ui/Minimap';
import type { Nameplates } from '../ui/Nameplates';
import { SettingsWindow } from '../ui/SettingsWindow';
import type { SkillBar } from '../ui/SkillBar';
import { TargetFrame } from '../ui/TargetFrame';
import { Toast } from '../ui/Toast';
import { TowerHud } from '../ui/TowerHud';
import { WorldMap } from '../ui/WorldMap';
import { Assist } from './Assist';
import { AutoPilot } from './AutoPilot';
import type { LocalPlayer } from './LocalPlayer';
import type { Monsters } from './Monsters';
import type { QuarterCamera } from './QuarterCamera';
import type { RemotePlayers } from './RemotePlayers';
import type { UiHub } from './UiHub';
import type * as THREE from 'three';

export interface HelperCtx {
  ui: HTMLElement;
  scene: THREE.Scene;
  input: Input;
  cam: QuarterCamera;
  plates: Nameplates;
  numbers: DamageNumbers;
  skillbar: SkillBar;
  monsters: Monsters;
  remotes: RemotePlayers;
  hub: UiHub;
  send: (m: C2S) => void;
  me: () => LocalPlayer | null;
}

/**
 * 편의 기능 묶음: 설정 창·조작법·알림, 큰 지도와 자동 이동·퀘스트 길 안내, 전투 도우미(자동 물약·조준 보조·마을 귀환),
 * 대상 정보창, 피해량 측정기, 시련의 탑 상태판, 업적·칭호·현상 수배 창, 미니맵·보스 체력 바.
 */
export class HelperHub {
  readonly settingsWin: SettingsWindow;
  readonly help: HelpOverlay;
  readonly map: WorldMap;
  readonly pilot: AutoPilot;
  readonly assist: Assist;
  readonly target: TargetFrame;
  readonly meter: DamageMeter;
  readonly ach: AchWindow;
  private readonly minimap: Minimap;
  private readonly bossBar: BossBar;
  private zone: ZoneDef | null = null;

  constructor(private readonly c: HelperCtx) {
    new Toast(c.ui);
    new TowerHud(c.ui);
    this.settingsWin = new SettingsWindow(c.ui);
    this.help = new HelpOverlay(c.ui);
    this.map = new WorldMap(c.ui);
    this.minimap = new Minimap(c.ui);
    this.bossBar = new BossBar(c.ui);
    this.pilot = new AutoPilot(c.input, c.scene, () => c.hub.quests.qs, (id) => c.hub.invWin.count(id));
    this.map.onPick = (x, z) => this.zone && this.pilot.goTo(this.zone.id, x, z);
    this.assist = new Assist(c.ui, c.send, (k) => c.hub.potionCount(k));
    this.target = new TargetFrame(c.ui, c.monsters);
    this.meter = new DamageMeter(c.ui);
    this.meter.names = (id) => {
      const me = c.me();
      if (me?.self.id === id) return { name: me.self.name, cls: me.self.cls };
      const r = c.remotes.list.get(id);
      return r ? { name: r.info.name, cls: r.info.cls } : null;
    };
    this.ach = new AchWindow(c.ui, c.send);
    this.ach.onGuide = (mon) => {
      const g = monsterGoal(mon);
      if (g) this.pilot.goTo(g.zone, g.x, g.z, g.label);
    };
    c.hub.npcHandlers.bounty = () => this.ach.openTab('bounty');
    // Esc: 창이 없으면 큰 지도·조작법을 닫고, 그것도 없으면 설정 창
    c.hub.onEscIdle = () => {
      if (this.map.isOpen) this.map.toggle(false);
      else if (this.help.isOpen) this.help.toggle(false);
      else this.settingsWin.open();
    };
    bus.on('settingsChanged', ({ settings: s }) => {
      c.cam.shakeScale = s.shake;
      c.numbers.enabled = s.damageNumbers;
      c.plates.setNames(s.showNames);
      c.skillbar.alert = s.cdAlert;
    });
    settings.emit();
  }

  setZone(def: ZoneDef): void {
    this.zone = def;
    this.minimap.setZone(def);
    this.map.setZone(def);
    this.pilot.onZone();
  }

  /** 고정 단계: 단축키, 자동 이동, 전투 도우미 */
  update(dt: number, me: LocalPlayer, zone: ZoneDef): void {
    const i = this.c.input;
    if (i.pressed.has('map')) this.map.toggle();
    if (i.pressed.has('help')) this.help.toggle();
    if (i.pressed.has('settings')) this.settingsWin.toggle();
    if (i.pressed.has('meter')) this.meter.toggle();
    if (i.pressed.has('achieve')) this.ach.toggle();
    this.ach.lv = me.self.lv;
    this.pilot.update(dt, me, zone);
    // 자동 이동은 달리기로
    if (this.pilot.active && i.auto) me.dashing = true;
    this.assist.update(dt, i, me, this.pilot.active);
  }

  /** 렌더 프레임: 지도·대상·측정기 */
  render(dt: number, me: LocalPlayer | null): void {
    this.meter.render(dt);
    const z = this.zone;
    if (!me || !z) return;
    this.target.render(me.self.lv);
    const dots: MapDot[] = [];
    let boss: { name: string; lv: number; hp: number; mhp: number; d: number } | null = null;
    for (const v of this.c.monsters.list.values()) {
      if (v.dying) continue;
      dots.push({ x: v.pos.x, z: v.pos.z, kind: v.def.boss || v.def.elite ? 'boss' : 'monster' });
      if (v.def.boss) {
        const d = Math.hypot(v.pos.x - me.pos.x, v.pos.z - me.pos.z);
        if (d < (v.def.raid ? 90 : 30) && (!boss || d < boss.d)) boss = { name: v.def.name, lv: v.def.lv, hp: v.hp, mhp: v.mhp, d };
      }
    }
    for (const r of this.c.remotes.list.values()) dots.push({ x: r.model.root.position.x, z: r.model.root.position.z, kind: 'player' });
    for (const n of z.npcs) dots.push({ x: n.x, z: n.z, kind: 'npc' });
    const view = { x: me.pos.x, z: me.pos.z, yaw: me.yaw };
    const nodes = this.c.hub.gathering.upNodes();
    for (const n of nodes) dots.push({ x: n.x, z: n.z, kind: 'node' });
    this.minimap.render(dt, view, dots, this.c.cam.theta);
    this.map.render(dt, view, dots, this.pilot.here);
    if (boss) this.bossBar.show(boss.name, boss.lv, boss.hp, boss.mhp);
    else this.bossBar.hide();
  }
}
