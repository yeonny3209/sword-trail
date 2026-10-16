import { bus } from './bus';
import { getData } from './config';

export interface DifficultyLevel {
  name: string;
  enemyDamage: number;
  enemyPosture: number;
  enemyAttackSpeed: number;
  enemyCooldown: number;
  enemyHp: number;
  bossHp: number;
}

const data = getData<{ default: string; levels: Record<string, DifficultyLevel> }>('difficulty');

/** 현재 난이도 배율. 설정이 바뀌면 이벤트로 갱신된다. */
export const difficulty = { level: data.default, ...data.levels[data.default] } as DifficultyLevel & { level: string };

bus.on('settingsChanged', ({ settings }) => {
  const key = settings.difficulty in data.levels ? settings.difficulty : data.default;
  Object.assign(difficulty, { level: key }, data.levels[key]);
});

export const difficultyNames = Object.fromEntries(Object.entries(data.levels).map(([k, v]) => [k, v.name]));
