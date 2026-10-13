// Gestora de Projetos ↔ Rose. Não imprime o token.
// Uso:
//   node scripts/rose-delegacao.cjs listar                 → JSON das tarefas abertas com decisão Sim/Parcial
//   node scripts/rose-delegacao.cjs gravar <arquivo.json>  → grava instrucao / contexto / execucao
//     arquivo = [{ "id": "<uuid>", "instrucao"?: {...}, "contexto"?: {...}, "execucao"?: {...} }]
// Trava (ok do Alysson em 13/10/2026): só essas três chaves, só em tarefa aberta, só onde já existe "decisao".
// Nunca toca em sugestao nem em decisao; para isso existe o sugerir-delegacao.cjs e a tela.
const fs = require('fs')
const root = `${__dirname}/..`
const env = Object.fromEntries(
  fs.readFileSync(`${root}/.env`, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CHAVES = ['instrucao', 'contexto', 'execucao']
const VEREDITO = ['pronto', 'falta', 'nao_executavel']
const STATUS = ['na_fila', 'rodando', 'entregue', 'reprovado']

const ref = new URL(env.VITE_SUPABASE_URL).hostname.split('.')[0]
const sql = (query) =>
  fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  }).then(async (res) => {
    const body = await res.json()
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`)
    return body
  })

function valida(r) {
  if (!UUID.test(r.id)) return 'id'
  const extra = Object.keys(r).filter((k) => k !== 'id' && !CHAVES.includes(k))
  if (extra.length) return `chave proibida: ${extra.join(',')}`
  if (!CHAVES.some((k) => r[k])) return 'nada a gravar'
  if (r.contexto && !VEREDITO.includes(r.contexto.veredito)) return 'contexto.veredito'
  if (r.contexto?.veredito === 'falta' && !(r.contexto.faltando ?? []).length) return 'falta sem perguntas'
  if (r.execucao && !STATUS.includes(r.execucao.status)) return 'execucao.status'
  if (r.instrucao && !(r.instrucao.tarefa && r.instrucao.objetivo && (r.instrucao.passos ?? []).length && r.instrucao.pronto_quando)) return 'instrucao incompleta'
  return null
}

async function listar() {
  const rows = await sql(`select t.id, t.title, t.content, t.due_at, t.priority, t.delegation, l.name as lista
    from public.rose_tasks t left join public.rose_lists l on l.id = t.list_id
    where t.status = 0 and t.deleted_at is null and t.source <> 'google'
      and t.delegation->'decisao'->>'nivel' in ('sim','parcial')
    order by t.due_at nulls last, t.priority desc`)
  console.log(JSON.stringify(rows, null, 2))
}

async function gravar(arq) {
  const rows = JSON.parse(fs.readFileSync(arq, 'utf8'))
  const ok = [], bad = []
  for (const r of rows) {
    const why = valida(r)
    if (why) { bad.push(`${r.id}: ${why}`); continue }
    const patch = {}
    for (const k of CHAVES) if (r[k]) patch[k] = { ...r[k], em: r[k].em ?? new Date().toISOString() }
    ok.push({ id: r.id, p: patch })
  }
  if (!ok.length) { console.log(`nada a gravar; rejeitadas: ${bad.length}`); bad.forEach((b) => console.log(' ', b)); process.exit(bad.length ? 1 : 0) }
  const lit = JSON.stringify(ok).replace(/'/g, "''")
  const body = await sql(`update public.rose_tasks t
    set delegation = coalesce(t.delegation, '{}'::jsonb) || r.p
    from jsonb_to_recordset('${lit}'::jsonb) as r(id uuid, p jsonb)
    where t.id = r.id and t.status = 0 and t.deleted_at is null and t.delegation ? 'decisao'
    returning t.id`)
  console.log(`gravadas: ${body.length} · ignoradas (fechada ou sem decisão): ${ok.length - body.length} · rejeitadas: ${bad.length}`)
  bad.forEach((b) => console.log(' ', b))
}

const [cmd, arg] = process.argv.slice(2)
;(cmd === 'listar' ? listar() : cmd === 'gravar' && arg ? gravar(arg) : Promise.reject(new Error('uso: listar | gravar <arquivo.json>')))
  .catch((e) => { console.error(e.message); process.exit(1) })
