# Deploy na Cloudflare — CR ODONTO

Infraestrutura **própria e independente**: um Worker, um D1, um bucket R2 e um cron. Nada é
compartilhado com o TIGU.

## 1. Pré-requisitos

- Node.js >= 22 e `npx wrangler` (4.x)
- Conta Cloudflare com Workers, D1 e R2 habilitados
- Domínio (opcional, mas recomendado)

## 2. Criar recursos

```bash
npx wrangler login

npx wrangler d1 create crodonto-db
npx wrangler r2 bucket create crodonto-media
```

Copie o `database_id` retornado e substitua `REPLACE_WITH_YOUR_D1_DATABASE_ID` em `wrangler.jsonc`.

Para homologação existe `wrangler.staging.template.jsonc`: copie para `wrangler.staging.jsonc`,
crie um D1/R2 separados e use `wrangler deploy --config wrangler.staging.jsonc`. O Worker respeita
`CR_ODONTO_STAGING=1` e **não dispara mensagens reais** nesse ambiente.

## 3. Segredos

```bash
# obrigatórios
npx wrangler secret put SESSION_SECRET          # >= 32 caracteres aleatórios
npx wrangler secret put MSG_ENC_KEY             # >= 32 caracteres (cifra do token WhatsApp)
npx wrangler secret put SETUP_TOKEN             # >= 16 caracteres, uso único no bootstrap

# necessários apenas para WhatsApp real
npx wrangler secret put WHATSAPP_WEBHOOK_VERIFY_TOKEN
npx wrangler secret put WHATSAPP_APP_SECRET

# variáveis (wrangler.jsonc ou dashboard)
# PUBLIC_URL=https://crodonto.seudominio.com
# APP_ENV=production
```

Gere segredos com `openssl rand -hex 32`. **Nunca** comite `.dev.vars`.

## 4. Banco e publicação

```bash
npm run db:migrate:remote      # aplica migrations no D1 remoto
npm run deploy                 # preflight + build + wrangler deploy
```

O preflight (`scripts/production-preflight.mjs`) **bloqueia** o deploy se o `database_id` ainda for
placeholder, se faltar binding de D1/R2 ou se faltarem scripts essenciais.

## 5. Primeiro superadministrador

```bash
BASE_URL=https://crodonto.seudominio.com \
SETUP_TOKEN=<o segredo> \
SUPER_NAME="Seu Nome" SUPER_EMAIL="voce@clinica.com" SUPER_PASSWORD='SenhaForte123' \
node scripts/create-super.mjs
```

Depois desse passo, `SETUP_TOKEN` pode (e deve) ser removido com
`npx wrangler secret delete SETUP_TOKEN`. O primeiro login exige troca de senha.

## 6. WhatsApp Cloud API (por clínica)

1. Crie o app/WABA na Meta e obtenha `phone_number_id`, `waba_id` e um token permanente.
2. Na Meta, configure o webhook: `https://SEU-DOMINIO/api/webhooks/whatsapp`
   com o mesmo `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.
3. Assine os eventos `messages` (e `message_status` se quiser status de entrega).
4. No painel da clínica → **WhatsApp**: cole as credenciais, defina lembretes (24h/5h), janela de
   envio e clique em **Enviar teste**.
5. Cadastre/aprove os templates na Meta e informe o nome em cada modelo (tela de modelos).

Sem esses passos o restante do sistema funciona normalmente (a fila fica visível na tela).

## 7. Cron

O `wrangler.jsonc` já declara `*/5 * * * *`. O Worker usa *lease* no banco, então execuções
sobrepostas não duplicam envios. Nada precisa ser configurado à mão.

## 8. Backup e restauração

```bash
# export completo (schema + dados)
npx wrangler d1 export crodonto-db --remote --output backup-$(date +%F).sql

# restauração (banco vazio, após as migrations)
npx wrangler d1 execute crodonto-db --remote --file backup-2026-01-01.sql
```

- Recomendado: export diário via GitHub Action/cron próprio + retenção de 30 dias.
- R2: habilite versionamento (ou copie periodicamente para outro bucket) — documentos clínicos são
  o ativo mais crítico.
- Guarde os backups em local cifrado; eles contêm dados pessoais sensíveis.

## 9. Rollback

```bash
npx wrangler deployments list
npx wrangler rollback <deployment-id>
```

Migrations **não** são revertidas automaticamente: mantenha backups antes de aplicar.

## 10. Checklist pós-deploy

- [ ] `GET /api/health` → `ok: true` e `security.*` todos `true`
- [ ] `node scripts/create-super.mjs` executado com sucesso
- [ ] `BASE_URL=https://... node scripts/smoke.mjs` sem falhas
- [ ] Login do superadmin exige troca de senha
- [ ] Clínica de teste criada e agenda abrindo
- [ ] `SETUP_TOKEN` removido após o bootstrap
