import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { chromium } from 'playwright-core'

const root = resolve('..')
const db = join(root, `e2e-${process.pid}.db`)
const db2 = join(root, `e2e-context-${process.pid}.db`)
const base = process.env.DEMIURGO_E2E_BASE_URL || 'http://127.0.0.1:8010'
const base2 = 'http://127.0.0.1:8012'
const chrome = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const artifacts = join(root, 'artifacts')
mkdirSync(artifacts, { recursive: true })
let server
let server2
let browser
const errors = []

async function waitForServer(url = base) {
  for (let i = 0; i < 100; i++) {
    try { const response = await fetch(url + '/api/state'); if (response.ok) return }
    catch { /* waiting for migration */ }
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error('El servidor E2E no arrancó')
}

async function state(url = base) { return (await fetch(url + '/api/state')).json() }
async function waitState(predicate, description, url = base) {
  for (let i = 0; i < 100; i++) {
    const value = await state(url)
    if (predicate(value)) return value
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error(`No apareció el estado esperado: ${description}`)
}
async function closeDrawer(page) { await page.getByRole('button', { name: 'Cerrar ×' }).click() }

try {
  if (!process.env.DEMIURGO_E2E_BASE_URL) {
    server = spawn('python', ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8010'], { cwd: root, env: { ...process.env, DEMIURGO_DB: db, DEMIURGO_DISABLE_CODEX: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    server.stderr.on('data', () => {})
  }
  await waitForServer()
  browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(base)
  await page.getByText('El diseño empieza con una conversación.').waitFor()
  await page.getByRole('button', { name: 'Importar VISION.md' }).last().click()
  await page.locator('.inbox-item').first().waitFor()
  assert((await state()).proposals.length > 0, 'La importación creó propuestas')
  await page.screenshot({ path: join(artifacts, 'e2e-importacion.png'), fullPage: true })

  const first = page.locator('.inbox-item').first()
  await first.getByRole('button', { name: 'Editar propuesta' }).click()
  await first.getByLabel('Título').fill('Quién puede inscribirse')
  await first.locator('select').selectOption('decision')
  await first.getByLabel('Contenido').fill('Solo socios pueden inscribirse.')
  await first.getByRole('button', { name: 'Guardar cambios' }).click()
  await first.getByLabel('Aceptar').check()
  await page.locator('.inbox-item').nth(1).getByLabel('Aceptar').check()
  await page.getByRole('button', { name: 'Aplicar revisión del lote' }).click()
  const accepted = await waitState(s => s.records.length === 1 && s.explorations.length === 1, 'propuestas aceptadas')
  assert.equal(accepted.records.length, 1)
  assert.equal(accepted.explorations.length, 1)

  await page.getByRole('textbox', { name: 'Mensaje' }).fill('La asociación quiere admitir invitados con plazas disponibles.')
  await page.getByRole('button', { name: 'Enviar mensaje' }).click()
  await page.getByText('La asociación quiere admitir invitados con plazas disponibles.').waitFor()
  await page.reload()
  await page.getByText('La asociación quiere admitir invitados con plazas disponibles.').waitFor()
  assert.equal((await state()).codex_available, false)

  await page.getByRole('tab', { name: 'Diseño' }).click()
  await page.getByRole('button', { name: /Quién puede inscribirse/ }).first().click()
  await page.getByText('Fuente: VISION.md').waitFor()
  await page.screenshot({ path: join(artifacts, 'e2e-origen.png'), fullPage: true })
  await closeDrawer(page)

  await page.getByRole('button', { name: '+ Nuevo registro' }).click()
  await page.locator('.dialog select').first().selectOption('fdr')
  await page.getByLabel('Título').fill('Inscripción inmediata')
  await page.getByRole('textbox', { name: 'Contenido', exact: true }).fill('Los socios y los invitados pueden inscribirse si quedan plazas.')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await page.locator('.drawer').getByRole('button', { name: 'Añadir criterio' }).click()
  await page.getByLabel('Condición observable').fill('Un invitado puede completar la inscripción cuando quedan plazas.')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await closeDrawer(page)

  await page.getByRole('tab', { name: 'Trabajo' }).click()
  await page.getByRole('button', { name: '+ Tarea' }).click()
  await page.getByLabel('Resultado de la tarea').fill('Admitir invitados en el formulario')
  await page.getByLabel('Un invitado puede completar la inscripción cuando quedan plazas.').check()
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await page.getByRole('button', { name: '+ Change Set' }).click()
  await page.getByLabel('Nombre').fill('Actividades abiertas')
  await page.getByLabel('Resultado esperado').fill('Invitados inscritos en actividades abiertas')
  await page.getByLabel('Un invitado puede completar la inscripción cuando quedan plazas.').check()
  await page.getByLabel('Admitir invitados en el formulario').check()
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await page.getByRole('button', { name: 'Aceptar alcance' }).click()
  await page.getByText('Alcance aceptado').first().waitFor()

  await page.getByRole('tab', { name: 'Diseño' }).click()
  await page.getByRole('button', { name: /Quién puede inscribirse/ }).first().click()
  await page.getByRole('button', { name: 'Vincular' }).click()
  const fdr = (await state()).records.find(r => r.kind === 'fdr')
  await page.getByLabel('Registro destino').selectOption(fdr.id)
  await page.getByLabel('Relación').fill('justifica')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await page.getByRole('button', { name: 'Crear nueva versión' }).click()
  await page.getByLabel('Nuevo contenido').fill('Socios e invitados pueden inscribirse en actividades abiertas con plazas.')
  await page.getByLabel('Motivo del cambio').fill('Abrir actividades a no socios')
  await page.getByLabel('Origen del cambio').selectOption('message')
  await page.getByLabel('Mensaje que originó el cambio').selectOption({ index: 1 })
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await page.getByText('Versión vigente · v2').waitFor()
  await page.getByText('Conversación de origen', { exact: true }).waitFor()
  await page.locator('.drawer details').filter({ hasText: 'v1' }).locator('summary').click()
  await page.getByText('Solo socios pueden inscribirse.').first().waitFor()
  await page.getByText(/1 relaciones · 1 criterios · 1 tareas · 1 Change Sets/).waitFor()
  await page.locator('.impact-row select').selectOption('needs_update')
  const decisionId = (await state()).records.find(r => r.kind === 'decision').id
  for (let i = 0; i < 30; i++) {
    const detail = await (await fetch(base + '/api/records/' + decisionId)).json()
    if (detail.links[0].review_status === 'needs_update') break
    await new Promise(r => setTimeout(r, 100))
    if (i === 29) throw new Error('La revisión del impacto no se guardó')
  }
  await page.screenshot({ path: join(artifacts, 'e2e-impacto.png'), fullPage: true })
  await closeDrawer(page)

  await page.getByRole('textbox', { name: 'Buscar en el conocimiento' }).fill('inscribirse')
  await page.locator('.search-results button').first().waitFor()
  await page.getByRole('textbox', { name: 'Buscar en el conocimiento' }).fill('')
  await page.getByRole('textbox', { name: 'Buscar en el conocimiento' }).fill('asociación quiere admitir invitados')
  await page.locator('.search-results button').filter({ hasText: 'message' }).first().click()
  await page.locator('.drawer').getByText('La asociación quiere admitir invitados con plazas disponibles.').waitFor()
  await closeDrawer(page)

  await page.getByRole('tab', { name: 'Trabajo' }).click()
  await page.getByRole('button', { name: /Admitir invitados en el formulario/ }).first().click()
  await page.locator('.drawer').getByText('Decisiones y diseños relacionados').waitFor()
  await page.locator('.drawer').getByText('Solo socios pueden inscribirse.', { exact: true }).waitFor()
  await page.locator('.drawer').getByText('Fuente: VISION.md').waitFor()
  await page.getByLabel('Estado de trabajo').selectOption('done')
  await page.getByRole('button', { name: 'Registrar evidencia' }).click()
  await page.getByLabel('Resultado evaluado (build, commit o paquete)').fill('build-e2e-1')
  await page.getByLabel('Entorno evaluado').fill('local')
  await page.getByLabel('Método de comprobación').fill('Prueba manual')
  await page.getByLabel('Evidencia observable').fill('El invitado ve confirmación de inscripción.')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await closeDrawer(page)
  await page.getByRole('button', { name: 'Ver historial' }).click()
  await page.locator('.drawer').getByText('Verificar resultado').waitFor()
  await page.screenshot({ path: join(artifacts, 'e2e-verificacion.png'), fullPage: true })
  await page.getByLabel('Build, commit o paquete evaluado').fill('build-e2e-1')
  await page.getByLabel('Entorno del resultado').fill('local')
  await page.getByRole('button', { name: 'Marcar resultado verificado' }).click()
  await page.getByText('Resultado verificado').first().waitFor()
  await closeDrawer(page)

  const exportPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportar contexto' }).click()
  const download = await exportPromise
  assert.equal(download.suggestedFilename(), 'demiurgo-contexto.json')
  const contextFile = await download.path()
  const markdownPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportar Markdown' }).click()
  assert.equal((await markdownPromise).suggestedFilename(), 'demiurgo-conocimiento.md')
  const final = await state()
  assert.equal(final.records.length, 2)
  assert.equal(final.tasks.length, 1)
  assert.equal(final.changesets[0].status, 'result_verified')

  server2 = spawn('python', ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8012'], { cwd: root, env: { ...process.env, DEMIURGO_DB: db2, DEMIURGO_DISABLE_CODEX: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  await waitForServer(base2)
  const page2 = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  page2.on('pageerror', error => errors.push(error.message))
  await page2.goto(base2)
  await page2.locator('.upload input').setInputFiles(contextFile)
  const transferred = await waitState(s => s.records.length === 2, 'contexto importado en otra base', base2)
  assert.equal(transferred.tasks.length, 0)
  assert.equal(transferred.changesets.length, 0)
  const full2 = await (await fetch(base2 + '/api/export')).json()
  assert.equal(full2.data.evidence.length, 0)
  assert.equal(full2.data.revisions.length, 3)
  await page2.screenshot({ path: join(artifacts, 'e2e-contexto-transferido.png'), fullPage: true })
  await page2.close()

  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: join(artifacts, 'e2e-movil.png'), fullPage: true })
  const widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }))
  assert(widths.page <= widths.viewport, `Desbordamiento horizontal en móvil: ${widths.page} > ${widths.viewport}`)
  assert.deepEqual(errors, [], 'Sin errores de JavaScript')
  console.log('E2E OK: importación, revisión, conversación persistente, origen, FDR, criterio, tarea, Change Set, cambio, impacto, evidencia y transferencia de contexto sin trabajo heredado.')
} finally {
  if (browser) await browser.close()
  if (server) server.kill()
  if (server2) server2.kill()
  for (const database of [db, db2]) {
    for (const suffix of ['', '-wal', '-shm']) {
      const target = database + suffix
      if (dirname(target) === root && existsSync(target)) rmSync(target)
    }
  }
}
