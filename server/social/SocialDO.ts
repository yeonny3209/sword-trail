import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';

/**
 * 존을 넘나드는 기능(전체 채팅, 귓속말, 파티, 길드, 접속자 목록)을 맡는 단일 DO.
 * 단계 M6에서 채운다.
 */
export class SocialDO extends DurableObject<Env> {
  async fetch(): Promise<Response> {
    return new Response('social: not ready', { status: 503 });
  }
}
