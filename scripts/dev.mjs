// 로컬 개발: D1 마이그레이션 → wrangler dev(:8787) + vite(:5173)를 함께 실행
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const opts = { stdio: 'inherit', shell: process.platform === 'win32' };
if (!existsSync('dist')) mkdirSync('dist');
if (!existsSync('dist/index.html')) writeFileSync('dist/index.html', '<!doctype html><title>dev</title>');
spawnSync(npx, ['wrangler', 'd1', 'migrations', 'apply', 'sword-trail-online', '--local'], opts);
const server = spawn(npx, ['wrangler', 'dev', '--port', '8787', '--local'], opts);
const client = spawn(npx, ['vite'], opts);
const stop = () => { server.kill(); client.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('exit', stop);
client.on('exit', stop);
