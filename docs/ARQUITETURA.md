# Arquitetura — CR ODONTO

## 1. Visão geral

```
Navegador (React 18 SPA)
   │  /api/*            /uploads/*
   ▼
Cloudflare Worker (Hono 4, `api/index.ts`)
   ├── D1 (SQLite)  → 43 tabelas (migrations/0001..0004)
   ├── R2 (privado) → documentos clínicos e logomarcas
   └── cron (*/5 min) → fila de lembretes/WhatsApp
```

- **Sem servidor de aplicação**: tudo roda no Worker.
- **Sem gateway de pagamento** e sem dependência de banco externo.
- **SPA e API no mesmo domínio** em produção (o Worker serve `dist/` via binding `ASSETS`),
  o que mantém o cookie de sessão `SameSite=Lax` e a checagem de mesma origem.

## 2. Estrutura de pastas

| Caminho | Conteúdo |
|---|---|
| `api/index.ts` | entrypoint do Worker (`fetch` + `scheduled`) |
| `api/routes/*` | rotas por área: `setup`, `auth`, `super`, `admin`, `pro`, `public`, `webhooks`, `uploads` |
| `api/lib/*` | regras de negócio: `tenant`, `access`, `scheduling`, `appointments`, `clinical`, `patients`, `reports`, `messaging/*`, `crypto`, `audit` |
| `migrations/*.sql` | schema versionado (aplicado por `wrangler d1 migrations`) |
| `src/*` | SPA React (rotas, páginas por perfil, componentes) |
| `tests/*` | testes unitários (Vitest) |
| `scripts/*` | seed, reset, bootstrap do superadmin, preflight de deploy, smoke test |

## 3. Multi-tenancy

- O tenant é resolvido **exclusivamente pelo `slug` da URL** (`/api/c/:slug/...`).
  O cliente nunca envia `clinic_id`.
- `tenantMiddleware` (em `api/lib/tenant.ts`) roda em toda rota de clínica e:
  1. carrega a clínica pelo slug (404 se não existir ou estiver excluída);
  2. bloqueia clínica suspensa/bloqueada (403 com motivo);
  3. revalida o **vínculo** do usuário com a clínica a cada requisição (papel + dentista ativo);
  4. aplica o *write guard* de assinatura vencida (402 em escritas, exceto cancelar/assinar/autenticar).
- Toda query de dados usa `clinic_id` explícito. Não existe rota que aceite `clinic_id` do cliente.
- Superadmin em “modo suporte” enxerga apenas dados administrativos; **não** acessa prontuário.

## 4. Papéis

| Papel | Alcance |
|---|---|
| `superadmin` | plataforma: clínicas, planos, trial, suspensão, auditoria. Sem dados clínicos. |
| `clinic_admin` | tudo na própria clínica, incluindo prontuário e configurações |
| `dentist` | própria agenda + prontuário dos pacientes que já atendeu |
| `receptionist` | agenda, pacientes e atendimento; prontuário **só** com `can_view_records` |
| paciente | portal: próprias consultas, documentos liberados, cancelar/reagendar conforme regra |

## 5. Agendamento: invariantes

1. **Duração vem do procedimento** (ou do `slot_min` do profissional) — nunca é arbitrária.
2. **Disponibilidade** = escala do profissional − almoço − bloqueios − exceções (folga/férias/feriado)
   − agendamentos ativos no intervalo.
3. **Concorrência**: índices únicos parciais em `(professional_id, starts_at)` e `(room_id, starts_at)`
   para status ativos + checagem de sobreposição dentro de `INSERT … SELECT … WHERE NOT EXISTS`
   (`createAppointmentGuarded`). Requisições simultâneas para o mesmo horário resultam em `409`.
4. **Encaixe** exige `is_fit_in = true` **e** `fit_in_reason`, com papel autorizado nas configurações,
   e fica registrado na auditoria (`appointment.fit_in_created`).
5. **Reagendamento** cria o novo agendamento primeiro; só então marca o antigo como `reagendado`
   e invalida os tokens/lembretes antigos. Se o novo horário falhar, nada é alterado.

## 6. Máquina de estados

```
agendado ─┬─> aguardando_confirmacao ─┬─> confirmado ──┐
          ├─> confirmado ─────────────┘                ├─> chegou ─> em_atendimento ─> concluido
          ├─> chegou ───────────────────────────────────┘
          └─> em_atendimento                    (chegou → concluido também é permitido)
qualquer estado ativo → cancelado | reagendado | nao_compareceu
concluido | cancelado | reagendado | nao_compareceu → (terminal, sem saída)
```

Implementado em `api/lib/appointments.ts` (`TRANSITIONS`, `TERMINAL`, `canTransition`).
Toda transição é um `UPDATE … WHERE status = <esperado>` (optimistic locking, `409` se outro
usuário mudou antes) e grava uma linha em `appointment_events` com autor e origem.

## 7. WhatsApp

- Credenciais **por clínica**, cifradas em repouso com AES-256-GCM (`MSG_ENC_KEY`).
- `message_jobs` guarda a fila; o cron (`*/5 * * * *`) processa com *lease*
  (`UPDATE … RETURNING`) para evitar envio duplicado em execuções concorrentes.
- Lembretes configuráveis (padrão 24h e 5h antes), respeitando janela de envio e opt-in.
- Cancelar/reagendar cancela os jobs pendentes antigos.
- Webhook: assinatura HMAC (`WHATSAPP_APP_SECRET`) verificada em tempo constante, idempotência por
  chave, e resposta sempre `200` para evitar reentrega infinita.
- **Sem PHI**: as mensagens usam apenas nome, data, hora, profissional, unidade e link seguro.
- Sem credenciais reais, `WHATSAPP_MOCK=1` (fora de produção) simula o envio e o sistema degrada
  com aviso, sem quebrar o fluxo de agenda.

## 8. Prontuário e odontograma

- `clinical_records` é **append-only**: correções geram novo registro com `amends_id`; anulação usa
  `voided_at` + motivo. `clinical_record_events` registra criação/emenda/anulação.
- `odontogram_entries` guarda dentição, dente (FDI), face, condição e situação. Nova marcação de
  mesma face/dente substitui a anterior **preservando histórico** (a anterior recebe `superseded_by`).
- Documentos (`clinical_documents`) têm `signature_hash` (SHA-256 do conteúdo + autor) e
  `signature_kind = 'interna'`. Não é ICP-Brasil.
- Arquivos ficam no R2 **privado**; o download passa por rota autenticada e é auditado.

## 9. Frontend

- React 18 + React Router 7, sem biblioteca de dados: `api.get/post/put/upload` centraliza
  cookies, erros e o mapeamento de URL (`src/lib/url.ts`).
- Rotas por perfil: `/c/:slug/admin/*`, `/c/:slug/pro`, `/c/:slug` (público),
  `/c/:slug/portal`, `/superadmin/*`.
- Layout responsivo (mobile-first), textos em pt-BR, paleta própria por clínica.
