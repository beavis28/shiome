// 手元（Node）で動かすときの入口。`npm run dev` から起動される。
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { api, config } from './app.ts';
import { setCacheStore } from './cache.ts';

// 永続キャッシュはローカルの .cache/ に保存
const DIR = path.resolve(process.cwd(), '.cache');
const file = (key: string) => path.join(DIR, crypto.createHash('sha1').update(key).digest('hex') + '.json');
setCacheStore({
  async get(key) {
    try {
      return fs.readFileSync(file(key), 'utf8');
    } catch {
      return null;
    }
  },
  async put(key, value) {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(file(key), value);
  },
});

const app = new Hono().route('/api', api);
const port = Number(process.env.API_PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => {
  const c = config();
  console.log(
    `API server http://localhost:${port}  ${c.demo ? 'DEMO ' : ''}Yahoo:on FMP:${c.fmp ? 'on' : 'off'} FRED:${c.fred ? 'on' : 'off'} Claude:${c.anthropic ? 'on' : 'off'}`,
  );
});
