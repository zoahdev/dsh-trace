import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanSessions, renderDashboard } from '../lib/trace.js'

function writeSession(dir, id, events) {
  const sdir = join(dir, '--w--', `session-${id}`)
  mkdirSync(sdir, { recursive: true })
  writeFileSync(join(sdir, 'session.jsonl'), [
    JSON.stringify({ type: 'session', version: 0, id, cwd: '/w', agentPreset: 'standard', createdAt: 0 }),
    ...events.map(e => JSON.stringify(e)),
    '',
  ].join('\n'))
}

test('scans sessions and renders an aggregate dashboard', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-trace-'))
  try {
    writeSession(dir, 'a', [
      { type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } },
      { type: 'user/message', seq: 1, time: 1, data: { content: [{ type: 'text', text: 'hello world' }] } },
      { type: 'assistant/message', seq: 2, time: 2, data: { turn: 1, step: 1, message: { content: [{ type: 'tool-call', callId: 'c1', name: 'bash', arguments: '{}' }] } } },
      { type: 'tool/call', seq: 3, time: 3, data: { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{}' } },
      { type: 'tool/result', seq: 4, time: 50, data: { turn: 1, step: 1, message: { content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'err', isError: true }] }] } } },
    ])
    writeSession(dir, 'b', [
      { type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } },
      { type: 'tool/call', seq: 1, time: 1, data: { turn: 1, step: 1, callId: 'c1', name: 'fs_write', arguments: '{}' } },
    ])
    const sessions = scanSessions(dir)
    assert.equal(sessions.length, 2)
    const html = renderDashboard(sessions)
    assert.ok(html.includes('sessions'))
    assert.ok(html.includes('bash'))
    assert.ok(html.includes('fs_write'))
    const bash = sessions.find(s => s.id === 'a')
    assert.equal(bash.toolCalls, 1)
    assert.equal(bash.errors, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
