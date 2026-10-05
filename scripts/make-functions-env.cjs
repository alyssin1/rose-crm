// Gera supabase/.env.functions (só os segredos que as Edge Functions usam) a partir do .env. Não imprime valores.
const fs = require('fs')
const root = process.argv[2] || process.cwd()
const env = Object.fromEntries(
  fs.readFileSync(`${root}/.env`, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
)
const keys = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'CRON_SECRET', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'RESEND_API_KEY']
const out = keys.map((k) => `${k}=${env[k] ?? ''}`).join('\n') + '\n'
fs.writeFileSync(`${root}/supabase/.env.functions`, out, 'utf8')
console.log(keys.map((k) => `${k}: ${env[k] ? 'preenchido' : 'VAZIO'}`).join('\n'))
