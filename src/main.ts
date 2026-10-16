import { bus } from './core/bus';
import { GameClient } from './game/GameClient';
import { savedToken } from './net/api';
import { CharSelect } from './ui/CharSelect';
import { LoginScreen } from './ui/LoginScreen';
import './ui/style.css';

const mount = document.getElementById('app')!;
const ui = document.getElementById('ui')!;
let game: GameClient | null = null;

function showLogin(): void {
  new LoginScreen(ui, showCharSelect);
}

function showCharSelect(): void {
  new CharSelect(ui, enterGame, showLogin);
}

function enterGame(charId: number): void {
  game = new GameClient(mount, ui, showCharSelect);
  game.start(charId);
  if (import.meta.env.DEV) Object.assign(window, { __game: game, __bus: bus });
}

if (savedToken()) showCharSelect();
else showLogin();
