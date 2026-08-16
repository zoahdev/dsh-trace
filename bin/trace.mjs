#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { scanSessions, renderDashboard } from '../lib/trace.js'

function usage() {
  process.stderr.write(`dsh-trace — aggregate observability dashboard for DSH sessions

Usage:
  dsh-trace [sessions-root] [--out trace.html]
  (default root: $DSH_HOME/sessions or ~/.dsh/sessions)
`)
  process.exit(2)
}

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) usage()

const outIdx = args.indexOf('--out')
const out = outIdx !== -1 ? args[outIdx + 1] : 'trace.html'
const rootArg = args.find(a => !a.startsWith('--'))
const root = rootArg ?? (process.env.DSH_HOME
  ? join(process.env.DSH_HOME, 'sessions')
  : join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh', 'sessions'))

const sessions = scanSessions(root)
writeFileSync(out, renderDashboard(sessions))
process.stdout.write(`${out} (${sessions.length} sessions)\n`)
