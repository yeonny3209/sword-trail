import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { bus } from '../core/bus';
import { settings } from '../core/Settings';

/**
 * 후처리: 밝은 부분(번쩍임·불꽃·검기·수정)이 은은하게 번진다(블룸).
 * 설정의 '빛 번짐' 또는 F4로 끄고 켠다(느린 컴퓨터에서 끄면 빨라짐).
 */
export class PostFx {
  private readonly composer: EffectComposer;
  private on = settings.v.bloom;

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly scene: THREE.Scene, private readonly camera: THREE.Camera) {
    this.composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
    this.composer.addPass(new RenderPass(scene, camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(512, 512), 0.55, 0.6, 0.92));
    this.composer.addPass(new OutputPass());
    bus.on('settingsChanged', ({ settings: s }) => (this.on = s.bloom));
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'F4') return;
      e.preventDefault();
      settings.set('bloom', !settings.v.bloom);
      bus.emit('toast', { text: settings.v.bloom ? '빛 번짐 효과 켬 (F4)' : '빛 번짐 효과 끔 (F4) — 느린 컴퓨터에서 끄면 빨라집니다', kind: 'info' });
    });
  }

  render(): void {
    if (this.on) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  resize(w: number, h: number): void {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
  }
}
