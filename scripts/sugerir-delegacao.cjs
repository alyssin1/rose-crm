// Grava a SUGESTÃO de delegação nas tarefas do Rose (rotina da manhã). Não imprime o token.
// Uso: node scripts/sugerir-delegacao.cjs sugestoes.json
//   sugestoes.json = [{ "id": "<uuid da tarefa>", "agente": "dev-apps" | null, "nivel": "sim"|"parcial"|"eu", "motivo": "...", "origem": "chat X" }]
// Só toca em delegation.sugestao, só em tarefa aberta e só onde o Alysson ainda não decidiu (a regra fica no banco).
const fs = require('fs')
const root = `${__dirname}/..`
const env = Object.fromEntries(
  fs.readFileSync(`${root}/.env`, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
)
// mesma lista de src/components/Delegacao.tsx
const AGENTS = ['automacao', 'claude-ops', 'contador', 'criativos', 'cto', 'data-viewer', 'database', 'designer', 'dev-apps', 'financeiro', 'funnel-ops', 'gestao-time', 'juridico', 'secretaria', 'segundo-cerebro']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const ok = [], bad = []
for (const r of rows) {
  const why = !UUID.test(r.id) ? 'id' : !['sim', 'parcial', 'eu'].includes(r.nivel) ? 'nivel' : r.agente != null && !AGENTS.includes(r.agente) ? 'agente' : null
  if (why) bad.push(`${r.id}: ${why} inválido`)
  else ok.push({ id: r.id, s: { agente: r.nivel === 'eu' ? null : r.agente ?? null, nivel: r.nivel, motivo: String(r.motivo ?? '').slice(0, 300), origem: String(r.origem ?? '').slice(0, 120) } })
}
if (!ok.length) { console.log(`nada a gravar; rejeitadas: ${bad.length}`); bad.forEach((b) => console.log(' ', b)); process.exit(bad.length ? 1 : 0) }

const lit = JSON.stringify(ok).replace(/'/g, "''")
const query = `update public.rose_tasks t
  set delegation = jsonb_set(coalesce(t.delegation, '{}'::jsonb), '{sugestao}', r.s)
  from jsonb_to_recordset('${lit}'::jsonb) as r(id uuid, s jsonb)
  where t.id = r.id and t.status = 0 and t.deleted_at is null and t.delegation->'decisao' is null
  returning t.id`

const ref = new URL(env.VITE_SUPABASE_URL).hostname.split('.')[0]
fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query }),
})
  .then(async (res) => {
    const body = await res.json()
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`)
    console.log(`gravadas: ${body.length} · ignoradas (fechada ou já decidida): ${ok.length - body.length} · rejeitadas: ${bad.length}`)
    bad.forEach((b) => console.log(' ', b))
  })
  .catch((e) => { console.error(e.message); process.exit(1) })
