import * as THREE from 'three';
import { bus } from '../core/bus';
import { ITEMS, itemName, rarityColor, rarityName } from '../../shared/items';
import type { C2S, S2C } from '../../shared/protocol';
import type { NpcDef } from '../../shared/types';
import type { Input } from '../input/Input';
import { CharacterWindow, SkillWindow, Window } from '../ui/CharWindows';
import { InventoryWindow } from '../ui/InventoryWindow';
import { ShopWindow, SmithWindow } from '../ui/NpcWindows';
import { QuestUi } from '../ui/QuestUi';
import { AuctionWindow, MailWindow } from '../ui/MarketWindows';
import { TradeWindow } from '../ui/TradeWindow';
import { QUESTS } from '../../shared/quests';
import type { LocalPlayer } from './LocalPlayer';
import type { NpcView, ZoneScene } from './ZoneScene';
import { Gathering } from './Gathering';

const TALK_RANGE = 3.2;

/**
 * 게임 창 묶음(캐릭터·스킬·인벤토리·상점·대장간)과 NPC 대화.
 * 서버 메시지 중 창에 관련된 것을 받아 갱신한다.
 */
export class UiHub {
  readonly charWin: CharacterWindow;
  readonly skillWin: SkillWindow;
  readonly invWin: InventoryWindow;
  readonly shopWin: ShopWindow;
  readonly smithWin: SmithWindow;
  readonly quests: QuestUi;
  readonly auctionWin: AuctionWindow;
  readonly mailWin: MailWindow;
  readonly tradeWin: TradeWindow;
  /** NPC를 만났을 때 처리할 역할(이후 단계: 퀘스트·경매장·길드·우편 등) */
  readonly npcHandlers: Partial<Record<NpcDef['role'], (n: NpcDef) => void>> = {};
  private readonly ray = new THREE.Raycaster();
  private readonly potBar: HTMLDivElement;
  private readonly prompt: HTMLDivElement;
  readonly gathering: Gathering;
  private me: LocalPlayer | null = null;

  constructor(ui: HTMLElement, private readonly send: (m: C2S) => void, private readonly say: (text: string) => void, zone: () => ZoneScene | null) {
    this.gathering = new Gathering(ui, send, say, zone);
    this.prompt = document.createElement('div');
    this.prompt.className = 'act-prompt';
    ui.appendChild(this.prompt);
    this.charWin = new CharacterWindow(ui, send);
    this.skillWin = new SkillWindow(ui, send);
    this.invWin = new InventoryWindow(ui, send);
    this.shopWin = new ShopWindow(ui, send, this.invWin);
    this.smithWin = new SmithWindow(ui, send, this.invWin);
    this.npcHandlers.shop = (n) => this.shopWin.openShop(n.id, n.ref ?? 'general');
    this.npcHandlers.smith = () => this.smithWin.openSmith();
    this.smithWin.lv = () => this.me?.self.lv ?? 1;
    this.auctionWin = new AuctionWindow(ui, send, this.invWin);
    this.mailWin = new MailWindow(ui, send, this.invWin);
    this.tradeWin = new TradeWindow(ui, send, this.invWin, say);
    this.tradeWin.onOpen = () => [this.auctionWin, this.mailWin, this.shopWin, this.smithWin].forEach((w) => w.isOpen && w.close());
    this.npcHandlers.auction = () => this.auctionWin.openAuction();
    this.npcHandlers.mail = () => this.mailWin.openMail();
    this.quests = new QuestUi(ui, send);
    this.quests.count = (id) => this.invWin.count(id);
    this.npcHandlers.quest = (n) => this.quests.openGiver(n.id, n.name);
    this.potBar = document.createElement('div');
    this.potBar.className = 'potbar';
    ui.appendChild(this.potBar);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') Window.closeTop();
    });
    bus.on('net', (m) => this.onNet(m));
  }

  bind(me: LocalPlayer): void {
    this.me = me;
    this.charWin.me = me.self;
    this.skillWin.me = me.self;
    this.quests.lv = me.self.lv;
  }

  private onNet(m: S2C): void {
    switch (m.t) {
      case 'quests':
        this.quests.set(m.q);
        break;
      case 'crafted':
        this.smithWin.onCrafted(m.id, m.n, m.rar);
        this.say(`제작 완료: ${ITEMS[m.id]?.name ?? m.id}${m.n > 1 ? ` ${m.n}개` : ''}`);
        bus.emit('sfx', { key: 'gate' });
        break;
      case 'mailnew':
        this.say(`📬 읽지 않은 우편이 <b>${m.n}통</b> 있습니다. 마을의 우체부 고미에게 가 보세요.`);
        break;
      case 'qdone':
        this.say(`<b>퀘스트 완료: ${QUESTS[m.id]?.name ?? m.id}</b>`);
        bus.emit('sfx', { key: 'gate' });
        break;
      case 'me':
        if (this.me && m.s.lv) this.quests.lv = m.s.lv;
        this.quests.refresh();
        this.charWin.draw();
        this.skillWin.draw();
        if (m.s.gold !== undefined) {
          this.invWin.gold = m.s.gold;
          this.invWin.draw();
          this.smithWin.draw();
        }
        break;
      case 'inv':
        this.invWin.set(m.inv, m.equip, m.gold);
        this.smithWin.draw();
        this.drawPots();
        this.quests.refresh();
        break;
      case 'loot':
        for (const it of m.items) {
          const d = ITEMS[it.id];
          if (d?.kind === 'equip') {
            this.say(`<span style="color:${rarityColor(it.rar)}">[${rarityName(it.rar)}] ${d.name}</span>을(를) 얻었습니다!`);
            if ((it.rar ?? 0) >= 2) bus.emit('sfx', { key: 'gate' });
          } else this.say(`${d?.name ?? it.id} ${it.n}개를 얻었습니다.`);
        }
        break;
      case 'enh': {
        this.smithWin.onResult(m.ok, m.enh);
        bus.emit('sfx', { key: m.ok ? 'gate' : 'block' });
        const it = [...this.invWin.inv, ...Object.values(this.invWin.equip)].find((x) => x?.uid === m.uid);
        if (it) this.say(m.ok ? `강화 성공! ${itemName({ ...it, enh: m.enh })}` : `강화 실패… (+${m.enh})`);
        break;
      }
    }
  }

  private drawPots(): void {
    const hp = this.invWin.inv.filter((s) => ITEMS[s.id]?.heal?.hp).reduce((a, s) => a + s.n, 0);
    const mp = this.invWin.inv.filter((s) => ITEMS[s.id]?.heal?.mp).reduce((a, s) => a + s.n, 0);
    this.potBar.innerHTML = `<div class="pot"><span class="k">C</span>🧪<b>${hp}</b></div><div class="pot"><span class="k">V</span>💧<b>${mp}</b></div>`;
  }

  /** 고정 단계마다: 단축키 창 열기, 물약, 스페이스로 NPC 대화(마을)·채집 */
  update(input: Input, npcs: NpcView[], town: boolean, dt = 1 / 60): void {
    if (input.pressed.has('character')) this.charWin.toggle();
    if (input.pressed.has('skills')) this.skillWin.toggle();
    if (input.pressed.has('inventory')) this.invWin.toggle();
    if (input.pressed.has('quests')) this.quests.win.toggle();
    if (input.pressed.has('pot1')) this.send({ t: 'pot', k: 1 });
    if (input.pressed.has('pot2')) this.send({ t: 'pot', k: 2 });
    const me = this.me;
    if (!me) return;
    this.gathering.update(dt, me);
    const npc = town ? this.nearest(npcs, me.pos.x, me.pos.z) : null;
    const node = npc ? null : this.gathering.nearest(me.pos.x, me.pos.z);
    const text = npc ? `대화: ${npc.name}` : node && !this.gathering.busy ? `채집: ${this.gathering.nodeName(node)}` : '';
    this.prompt.innerHTML = text ? `<b>Space</b> ${text}` : '';
    this.prompt.style.display = text ? '' : 'none';
    if (!input.pressed.has('jump')) return;
    if (npc) {
      input.pressed.delete('jump');
      this.talk(npc);
    } else if (node) {
      input.pressed.delete('jump');
      this.gathering.start(node, me);
    }
  }

  private nearest(npcs: NpcView[], x: number, z: number): NpcDef | null {
    let best: NpcDef | null = null, bd = TALK_RANGE * TALK_RANGE;
    for (const n of npcs) {
      const d = (n.def.x - x) ** 2 + (n.def.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = n.def;
      }
    }
    return best;
  }

  /** 클릭한 곳에 NPC가 있으면 대화(가까우면) */
  clickNpc(ndc: { x: number; y: number }, camera: THREE.Camera, npcs: NpcView[]): boolean {
    this.ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
    const hit = this.ray.intersectObjects(npcs.map((n) => n.model.root), true)[0];
    if (!hit) return false;
    const view = npcs.find((n) => { let o: THREE.Object3D | null = hit.object; while (o) { if (o === n.model.root) return true; o = o.parent; } return false; });
    if (!view || !this.me) return false;
    if ((view.def.x - this.me.pos.x) ** 2 + (view.def.z - this.me.pos.z) ** 2 > (TALK_RANGE * 2) ** 2) {
      this.say('조금 더 가까이 가야 합니다.');
      return true;
    }
    this.talk(view.def);
    return true;
  }

  talk(n: NpcDef): void {
    const line = n.lines?.[Math.floor(Math.random() * n.lines.length)];
    if (line) this.say(`<b>${n.name}</b>: ${line}`);
    bus.emit('sfx', { key: 'ui' });
    const h = this.npcHandlers[n.role];
    if (h) h(n);
    else this.say(`(${n.title} 기능은 곧 열립니다)`);
  }
}
