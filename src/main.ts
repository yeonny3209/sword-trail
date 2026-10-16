import { Game } from './core/Game';
import { bus } from './core/bus';

const game = new Game(document.getElementById('app')!, document.getElementById('ui')!);
if (import.meta.env.DEV) Object.assign(window, { __game: game, __bus: bus });
game.start().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;top:0;color:#f66">${String(e)}</pre>`);
});
