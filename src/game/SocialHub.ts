import * as THREE from 'three';
import { bus } from '../core/bus';
import { MoveState, type ChatChannel, type C2S } from '../../shared/protocol';
import type { Input } from '../input/Input';
import { SocialConnection } from '../net/Social';
import type { ChatBox } from '../ui/ChatBox';
import { SocialUi } from '../ui/SocialUi';
import type { LocalPlayer } from './LocalPlayer';
import type { RemotePlayers } from './RemotePlayers';

/**
 * 소셜 연결과 화면을 게임에 잇는다: 채팅 채널 나누기, 내 위치·레벨 알리기,
 * 다른 플레이어 오른쪽 클릭 메뉴, 파티 프레임 체력, 길드 이름표.
 */
export class SocialHub {
  readonly conn = new SocialConnection();
  readonly ui: SocialUi;
  private readonly ray = new THREE.Raycaster();
  private me: LocalPlayer | null = null;
  private zone = '';
  private hpTimer = 0;
  /** 쓰러진 파티원 곁에 서면 뜨는 안내(스페이스로 살림) */
  private readonly raiseEl: HTMLDivElement;

  constructor(ui: HTMLElement, chat: ChatBox, private readonly remotes: RemotePlayers, private readonly sendZone: (m: C2S) => void) {
    this.raiseEl = document.createElement('div');
    this.raiseEl.className = 'act-prompt raise';
    this.raiseEl.style.display = 'none';
    ui.appendChild(this.raiseEl);
    this.ui = new SocialUi(ui, (m) => this.conn.send(m), sendZone);
    this.ui.hpOf = (id) => {
      if (id === this.me?.self.id) return this.me.self.hp / this.me.self.mhp;
      const r = this.remotes.list.get(id);
      return r ? r.info.hp / r.info.mhp : null;
    };
    bus.on('social', (m) => {
      if (m.t === 'chat') chat.add(m.ch, m.from, m.text);
      else if (m.t === 'sys' || m.t === 'err') chat.add('system', '', m.text);
    });
    chat.onCommand = (cmd, arg) => this.command(cmd, arg);
    bus.on('net', (m) => {
      if (m.t === 'welcome') {
        this.zone = m.zone;
        this.ui.myId = m.you.id;
        this.where(m.you.lv);
      } else if (m.t === 'lvup' && m.id === this.me?.self.id) this.where(m.lv);
      else if (m.t === 'pinfo') this.remotes.setInfo(m.p);
      else if (m.t === 'treq') this.ui.popup(`<b>${m.name}</b>님이 거래를 신청했습니다.`, (ok) => this.sendZone({ t: 'tans', id: m.from, ok }));
    });
  }

  connect(charId: number): void {
    this.conn.connect(charId);
  }

  close(): void {
    this.conn.close();
  }

  bind(me: LocalPlayer): void {
    this.me = me;
  }

  private where(lv: number): void {
    this.conn.send({ t: 'where', zone: this.zone, lv });
  }

  /** 존 채팅은 존 서버로, 나머지는 소셜 서버로 */
  chat(ch: ChatChannel, text: string, to?: string): boolean {
    if (ch === 'zone' || ch === 'system') return false;
    this.conn.send({ t: 'chat', ch, text, to });
    return true;
  }

  /** 채팅 명령: /초대 이름, /파티나가기, /길드초대 이름 */
  private command(cmd: string, arg: string): boolean {
    switch (cmd) {
      case '초대': case 'invite': this.ui.invite(arg.trim()); return true;
      case '파티나가기': case '탈퇴': this.conn.send({ t: 'pleave' }); return true;
      case '길드초대': this.conn.send({ t: 'ginvite', name: arg.trim() }); return true;
    }
    return false;
  }

  /** 다른 플레이어를 오른쪽 클릭하면 메뉴 */
  rightClick(ndc: { x: number; y: number }, camera: THREE.Camera, sx: number, sy: number): boolean {
    this.ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
    const roots = [...this.remotes.list.values()].map((r) => r.model.root);
    const hit = this.ray.intersectObjects(roots, true)[0];
    if (!hit) return false;
    for (const r of this.remotes.list.values()) {
      let o: THREE.Object3D | null = hit.object;
      while (o && o !== r.model.root) o = o.parent;
      if (o) {
        const id = r.info.id;
        this.ui.playerMenu(r.info.name, sx, sy, [['거래 신청', () => this.sendZone({ t: 'treq', id })]]);
        return true;
      }
    }
    return false;
  }

  /** 가까이(4.5m)에 쓰러진 파티원 한 명 */
  private deadAlly(): { id: number; name: string } | null {
    const me = this.me;
    const party = this.ui.party;
    if (!me || !party || me.pstate === 'dead') return null;
    for (const pm of party.members) {
      const r = this.remotes.list.get(pm.id);
      if (!r || (r.st !== MoveState.Dead && r.info.hp > 0)) continue;
      const p = r.model.root.position;
      if (Math.hypot(p.x - me.pos.x, p.z - me.pos.z) <= 4.5) return { id: pm.id, name: pm.name };
    }
    return null;
  }

  update(input: Input, dt: number): void {
    const dead = this.deadAlly();
    this.raiseEl.style.display = dead ? '' : 'none';
    if (dead) {
      this.raiseEl.innerHTML = `<b>Space</b> 살리기: ${dead.name}`;
      if (input.pressed.has('jump')) {
        input.pressed.delete('jump');
        this.sendZone({ t: 'raise', id: dead.id });
      }
    }
    if (input.pressed.has('party')) this.ui.partyWin.toggle();
    if (input.pressed.has('guild')) this.ui.guildWin.toggle();
    this.hpTimer -= dt;
    if (this.hpTimer <= 0) {
      this.hpTimer = 0.25;
      this.ui.updateParty();
    }
  }
}
