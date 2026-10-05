# Rose · servidor (Supabase)

Projeto: **GEx Dashboard Gerencial** (`jdfoxhdllpnlmbotfbqk`) — compartilhado; tudo do Rose tem prefixo `rose_`.

## Migrações (já aplicadas)
| Arquivo | O que faz |
|---|---|
| `migrations/0001_core.sql` | tabelas, RLS por `rose_allowed_emails`, `rose_bootstrap()`, Realtime |
| `migrations/0002_extras.sql` | origem Google, token via RPC, anexos (Storage), log de lembretes |
| `migrations/0003_cron.sql` | **ainda não aplicada** — agendamentos (depois de publicar as funções) |

Novo usuário do Rose = inserir o e-mail (minúsculo) em `rose_allowed_emails`.

## Edge Functions
- `rose-google-sync` — Google Calendar nos dois sentidos (app, cron e webhook do Google).
- `rose-reminders` — lembretes por Web Push e e-mail (cron a cada minuto).

### Publicar (uma vez)
Pré-requisitos no `.env` (raiz): `GOOGLE_CLIENT_SECRET` (segredo **novo** do cliente "GEX Hub" no Google Cloud → *Add secret*) e, para e-mail, `RESEND_API_KEY`.

```bash
node scripts/make-functions-env.cjs        # gera supabase/.env.functions só com os segredos das funções
npx supabase login                         # abre o navegador
npx supabase link --project-ref jdfoxhdllpnlmbotfbqk
npx supabase secrets set --env-file supabase/.env.functions
npx supabase functions deploy rose-google-sync --no-verify-jwt
npx supabase functions deploy rose-reminders --no-verify-jwt
```

Depois, no SQL Editor, rode `0003_cron.sql` trocando `<CRON_SECRET>` pelo valor do `.env` (extensões `pg_cron` e `pg_net` ligadas).

### Testar
1. No app: Configurações → Integrações → **Conectar** (login com consentimento) → **Sincronizar**.
2. Crie uma tarefa com data, escolha a agenda do Google no rodapé do detalhe e confira o evento no Google.
3. Configurações → Notificações → ligar **Web Push** (no iPhone, instale o app na Tela de Início antes).

## Segurança
- `rose_google_tokens` e `rose_reminder_log`: sem acesso para `anon`/`authenticated` (só service role).
- O refresh token entra por `rose_store_google_token()` (security definer, só para quem está em `rose_allowed_emails`).
- `.env` e `supabase/.env.functions` ficam fora do git.
