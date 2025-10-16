import { Hono } from 'hono'
import { handle } from 'hono/vercel'
import fs from 'fs'
import path from 'path'

class WasmSolver {
  constructor() {
    this.wasmInst = null
    this.mem = null
    this.offset = 0
    this.enc = new TextEncoder()
    this.wasmBuffer = null
  }

  async loadWasm() {
    if (this.wasmBuffer) return this.wasmBuffer
    const buf = fs.readFileSync(path.resolve('./sha3_wasm_bg.wasm'))
    this.wasmBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    return this.wasmBuffer
  }

  async init() {
    if (this.wasmInst) return this.wasmInst
    const buf = await this.loadWasm()
    const { instance } = await WebAssembly.instantiate(buf, { wbg: {} })
    this.wasmInst = instance.exports
    return this.wasmInst
  }

  getMem() {
    if (!this.mem || this.mem.byteLength === 0) this.mem = new Uint8Array(this.wasmInst.memory.buffer)
    return this.mem
  }

  encStr(txt, alloc, realloc = null) {
    if (!realloc) {
      const enc = this.enc.encode(txt)
      const ptr = alloc(enc.length, 1) >>> 0
      this.getMem().subarray(ptr, ptr + enc.length).set(enc)
      this.offset = enc.length
      return ptr
    }
    const len = txt.length
    let ptr = alloc(len, 1) >>> 0
    const mem = this.getMem()
    let i = 0
    for (; i < len && txt.charCodeAt(i) <= 127; i++) mem[ptr + i] = txt.charCodeAt(i)
    if (i !== len) {
      if (i > 0) txt = txt.slice(i)
      ptr = realloc(ptr, len, i + txt.length * 3, 1) >>> 0
      const res = this.enc.encodeInto(txt, this.getMem().subarray(ptr + i, ptr + i + txt.length * 3))
      i += res.written
      ptr = realloc(ptr, i + txt.length * 3, i, 1) >>> 0
    }
    this.offset = i
    return ptr
  }

  calcHash(algo, chal, salt, diff, exp) {
    if (algo !== 'DeepSeekHashV1') throw new Error('Unsupported algorithm')
    const pfx = `${salt}_${exp}_`
    try {
      const ret = this.wasmInst.__wbindgen_add_to_stack_pointer(-16)
      const p0 = this.encStr(chal, this.wasmInst.__wbindgen_export_0, this.wasmInst.__wbindgen_export_1)
      const l0 = this.offset
      const p1 = this.encStr(pfx, this.wasmInst.__wbindgen_export_0, this.wasmInst.__wbindgen_export_1)
      const l1 = this.offset
      this.wasmInst.wasm_solve(ret, p0, l0, p1, l1, diff)
      const dv = new DataView(this.wasmInst.memory.buffer)
      const st = dv.getInt32(ret, true)
      const val = dv.getFloat64(ret + 8, true)
      return st === 0 ? undefined : val
    } finally {
      this.wasmInst.__wbindgen_add_to_stack_pointer(16)
    }
  }
}

const solver = new WasmSolver()
const app = new Hono().basePath('/api')

app.get('/', (c) => c.json({ message: "Congrats! You've deployed Hono to Vercel" }))

app.get('/wasm/binary', async (c) => {
  try {
    const buf = await solver.loadWasm()
    return new Response(buf, {
      headers: {
        'Content-Type': 'application/wasm',
        'Cache-Control': 'public, max-age=3600'
      }
    })
  } catch (err) {
    return c.json({ success: false, error: err.message }, 500)
  }
})

app.post('/wasm/solve', async (c) => {
  try {
    const body = await c.req.json()
    const { algorithm, challenge, salt, difficulty, expire_at } = body
    await solver.init()
    const answer = solver.calcHash(algorithm, challenge, salt, difficulty, expire_at)
    return c.json({ success: true, answer })
  } catch (err) {
    return c.json({ success: false, error: err.message }, 500)
  }
})

const handler = handle(app)
export const GET = handler
export const POST = handler
export const PATCH = handler
export const PUT = handler
export const OPTIONS = handler
