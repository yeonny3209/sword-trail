/** data/ 폴더의 모든 JSON을 빌드 시점에 읽어 둔다. getData('attacks/light') 처럼 사용. */
const files = import.meta.glob('../../data/**/*.json', { eager: true, import: 'default' });

const table = new Map<string, unknown>();
for (const [path, value] of Object.entries(files)) {
  const key = path.replace(/^.*\/data\//, '').replace(/\.json$/, '');
  table.set(key, value);
}

export function getData<T>(key: string): T {
  const v = table.get(key);
  if (v === undefined) throw new Error(`data/${key}.json 이 없습니다`);
  return v as T;
}

export function hasData(key: string): boolean {
  return table.has(key);
}

export function listData(prefix: string): string[] {
  return [...table.keys()].filter((k) => k.startsWith(prefix));
}
