import { Hono } from 'hono';
import { handle } from 'hono/vercel';
import fs from 'fs';
import path from 'path';

export const config = {
  runtime: 'nodejs',
  maxDuration: 60
};

const app = new Hono();

const wasmPath = path.resolve('./sha3_wasm_bg.wasm');
let wasmBuffer = null;
const CACHE_TTL = 3600000;
let lastLoaded = 0;

async function loadWasm() {
  const now = Date.now();
  if (wasmBuffer && now - lastLoaded < CACHE_TTL) return wasmBuffer;
  wasmBuffer = fs.readFileSync(wasmPath);
  lastLoaded = now;
  return wasmBuffer;
}

app.get('/wasm/binary', async c => {
  try {
    const buffer = await loadWasm();
    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/wasm',
        'Cache-Control': 'public, max-age=3600'
      }
    });
  } catch (err) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

export default handle(app);
