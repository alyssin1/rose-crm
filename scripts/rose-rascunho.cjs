// Rascunhos «[revisar]» na Inbox do Alysson (rotina do Meetily e processamento das reuniões). Não imprime o token.
// Uso: node scripts/rose-rascunho.cjs <arquivo.json>
//   arquivo = [{ "titulo": "Âncora — Verbo o quê", "origem": "<nome do cru>", "trecho": "mm:ss" }]
// Só INSERT em rose_tasks, só na Inbox dele, sem prazo. Não insere se já existir tarefa ativa com o mesmo título.
// Devolve o id de cada tarefa, para gravar «[rose:: id]» na linha do vault.
const fs = require('fs')
const root = `${__dirname}/..`
const env = Object.fromEntries(
  fs.readFileSync(`${root}/.env`, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
)
const DONO = '3ff554e9-f9c2-4693-a06c-b62bdb4eef1c'
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
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`

;(async () => {
  const arq = process.argv[2]
  if (!arq) throw new Error('uso: rose-rascunho.cjs <arquivo.json>')
  const rows = JSON.parse(fs.readFileSync(arq, 'utf8'))
  const base = Date.now()
  let i = 0
  for (const r of rows) {
    if (!r.titulo || !r.titulo.includes(' — ') || !r.origem) { console.log(`rejeitada (titulo sem «Âncora — Verbo» ou sem origem): ${r.titulo}`); continue }
    const title = r.titulo.startsWith('[revisar] ') ? r.titulo : `[revisar] ${r.titulo}`
    const content = `Origem: ${r.origem}${r.trecho ? `, trecho [${r.trecho}]` : ''}. Rascunho criado na revisão do Meetily.`
    const out = await sql(`with inbox as (select id from public.rose_lists where user_id = '${DONO}' and is_inbox limit 1),
      existe as (select id from public.rose_tasks where user_id = '${DONO}' and deleted_at is null and title = ${lit(title)} limit 1),
      novo as (insert into public.rose_tasks (user_id, list_id, title, content, status, priority, all_day, sort_order)
        select '${DONO}', inbox.id, ${lit(title)}, ${lit(content)}, 0, 0, true, ${-(base + i++)} from inbox
        where not exists (select 1 from existe) returning id)
      select (select id from novo) as novo, (select id from existe) as existente`)
    const x = out[0] ?? {}
    console.log(x.novo ? `inserida ${x.novo} | ${title}` : `já existia ${x.existente} | ${title}`)
  }
})().catch((e) => { console.error(e.message); process.exit(1) })
