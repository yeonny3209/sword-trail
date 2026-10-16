import { getData } from '../core/config';

/**
 * 공격 토큰: 동시에 플레이어를 공격할 수 있는 적 수를 제한한다.
 * 토큰이 없는 적은 주변을 돌며 위협만 한다.
 */
export class TokenManager {
  readonly max = getData<{ maxAttackers: number }>('enemies/tokens').maxAttackers;
  private holders = new Set<number>();

  request(id: number): boolean {
    if (this.holders.has(id)) return true;
    if (this.holders.size >= this.max) return false;
    this.holders.add(id);
    return true;
  }

  release(id: number): void {
    this.holders.delete(id);
  }

  get count(): number {
    return this.holders.size;
  }

  clear(): void {
    this.holders.clear();
  }
}
