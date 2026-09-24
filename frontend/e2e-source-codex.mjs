import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { chromium } from 'playwright-core'

const root=resolve('..')
const db=join(root,`e2e-source-codex-${process.pid}.db`)
const base='http://127.0.0.1:8013'
const chrome=process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
let server, browser
async function waitFor(predicate,timeout=170000){
  const start=Date.now()
  while(Date.now()-start<timeout){
    try { const response=await fetch(base+'/api/state'); if(response.ok){const value=await response.json();if(predicate(value))return value} } catch { /* starting */ }
    await new Promise(r=>setTimeout(r,500))
  }
  throw new Error('Tiempo agotado esperando la importación con Codex')
}
try{
  server=spawn('python',['-m','uvicorn','app.main:app','--host','127.0.0.1','--port','8013'],{cwd:root,env:{...process.env,DEMIURGO_DB:db},stdio:['ignore','pipe','pipe'],windowsHide:true})
  let stderr='';server.stderr.on('data',chunk=>{stderr+=chunk.toString()})
  await waitFor(()=>true,15000)
  browser=await chromium.launch({executablePath:chrome,headless:true,args:['--no-sandbox']})
  const page=await browser.newPage({viewport:{width:1360,height:850}})
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.goto(base)
  await page.getByRole('button',{name:'Importar VISION.md'}).last().click()
  const result=await waitFor(s=>s.source_runs.length>0 && s.source_runs[0].status!=='running')
  if(result.source_runs[0].status!=='completed')throw new Error(`Codex ${result.source_runs[0].status}: ${result.source_runs[0].error}\n${stderr.slice(-1000)}`)
  const aiBatch=result.batches.find(b=>b.source_type==='source' && b.id!==result.batches[result.batches.length-1]?.id && result.proposals.some(p=>p.batch_id===b.id && ['fdr','decision','adr'].includes(p.kind)))
  assert(aiBatch,'Codex creó un lote adicional con propuestas de diseño')
  assert(result.proposals.some(p=>p.batch_id===aiBatch.id && p.kind==='fdr'),'Codex propuso al menos un FDR')
  assert.deepEqual(errors,[],'Sin errores de JavaScript')
  console.log('VISION.md E2E OK: importación local y descomposición real de Codex en un lote revisable.')
}finally{
  if(browser)await browser.close()
  if(server)server.kill()
  for(const suffix of ['','-wal','-shm']){const path=db+suffix;if(dirname(path)===root && existsSync(path))rmSync(path)}
}
