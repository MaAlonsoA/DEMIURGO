import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { chromium } from 'playwright-core'

const root = resolve('..')
const db = join(root, `e2e-codex-${process.pid}.db`)
const base = 'http://127.0.0.1:8011'
const chrome = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
let server
let browser

async function waitFor(predicate, timeout = 170000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    try {
      const response = await fetch(base + '/api/state')
      if (response.ok) { const state = await response.json(); if (predicate(state)) return state }
    } catch { /* starting */ }
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error('Tiempo agotado esperando el análisis real de Codex')
}

try {
  server = spawn('python', ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8011'], { cwd: root, env: { ...process.env, DEMIURGO_DB: db }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let stderr = ''
  server.stderr.on('data', chunk => { stderr += chunk.toString() })
  const initial = await waitFor(() => true, 15000)
  assert(initial.codex_available, 'Codex CLI debe estar disponible')
  browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width: 1360, height: 850 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(base)
  await page.getByRole('button', { name: 'Iniciar proyecto' }).click()
  await page.getByLabel('Nombre del proyecto').fill('Aplicación de la asociación')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await page.getByRole('textbox', { name: 'Mensaje' }).fill('Queremos una aplicación para publicar actividades de la asociación e inscribir socios. Aún no sabemos si todas las actividades permitirán invitados: deja esa pregunta abierta en una tarjeta. Propón además dos FDR separados: publicar actividades e inscripción inmediata. Son propuestas para revisar, no acuerdos confirmados.')
  await page.getByRole('button', { name: 'Enviar mensaje' }).click()
  const completed = await waitFor(s => s.runs.length > 0 && s.runs[0].status !== 'running')
  if (completed.runs[0].status !== 'completed') throw new Error(`Codex ${completed.runs[0].status}: ${completed.runs[0].error}\n${stderr.slice(-1000)}`)
  const proposals = completed.proposals.filter(p => p.status === 'pending')
  console.log('Propuestas reales:', proposals.map(p => ({ kind: p.kind, title: JSON.parse(p.payload).title })))
  assert(proposals.some(p => p.kind === 'card'), 'Codex propuso una pregunta')
  assert(proposals.filter(p => p.kind === 'fdr').length >= 2, 'Codex propuso dos FDR')
  await page.locator('.inbox-item').first().waitFor()
  const items = page.locator('.inbox-item')
  for (let i = 0; i < proposals.length; i++) await items.nth(i).getByLabel('Aceptar').check()
  await page.getByRole('button', { name: 'Aplicar revisión del lote' }).click()
  const accepted = await waitFor(s => s.cards.length >= 1 && s.records.filter(r => r.kind === 'fdr').length >= 2, 15000)
  assert(accepted.records.filter(r => r.kind === 'fdr').every(r => r.origin_type === 'proposal'))
  assert.deepEqual(errors, [], 'Sin errores de JavaScript')
  console.log('Codex E2E OK: mensaje persistido, respuesta real y lote revisado con pregunta y dos FDR.')
} finally {
  if (browser) await browser.close()
  if (server) server.kill()
  for (const suffix of ['', '-wal', '-shm']) {
    const target = db + suffix
    if (dirname(target) === root && existsSync(target)) rmSync(target)
  }
}
