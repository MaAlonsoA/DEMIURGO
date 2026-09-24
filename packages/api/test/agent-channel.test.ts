// Canal de agentes por la API con token: lectura, conversación con su nombre, fuentes y
// propuestas. Todo lo demás, 403 (lista de permitidos generada desde la matriz).

import { randomUUID } from 'node:crypto';
import { NOMBRES_COMANDO, definicionComando } from '@demiurgo/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { usarApi } from './soporte/api.ts';

const api = usarApi();
let proyectoId = '';
let exploracionId = '';
let token = '';
let tokenId = '';

async function comoPersona(nombre: string, datos: unknown, entidadId?: string) {
  const r = await api().persona.pedir('POST', `/api/proyectos/${proyectoId}/comandos/${nombre}`, {
    ...(entidadId ? { entidad_id: entidadId } : {}),
    datos,
  });
  if (r.statusCode !== 200) throw new Error(`${nombre}: ${r.body}`);
  return r.json<{ entidad_id: string; resultado: Record<string, unknown> }>();
}

beforeAll(async () => {
  const p = await api().persona.pedir('POST', '/api/proyectos', { nombre: 'Canal' });
  proyectoId = p.json<{ proyecto_id: string }>().proyecto_id;
  exploracionId = (await comoPersona('exploration.open', { proposito: 'Invitados a los eventos' })).entidad_id;
  const t = await comoPersona('agent_token.issue', { nombre: 'claude-code' });
  token = String(t.resultado.token);
  tokenId = t.entidad_id;
});

describe('canal de agentes por la API', () => {
  it('AC-DIS-001-02 con token, un agente lee, conversa con su nombre, registra una fuente y propone; la persona acepta', async () => {
    const agente = api().agente(token);
    expect((await agente.pedir('GET', `/api/proyectos/${proyectoId}/estado`)).statusCode).toBe(200);
    expect((await agente.pedir('GET', `/api/proyectos/${proyectoId}/exploraciones/${exploracionId}`)).statusCode).toBe(200);

    const m = await agente.pedir('POST', `/api/proyectos/${proyectoId}/comandos/message.post`, {
      datos: { exploracion_id: exploracionId, texto: 'Propongo limitar los invitados a dos por socio.' },
    });
    expect(m.statusCode).toBe(200);
    const detalle = await agente.pedir('GET', `/api/proyectos/${proyectoId}/exploraciones/${exploracionId}`);
    const mensajes = detalle.json<{ mensajes: { author: string; body: string }[] }>().mensajes;
    expect(mensajes.at(-1)?.author).toBe(`agent:claude-code:${tokenId}`);

    const f = await agente.pedir('POST', `/api/proyectos/${proyectoId}/comandos/source.register`, {
      datos: { nombre: 'reglamento.md', contenido: 'Cada socio puede traer invitados a los eventos abiertos.' },
    });
    expect(f.statusCode).toBe(200);

    const lote = await agente.pedir('POST', `/api/proyectos/${proyectoId}/comandos/batch.submit`, {
      datos: {
        propuestas: [
          {
            tipo: 'decision',
            carga: {
              titulo: 'Dos invitados por socio',
              contexto: 'Aforo limitado.',
              decision: 'Máximo dos invitados.',
              consecuencias: 'Hay que contarlos.',
            },
          },
        ],
      },
    });
    expect(lote.statusCode).toBe(200);
    const bandeja = await api().persona.pedir('GET', `/api/proyectos/${proyectoId}/bandeja`);
    const lotes = bandeja.json<{ lotes: { productor: string; resolucion: string; propuestas: { id: string }[] }[] }>().lotes;
    const delAgente = lotes.find((l) => l.productor === `agent:claude-code:${tokenId}`);
    expect(delAgente?.resolucion).toBe('item');

    // El agente no puede aceptar su propia propuesta; la persona sí.
    const propuesta = delAgente?.propuestas[0]?.id ?? '';
    const intento = await agente.pedir('POST', `/api/proyectos/${proyectoId}/comandos/proposal.accept`, {
      entidad_id: propuesta,
      datos: {},
    });
    expect(intento.statusCode).toBe(403);
    const aceptada = await comoPersona('proposal.accept', {}, propuesta);
    const codigo = String(aceptada.resultado.codigo);
    const eventos = await api()
      .entorno.servicios.db.selectFrom('events')
      .select(['command', 'actor'])
      .where('project_id', '=', proyectoId)
      .where('command', '=', 'record.create')
      .execute();
    expect(eventos).toEqual([{ command: 'record.create', actor: 'human:ana' }]);
    expect((await agente.pedir('GET', `/api/proyectos/${proyectoId}/registros/${codigo}`)).statusCode).toBe(200);
  });

  const noPermitidos = NOMBRES_COMANDO.filter((c) => !definicionComando(c).permitido.includes('agent_external'));

  it.each(noPermitidos)('AC-DIS-001-05 con token de agente, %s devuelve 403', async (comando) => {
    const r = await api()
      .agente(token)
      .pedir('POST', `/api/proyectos/${proyectoId}/comandos/${comando}`, { entidad_id: randomUUID(), datos: {} });
    expect(r.statusCode).toBe(403);
  });

  it('AC-DIS-001-05 con token de agente, las consultas vedadas, otro proyecto y crear proyectos devuelven 403', async () => {
    const agente = api().agente(token);
    expect((await agente.pedir('GET', '/api/proyectos')).statusCode).toBe(403);
    expect((await agente.pedir('GET', `/api/proyectos/${proyectoId}/tokens`)).statusCode).toBe(403);
    expect((await agente.pedir('POST', '/api/proyectos', { nombre: 'Del agente' })).statusCode).toBe(403);
    const otro = (await api().persona.pedir('POST', '/api/proyectos', { nombre: 'Otro' })).json<{ proyecto_id: string }>()
      .proyecto_id;
    expect((await agente.pedir('GET', `/api/proyectos/${otro}/estado`)).statusCode).toBe(403);
    expect((await agente.pedir('POST', `/api/proyectos/${otro}/comandos/message.post`, { datos: {} })).statusCode).toBe(403);
  });

  it('AC-DIS-001-15 un token de agente no obtiene una sesión humana', async () => {
    const r = await api().agente(token).pedir('POST', '/api/sesion', { usuario: 'ana', clave: 'clave-de-prueba-larga' });
    expect(r.statusCode).toBe(403);
    expect(r.cookies).toHaveLength(0);
  });

  it('un token revocado deja de valer', async () => {
    const t = await comoPersona('agent_token.issue', { nombre: 'efimero' });
    await comoPersona('agent_token.revoke', {}, t.entidad_id);
    const r = await api().agente(String(t.resultado.token)).pedir('GET', `/api/proyectos/${proyectoId}/estado`);
    expect(r.statusCode).toBe(401);
  });

  it('AC-ESQ-001-13 con token de agente, una cabecera de actor o una cookie de persona no cambian el actor', async () => {
    const agente = api().agente(token);
    const r = await agente.pedir(
      'POST',
      `/api/proyectos/${proyectoId}/comandos/message.post`,
      { actor: 'human:ana', datos: { exploracion_id: exploracionId, texto: 'Mensaje con cabeceras falsas' } },
      { 'x-actor': 'human:ana', cookie: `demiurgo_sesion=${api().persona.cookie}`, 'x-demiurgo-csrf': api().persona.csrf },
    );
    expect(r.statusCode).toBe(200);
    const ultimo = await api()
      .entorno.servicios.db.selectFrom('events')
      .select('actor')
      .where('project_id', '=', proyectoId)
      .orderBy('seq', 'desc')
      .executeTakeFirstOrThrow();
    expect(ultimo.actor).toBe(`agent:claude-code:${tokenId}`);
    // Y con token de agente no se ejecuta un comando de persona aunque vaya la cookie.
    const decisivo = await agente.pedir(
      'POST',
      `/api/proyectos/${proyectoId}/comandos/exploration.open`,
      { datos: { proposito: 'x' } },
      {
        cookie: `demiurgo_sesion=${api().persona.cookie}`,
        'x-demiurgo-csrf': api().persona.csrf,
      },
    );
    expect(decisivo.statusCode).toBe(403);
  });

  it('el nombre «run» está reservado para los tokens de agente', async () => {
    const r = await api().persona.pedir('POST', `/api/proyectos/${proyectoId}/comandos/agent_token.issue`, {
      datos: { nombre: 'run' },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json<{ motivos: string[] }>().motivos.join(' ')).toMatch(/reservado/);
  });
});
