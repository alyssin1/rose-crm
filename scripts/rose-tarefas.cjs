// Mesas (Semana, diária) ↔ Rose. Não imprime o token. Só tarefas do Alysson.
// Uso:
//   node scripts/rose-tarefas.cjs abertas                 → JSON das tarefas abertas (fora Google e notas)
//   node scripts/rose-tarefas.cjs aplicar <arquivo.json> [--dry]
//     arquivo = [{ "id": "<uuid>", "prazo"?: "AAAA-MM-DD" | null, "status"?: 1 | 2, "motivo"?: "texto" }]
//     prazo = dia inteiro (como o app grava: meia-noite de Brasília); null tira o prazo
//     status 1 = concluída · 2 = «não farei»
// Trava (ok do Alysson em 13/10/2026): só prazo e fechamento, só tarefa aberta dele, só o que ele marcou na Mesa.
// Tarefa recorrente não é fechada por aqui (o app avança a data): vai para a lista de avisos.
const fs = require('fs')
const root = `${__dirname}/..`
const env = Object.fromEntries(
  fs.readFileSync(`${root}/.env`, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
)
const DONO = '3ff554e9-f9c2-4693-a06c-b62bdb4eef1c'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DIA = /^\d{4}-\d{2}-\d{2}$/
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

async function abertas() {
  const rows = await sql(`select t.id, t.title, t.due_at, t.all_day, t.priority, t.repeat_rule, t.created_at,
      t.delegation->'decisao'->>'nivel' as delegacao, l.name as lista, l.is_inbox as inbox
    from public.rose_tasks t left join public.rose_lists l on l.id = t.list_id
    where t.user_id = '${DONO}' and t.status = 0 and t.deleted_at is null and t.source <> 'google' and t.kind <> 'note' and t.parent_id is null
    order by t.due_at nulls last, t.priority desc`)
  console.log(JSON.stringify(rows, null, 2))
}

async function aplicar(arq, dry) {
  const rows = JSON.parse(fs.readFileSync(arq, 'utf8'))
  const ok = [], bad = []
  for (const r of rows) {
    const extra = Object.keys(r).filter((k) => !['id', 'prazo', 'status', 'motivo'].includes(k))
    const why = !UUID.test(r.id ?? '') ? 'id' : extra.length ? `campo proibido: ${extra}` : !('prazo' in r) && r.status == null ? 'nada a aplicar'
      : 'prazo' in r && r.prazo !== null && !DIA.test(r.prazo) ? 'prazo fora de AAAA-MM-DD' : r.status != null && ![1, 2].includes(r.status) ? 'status' : null
    if (why) bad.push(`${r.id}: ${why}`); else ok.push(r)
  }
  if (!ok.length) { console.log(`nada a aplicar; rejeitadas: ${bad.length}`); bad.forEach((b) => console.log(' ', b)); process.exit(bad.length ? 1 : 0) }
  const lit = JSON.stringify(ok.map((r) => ({ id: r.id, tem_prazo: 'prazo' in r, prazo: r.prazo ? `${r.prazo}T03:00:00Z` : null, status: r.status ?? null }))).replace(/'/g, "''")
  const rec = `jsonb_to_recordset('${lit}'::jsonb) as r(id uuid, tem_prazo boolean, prazo timestamptz, status smallint)`
  const cond = `where t.id = r.id and t.user_id = '${DONO}' and t.status = 0 and t.deleted_at is null and t.source <> 'google'
      and (r.status is null or t.repeat_rule is null)`
  const alvo = `from ${rec} ${cond}`
  if (dry) {
    const ver = await sql(`select t.id, t.title, t.due_at, r.tem_prazo, r.prazo, r.status from public.rose_tasks t, ${rec} ${cond}`)
    ver.forEach((v) => console.log(`(dry) ${v.id} | ${v.title} | ${v.tem_prazo ? `prazo ${v.due_at ?? '—'} → ${v.prazo ?? '—'}` : ''}${v.status ? ` status → ${v.status === 1 ? 'concluída' : 'não farei'}` : ''}`))
    console.log(`(dry) aplicaria: ${ver.length} · fora (fechada, não é dele, recorrente ao fechar): ${ok.length - ver.length} · rejeitadas: ${bad.length}`)
  } else {
    const body = await sql(`update public.rose_tasks t set
        due_at = case when r.tem_prazo then r.prazo else t.due_at end,
        all_day = case when r.tem_prazo and r.prazo is not null then true else t.all_day end,
        status = coalesce(r.status, t.status),
        completed_at = case when r.status is not null then now() else t.completed_at end
      ${alvo} returning t.id`)
    console.log(`aplicadas: ${body.length} · fora (fechada, não é dele, recorrente ao fechar): ${ok.length - body.length} · rejeitadas: ${bad.length}`)
  }
  bad.forEach((b) => console.log(' ', b))
}

const [cmd, arg, flag] = process.argv.slice(2)
;(cmd === 'abertas' ? abertas() : cmd === 'aplicar' && arg ? aplicar(arg, flag === '--dry') : Promise.reject(new Error('uso: abertas | aplicar <arquivo.json> [--dry]')))
  .catch((e) => { console.error(e.message); process.exit(1) })
