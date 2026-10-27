# CR ODONTO

SaaS multiempresa (multi-tenant) para consultórios e clínicas odontológicas, construído sobre
**Cloudflare Workers + D1 + R2**, com planejamento de agenda, prontuário eletrônico, odontograma
interativo e confirmação de consultas por WhatsApp.

> **Origem do código:** este projeto foi criado **adaptando o sistema TIGU** (gestão de barbearias),
> importado para este repositório e mantido como referência na tag `tigu-import-2026-10-26`.
> O repositório original do TIGU **não foi alterado** e nenhuma credencial, banco ou segredo de
> produção dele foi reutilizado. Todo o domínio foi reescrito para odontologia.

---

## 1. O que já funciona (verificado por testes automatizados)

| Área | Estado | Como foi verificado |
|---|---|---|
| Superadmin da plataforma (clínicas, planos, trial, suspensão, auditoria) | Implementado | `scripts/smoke.mjs` + UI |
| Multi-tenancy por clínica/unidade, com isolamento por `slug` | Implementado | smoke (isolamento entre clínicas) |
| Perfis: administrador, dentista (CRO/UF), recepção, paciente | Implementado | smoke (RBAC) + UI |
| Agenda (dia/7 dias/mês), encaixes, bloqueios, lista de espera | Implementado | smoke + UI |
| Máquina de estados do agendamento (9 estados) | Implementado | `tests/unit.appointments.test.ts` |
| Escalas individuais por dia da semana, almoço, férias/folgas | Implementado | smoke + UI |
| Prontuário: anamnese, evolução imutável, odontograma, planos, documentos | Implementado | smoke + UI |
| Finalizar atendimento com 3 opções de retorno e pagamento **opcional** | Implementado | smoke |
| WhatsApp Cloud API (credenciais por clínica, lembretes 24h/5h, botões) | Implementado | smoke (provedor mock) |
| Links seguros de uso único (confirmar/reagendar) | Implementado | smoke |
| Portal do paciente (código por WhatsApp, histórico, cancelamento) | Implementado | smoke + UI |
| Relatórios operacionais e auditoria | Implementado | smoke + UI |
| Personalização visual por clínica (logo, cores, textos) | Implementado | UI |

Números atuais (última execução local, com `wrangler dev` + Vite rodando):

- **43 testes unitários** — `npm test` (7 arquivos, 100% passando)
- **69 verificações de ponta a ponta** contra o Worker real — `npm run smoke` (100% passando)
- **21 telas verificadas em navegador real** (Chromium) — `scripts/ui-check.mjs`, com 0 erros de
  console e 0 chamadas de API com falha
- `tsc -b` sem erros e `npm run build` gerando `dist/` normalmente

---

## 2. Requisitos

- Node.js **>= 22** (o Wrangler 4 exige 22; o runtime do Worker não depende disso)
- Conta Cloudflare (para publicar)
- Nenhuma dependência de banco externo: D1 (SQLite gerenciado) + R2 (arquivos)

## 3. Rodar localmente

```bash
npm install --legacy-peer-deps

cp .dev.vars.example .dev.vars      # preencha SESSION_SECRET, MSG_ENC_KEY, SETUP_TOKEN
npm run db:migrate:local            # cria as 43 tabelas no D1 local
npm run db:seed:local               # clínica de demonstração (opcional, mas recomendado)

npm run dev                         # API em :8787 e SPA em :5173
```

Depois de subir, crie o superadministrador (uma única vez):

```bash
SETUP_TOKEN=<o mesmo do .dev.vars> SUPER_PASSWORD='SenhaForte123' node scripts/create-super.mjs
# ou abra http://localhost:5173/setup e informe o SETUP_TOKEN
```

### Contas da clínica de demonstração (seed local)

| Perfil | E-mail | Senha |
|---|---|---|
| Administrador | `admin@sorrisodemo.com.br` | `DemoOdonto2026` |
| Dentista | `dra.ana@sorrisodemo.com.br` | `DemoOdonto2026` |
| Recepção | `recepcao@sorrisodemo.com.br` | `DemoOdonto2026` |

Site público: `http://localhost:5173/c/sorriso-demo` · Portal: `…/portal`

> Estas credenciais existem **somente** no banco local de desenvolvimento criado pelo seed.

## 4. Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Sobe API (Worker) e SPA juntos |
| `npm run build` | Typecheck completo + build de produção em `dist/` |
| `npm test` | Testes unitários (Vitest) |
| `npm run smoke` | Teste ponta a ponta contra uma API real |
| `node scripts/ui-check.mjs` | Verificação de UI em navegador real (requer `playwright-core`) |
| `npm run db:migrate:local` | Aplica migrations no D1 local |
| `npm run db:seed:local` | Popula a clínica de demonstração |
| `npm run db:reset:local` | Zera o D1 local e reaplica migrations |
| `npm run setup:super` | Cria o primeiro superadministrador (usa `SETUP_TOKEN`) |
| `npm run deploy` | Preflight + build + `wrangler deploy` |

## 5. Publicar na Cloudflare (infraestrutura própria)

Passo a passo completo em [`docs/DEPLOY.md`](docs/DEPLOY.md). Resumo:

```bash
npx wrangler login
npx wrangler d1 create crodonto-db           # copie o database_id
npx wrangler r2 bucket create crodonto-media
# edite wrangler.jsonc com o database_id real
npx wrangler secret put SESSION_SECRET
npx wrangler secret put MSG_ENC_KEY
npx wrangler secret put SETUP_TOKEN
npx wrangler secret put WHATSAPP_WEBHOOK_VERIFY_TOKEN   # opcional (só p/ WhatsApp real)
npx wrangler secret put WHATSAPP_APP_SECRET             # opcional
npm run db:migrate:remote
npm run deploy
```

## 6. Documentação

- [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) — camadas, multi-tenancy, fluxo de agendamento
- [`docs/API.md`](docs/API.md) — endpoints por perfil
- [`docs/SEGURANCA-LGPD.md`](docs/SEGURANCA-LGPD.md) — RBAC, auditoria, criptografia, retenção
- [`docs/DEPLOY.md`](docs/DEPLOY.md) — Cloudflare, WABA, backup e restauração
- [`docs/ACEITACAO.md`](docs/ACEITACAO.md) — os 33 itens de aceitação e onde cada um está implementado/testado
- [`docs/PENDENCIAS.md`](docs/PENDENCIAS.md) — o que ainda **não** está feito (lista honesta)

## 7. Limites conhecidos (leia antes de prometer prazo)

- **Nenhum gateway de pagamento** é integrado: não há Mercado Pago, cobrança automática ou
  processamento financeiro. O registro de forma de pagamento na finalização é opcional e informativo.
- A **assinatura de documentos é interna** (hash de integridade + identificação profissional).
  Ela **não substitui** assinatura digital ICP-Brasil quando a lei exigir.
- O envio real de WhatsApp exige uma conta Meta Business/WABA e templates aprovados; sem isso,
  o sistema continua funcionando (fila interna) e a integração fica desabilitada com aviso honesto.
- Módulos financeiros/estoque/comissão existem apenas como **chaves de configuração desligadas**
  por padrão; não há telas de estoque ou comissão implementadas nesta versão.
