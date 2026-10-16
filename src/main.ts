import { Game } from './core/Game';

const game = new Game(document.getElementById('app')!, document.getElementById('ui')!);
if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = game;
game.start().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;top:0;color:#f66">${String(e)}</pre>`);
});
