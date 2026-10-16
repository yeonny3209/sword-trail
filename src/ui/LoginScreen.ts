import { auth, savedAccount } from '../net/api';

/** 로그인·회원가입 화면 */
export class LoginScreen {
  readonly el: HTMLDivElement;

  constructor(parent: HTMLElement, private readonly onDone: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'screen login-screen';
    this.el.innerHTML = `
      <div class="logo"><h1>검의 궤적</h1><div class="online">ONLINE</div></div>
      <p class="sub">부러진 검들이 묻힌 산 — 함께 오르는 검사들의 이야기</p>
      <form class="panel login-form">
        <label>아이디<input name="name" autocomplete="username" maxlength="12" placeholder="한글·영문·숫자 2~12자"></label>
        <label>비밀번호<input name="password" type="password" autocomplete="current-password" maxlength="64" placeholder="4자 이상"></label>
        <div class="err"></div>
        <div class="row">
          <button class="btn primary" data-kind="login">로그인</button>
          <button class="btn" data-kind="register">회원가입</button>
        </div>
      </form>
      <p class="hint">처음이면 아이디와 비밀번호를 정하고 <b>회원가입</b>을 누르세요.</p>`;
    parent.appendChild(this.el);
    const form = this.el.querySelector('form')!;
    const name = form.querySelector<HTMLInputElement>('input[name=name]')!;
    const pw = form.querySelector<HTMLInputElement>('input[name=password]')!;
    const err = form.querySelector<HTMLDivElement>('.err')!;
    name.value = savedAccount();
    form.addEventListener('submit', (e) => e.preventDefault());
    for (const btn of form.querySelectorAll<HTMLButtonElement>('button')) {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        err.textContent = '';
        form.classList.add('busy');
        try {
          await auth(btn.dataset.kind as 'login' | 'register', name.value.trim(), pw.value);
          this.hide();
          this.onDone();
        } catch (ex) {
          err.textContent = (ex as Error).message;
        } finally {
          form.classList.remove('busy');
        }
      });
    }
    setTimeout(() => (name.value ? pw : name).focus(), 50);
  }

  hide(): void {
    this.el.remove();
  }
}
