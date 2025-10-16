import { Hono } from 'hono';
import { handle } from 'hono/vercel';

export const config = {
  runtime: 'nodejs20.x',
  maxDuration: 60
};

const app = new Hono();

let wasmCache = {
  url: null,
  buffer: null,
  timestamp: 0
};

const CACHE_TTL = 3600000;

async function getWasmUrl() {
  const now = Date.now();
  if (wasmCache.url && now - wasmCache.timestamp < CACHE_TTL) return wasmCache.url;
  const html = await fetch('https://chat.deepseek.com/', { headers: { 'User-Agent': 'Mozilla/5.0' } }).then(r => r.text());
  const mainJs = html.match(/https:\/\/static\.deepseek\.com\/chat\/static\/main\.[a-z0-9]+\.js/)?.[0];
  if (!mainJs) throw new Error('Main JS not found');
  const js = await fetch(mainJs).then(r => r.text());
  const wasm = js.match(/"([^"]+\.wasm)"/)?.[1];
  if (!wasm) throw new Error('WASM not found');
  const wasmUrl = new URL(wasm, 'https://static.deepseek.com/chat/').href;
  wasmCache.url = wasmUrl;
  wasmCache.timestamp = now;
  return wasmUrl;
}

async function loadWasm() {
  const now = Date.now();
  if (wasmCache.buffer && now - wasmCache.timestamp < CACHE_TTL) return wasmCache.buffer;
  const url = await getWasmUrl();
  const res = await fetch(url);
  if (!res.ok) throw new Error('WASM fetch failed');
  const buffer = await res.arrayBuffer();
  wasmCache.buffer = buffer;
  wasmCache.timestamp = now;
  return buffer;
}

app.get('/wasm/url', async c => {
  try {
    const url = await getWasmUrl();
    return c.json({ success: true, url });
  } catch (err) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

app.get('/wasm/binary', async c => {
  try {
    const buffer = await loadWasm();
    return new Response(buffer, { headers: { 'Content-Type': 'application/wasm', 'Cache-Control': 'public, max-age=3600' } });
  } catch (err) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

export default handle(app);
