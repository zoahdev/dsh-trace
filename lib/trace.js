/**
 * dsh-trace: aggregate observability for DeepSeek Harness sessions.
 * Decodes every session artifact under a sessions root and renders a single
 * HTML dashboard (tokens, tools, errors, latency). Zero-dependency.
 *
 * @module dsh-trace
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const ZSTD_MAGIC = 0xFD2FB528
const FILE_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

function scanFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) break
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) break
    offset += 4
    const d = buffer.readUInt8(offset++)
    const csf = d >>> 6
    const ss = (d & 0x20) !== 0
    const chk = (d & 0x04) !== 0
    const df = d & 0x03
    const db = df === 3 ? 4 : df
    const csb = csf === 0 ? (ss ? 1 : 0) : (1 << csf)
    offset += (ss ? 0 : 1) + db + csb
    for (;;) {
      if (buffer.length - offset < 3) return { frames }
      const bh = buffer.readUIntLE(offset, 3)
      offset += 3
      const last = (bh & 1) !== 0
      const bt = (bh >>> 1) & 3
      const bs = bh >>> 3
      offset += bt === 1 ? 1 : bs
      if (last) break
    }
    if (chk) offset += 4
    frames.push({ start, end: offset })
  }
  return { frames }
}

function expand(value) {
  if (value === null || typeof value !== 'object') return [value]
  const tag = value.type
  if (tag !== 'text-chunks' && tag !== 'reasoning-chunks' && tag !== 'tool-call-chunks') return [value]
  const d = value.data ?? {}
  const members = tag === 'tool-call-chunks' ? d.args : d.texts
  const out = []
  for (let k = 0; k < members.length; k++) out.push({ type: 'assistant/chunk', data: { chunk: { text: members[k] } } })
  return out
}

function decode(file) {
  const buf = readFileSync(file)
  let plain
  if (buf.length >= 4 && buf.subarray(0, 4).equals(FILE_MAGIC)) {
    const { frames } = scanFrames(buf)
    plain = frames.map(f => zstdDecompressSync(buf.subarray(f.start, f.end)).toString('utf8')).join('')
  } else {
    plain = buf.toString('utf8')
  }
  const events = []
  let header
  for (const line of plain.split(/\r?\n/)) {
    if (line.trim() === '') continue
    let value
    try { value = JSON.parse(line) } catch { continue }
    if (header === undefined && value?.type === 'session') { header = value; continue }
    events.push(...expand(value))
  }
  return { header, events }
}

function charsOf(content) {
  if (!Array.isArray(content)) return 0
  return content
    .filter(b => typeof b?.text === 'string')
    .reduce((n, b) => n + b.text.length, 0)
}

function estimateTokens(chars) {
  return Math.round(chars / 4) // rough heuristic; safe-integer, no false precision
}

function analyzeSession(file) {
  const { header, events } = decode(file)
  const tools = new Map()
  let toolCalls = 0
  let errors = 0
  let inputChars = 0
  let outputChars = 0
  let firstTime
  let lastTime
  for (const event of events) {
    if (typeof event.time === 'number') {
      firstTime = firstTime === undefined ? event.time : Math.min(firstTime, event.time)
      lastTime = lastTime === undefined ? event.time : Math.max(lastTime, event.time)
    }
    const d = event.data ?? {}
    if (event.type === 'user/message') inputChars += charsOf(d.content)
    else if (event.type === 'assistant/message') outputChars += charsOf(d.message?.content)
    else if (event.type === 'assistant/chunk' && typeof d.chunk?.text === 'string') outputChars += d.chunk.text.length
    else if (event.type === 'tool/call') {
      toolCalls++
      const name = d.name ?? 'unknown'
      tools.set(name, (tools.get(name) ?? 0) + 1)
    } else if (event.type === 'tool/result') {
      const rc = d.message?.content?.[0]
      const isErr = rc?.isError === true || rc?.content?.[0]?.isError === true
      if (isErr) errors++
    }
  }
  const durationMs = (firstTime !== undefined && lastTime !== undefined) ? lastTime - firstTime : 0
  return {
    id: header?.id ?? '(unknown)',
    title: header?.title ?? header?.id ?? '(untitled)',
    preset: header?.agentPreset,
    createdAt: header?.createdAt,
    turns: events.filter(e => e.type === 'turn/start').length,
    toolCalls,
    errors,
    inputTokens: estimateTokens(inputChars),
    outputTokens: estimateTokens(outputChars),
    durationMs,
    tools: [...tools.entries()].sort((a, b) => b[1] - a[1]),
  }
}

export function scanSessions(root) {
  const files = []
  const walk = (dir, depth) => {
    if (depth > 8) return
    let entries = []
    try { entries = readdirSync(dir) } catch { return }
    for (const entry of entries) {
      if (entry === 'node_modules' || entry === '.git') continue
      const full = join(dir, entry)
      try {
        if (statSync(full).isDirectory()) walk(full, depth + 1)
        else if (entry === 'session.jsonl.zstd' || entry === 'session.jsonl') files.push(full)
      } catch { /* skip unreadable */ }
    }
  }
  walk(root, 0)
  return files.map(f => analyzeSession(f))
}

function esc(v) {
  return String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

export function renderDashboard(sessions) {
  const total = sessions.length
  const inTok = sessions.reduce((n, s) => n + s.inputTokens, 0)
  const outTok = sessions.reduce((n, s) => n + s.outputTokens, 0)
  const calls = sessions.reduce((n, s) => n + s.toolCalls, 0)
  const errs = sessions.reduce((n, s) => n + s.errors, 0)
  const errRate = calls > 0 ? ((errs / calls) * 100).toFixed(1) : '0'
  const byTool = new Map()
  for (const s of sessions) for (const [name, n] of s.tools) byTool.set(name, (byTool.get(name) ?? 0) + n)
  const topTools = [...byTool.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)

  const cards = [
    ['sessions', total], ['input tokens', inTok], ['output tokens', outTok],
    ['tool calls', calls], ['errors', `${errs} (${errRate}%)`],
  ].map(([k, v]) => `<div class="card"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('')

  const chips = topTools.map(([name, n]) => `<span class="chip"><code>${esc(name)}</code> ×${n}</span>`).join('')

  const rows = sessions
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    .map(s => `<tr><td>${esc(s.title)}</td><td>${esc(s.preset ?? '')}</td><td>${s.turns}</td><td>${s.toolCalls}</td><td class="${s.errors ? 'err' : ''}">${s.errors}</td><td>${s.inputTokens + s.outputTokens}</td><td>${(s.durationMs / 1000).toFixed(0)}s</td></tr>`).join('')

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>dsh-trace</title>
<style>
  :root{color-scheme:dark} body{margin:0;font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;background:#0d1117;color:#e6edf3}
  header{padding:20px 24px;border-bottom:1px solid #30363d;background:#161b22} h1{margin:0;font-size:18px}
  main{max-width:1080px;margin:0 auto;padding:24px}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:16px}
  .card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:12px}
  .card .k{display:block;font-size:11px;color:#8b949e;text-transform:uppercase;letter-spacing:.04em}
  .card .v{font-size:22px;font-weight:600}
  .chip{display:inline-block;margin:0 6px 6px 0;padding:3px 8px;background:#21262d;border:1px solid #30363d;border-radius:12px;font-size:12px}
  table{width:100%;border-collapse:collapse;margin-top:16px}
  th,td{padding:7px 10px;border-bottom:1px solid #30363d;text-align:left;font-size:13px}
  th{color:#8b949e;font-size:11px;text-transform:uppercase}
  td.err{color:#f85149}
</style></head><body>
<header><h1>dsh-trace · ${total} sessions</h1></header>
<main><section class="stats">${cards}</section><section>${chips}</section>
<table><thead><tr><th>session</th><th>preset</th><th>turns</th><th>tools</th><th>errors</th><th>tokens</th><th>duration</th></tr></thead><tbody>${rows}</tbody></table>
</main></body></html>\n`
}
