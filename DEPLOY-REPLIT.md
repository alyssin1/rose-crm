# Rose · publicar no Replit (site estático)

## 1) Criar o projeto
Replit → **Create Repl → Import from GitHub** (`alyssin1/rose-crm`) **ou** **Upload** do `rose-crm-replit.zip` (descompacte na raiz do Repl).
Template: Node.js (o `.replit` já está pronto).

## 2) Secrets (🔒 Tools → Secrets) — só estas 3, todas PÚBLICAS por desenho
| Nome | Valor |
|---|---|
| `VITE_SUPABASE_URL` | `https://jdfoxhdllpnlmbotfbqk.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | a chave `sb_publishable_…` (linha `VITE_SUPABASE_ANON_KEY` do seu `.env`) |
| `VITE_VAPID_PUBLIC_KEY` | a linha `VITE_VAPID_PUBLIC_KEY` do seu `.env` |

**NÃO** coloque no Replit: `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_CLIENT_SECRET`, `VAPID_PRIVATE_KEY`, `CRON_SECRET`, `RESEND_API_KEY`, `GITHUB_TOKEN`. Esses ficam no `.env` local / segredos das Edge Functions do Supabase.

## 3) Testar no preview (Shell)
```bash
npm ci
npm run dev
```
Abra o preview do Replit. O login com Google só volta para a URL depois do passo 5.

## 4) Publicar
**Deploy → Static**. O `.replit` já define: build `npm ci && npm run build`, pasta `dist`, rota `/*` → `/index.html`.
Não use Autoscale nem Reserved VM (não há servidor para rodar).

## 5) Liberar a URL no Supabase (obrigatório para o login)
Supabase → GEx Dashboard Gerencial → Authentication → **URL Configuration → Redirect URLs → Add URL**:
- `https://<seu-app>.replit.app`
- (opcional, para o preview) `https://*.replit.dev`

**Não** mude o *Site URL* (é o do Dashboard Gerencial) nem o provedor Google.

## 6) iPhone
Abra `https://<seu-app>.replit.app` no **Safari** → Compartilhar → **Adicionar à Tela de Início**.
Notificações push só funcionam depois de publicar as Edge Functions (ver `supabase/README.md`).

## Se algo falhar
- Tela branca/erro de chave: confira os 3 Secrets (sem aspas, sem espaço) e republique — as variáveis `VITE_*` são embutidas no build.
- "redirect_uri_mismatch"/volta para o login: faltou o passo 5.
- Atualização não aparece: feche e reabra o app (o service worker atualiza sozinho na próxima abertura).
