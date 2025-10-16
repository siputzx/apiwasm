import { Hono } from 'hono';
import { handle } from 'hono/vercel';

export const config = {
  runtime: 'nodejs20.x',
  maxDuration: 60
};

const app = new Hono();

let wasmCache: { url: string | null; buffer: ArrayBuffer | null; timestamp: number } = {
  url: null,
  buffer: null,
  timestamp: 0
};

const CACHE_TTL = 3600000;

async function getWasmUrl(): Promise<string> {
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

async function loadWasm(): Promise<ArrayBuffer> {
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

app.get('/wasm/url', async (c) => {
  try {
    const url = await getWasmUrl();
    return c.json({ success: true, url });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

app.get('/wasm/binary', async (c) => {
  try {
    const buffer = await loadWasm();
    return new Response(buffer, { headers: { 'Content-Type': 'application/wasm', 'Cache-Control': 'public, max-age=3600' } });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

app.post('/wasm/solve', async (c) => {
  try {
    const body = await c.req.json();
    const { algorithm, challenge, salt, difficulty, expire_at } = body;
    if (algorithm !== 'DeepSeekHashV1') throw new Error('Unsupported algorithm');
    const buffer = await loadWasm();
    const { instance } = await WebAssembly.instantiate(buffer, { wbg: {} });
    const wasmInst = instance.exports as any;
    const enc = new TextEncoder();
    let offset = 0;
    function getMem(): Uint8Array { return new Uint8Array(wasmInst.memory.buffer); }
    function encStr(txt: string, alloc: any, realloc: any = null): number {
      if (!realloc) {
        const encoded = enc.encode(txt);
        const ptr = alloc(encoded.length, 1) >>> 0;
        getMem().subarray(ptr, ptr + encoded.length).set(encoded);
        offset = encoded.length;
        return ptr;
      }
      const len = txt.length;
      let ptr = alloc(len, 1) >>> 0;
      const mem = getMem();
      let i = 0;
      for (; i < len && txt.charCodeAt(i) <= 127; i++) mem[ptr + i] = txt.charCodeAt(i);
      if (i !== len) { if (i > 0) txt = txt.slice(i); ptr = realloc(ptr, len, i + txt.length * 3, 1) >>> 0; const res = enc.encodeInto(txt, getMem().subarray(ptr + i, ptr + i + txt.length * 3)); i += res.written || 0; ptr = realloc(ptr, i + txt.length * 3, i, 1) >>> 0; }
      offset = i;
      return ptr;
    }
    const pfx = `${salt}_${expire_at}_`;
    let answer: number | undefined;
    try {
      const ret = wasmInst.__wbindgen_add_to_stack_pointer(-16);
      const p0 = encStr(challenge, wasmInst.__wbindgen_export_0, wasmInst.__wbindgen_export_1);
      const l0 = offset;
      const p1 = encStr(pfx, wasmInst.__wbindgen_export_0, wasmInst.__wbindgen_export_1);
      const l1 = offset;
      wasmInst.wasm_solve(ret, p0, l0, p1, l1, difficulty);
      const dv = new DataView(wasmInst.memory.buffer);
      const st = dv.getInt32(ret, true);
      const val = dv.getFloat64(ret + 8, true);
      answer = st === 0 ? undefined : val;
    } finally {
      wasmInst.__wbindgen_add_to_stack_pointer(16);
    }
    return c.json({ success: true, answer });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default handle(app);
