# API — CR ODONTO

Todas as rotas ficam sob `/api`. Sessão por cookie `cr_sess` (HttpOnly). Respostas JSON.
Códigos: `401` sem sessão, `403` sem permissão/tenant suspenso, `402` assinatura vencida em escrita,
`404` inexistente, `409` conflito (horário ocupado, transição inválida, duplicidade), `410` link expirado,
`422` validação, `429` limite de tentativas.

## Plataforma

| Método | Rota | Quem | Descrição |
|---|---|---|---|
| GET | `/setup/status` | público | se o bootstrap já foi feito |
| POST | `/setup/superadmin` | público + `setup_token` | cria o primeiro superadmin (uso único) |
| POST | `/auth/login` · `/auth/logout` | público | sessão |
| GET | `/auth/me` | sessão | usuário + clínicas vinculadas |
| POST | `/auth/password` | sessão | troca de senha (obrigatória no 1º acesso) |
| POST | `/auth/forgot` · `/auth/reset` | público | recuperação por código |
| GET | `/super/overview` · `/super/trials/expiring` | superadmin | indicadores |
| GET/POST/PUT | `/super/plans` · `/super/plans/:code` | superadmin | planos e limites |
| GET/POST | `/super/clinics` | superadmin | listar/criar clínica (+ admin inicial) |
| GET | `/super/clinics/:id` | superadmin | detalhe administrativo (sem prontuário) |
| POST | `/super/clinics/:id/status` | superadmin | `activate`/`suspend`/`block` com motivo |
| POST | `/super/clinics/:id/subscription` | superadmin | plano, trial, status financeiro |
| POST | `/super/clinics/:id/admins` | superadmin | novo administrador/recepção |
| POST | `/super/clinics/:id/delete` | superadmin | exclusão lógica (confirma o slug) |
| POST | `/super/memberships/:id/active` · `/super/users/:id/reset-code` | superadmin | acesso |
| GET | `/super/audit` · `/super/messages` · `/super/settings` | superadmin | auditoria, fila global, configurações da plataforma |
| GET | `/super/clinics/:id/access-check` | superadmin | diagnóstico de acesso da clínica |

## Clínica — painel administrativo (`/api/c/:slug/admin`) — papel `staff`/`admin` conforme a rota

| Rota | Papel | Descrição |
|---|---|---|
| GET/POST/PUT `/units` | staff/admin | unidades |
| GET/POST/PUT `/rooms` | staff/admin | salas |
| GET/POST/PUT `/specialties` | staff/admin | especialidades |
| GET/POST/PUT `/procedures` | staff/admin | procedimentos (duração, preço, sala, online) |
| GET/POST/PUT `/professionals` | staff/admin | dentistas (CRO/UF, cor, slot, especialidades, acesso) |
| GET/PUT `/professionals/:id/schedules` | staff/admin | escala semanal |
| POST/DELETE `/schedule-exceptions` | admin | férias, folgas, feriados, horário especial |
| POST/DELETE `/agenda-blocks` | staff | bloqueios pontuais |
| GET `/availability` | staff | grade do dia com `slotsDetailed` |
| GET/POST/PUT `/patients` | staff | busca, cadastro (com dedupe → 409), edição |
| GET `/patients/:id` | staff | visão 360 do paciente |
| POST `/patients/:id/anonymize` | admin | anonimização LGPD (exige `ANONIMIZAR`) |
| GET/POST `/appointments` | staff | agenda e criação (encaixe exige motivo) |
| POST `/appointments/:id/{confirm,checkin,start,no-show,cancel,reschedule,finish}` | staff | máquina de estados |
| GET/POST `/waitlist` · POST `/waitlist/:id/status` | staff | lista de espera |
| GET `/members` · POST `/members` · PUT `/members/:id` · POST `/members/:id/reset-code` | admin | acessos da equipe (papel, permissão de prontuário, ativo/inativo, código de acesso) |
| GET `/dashboard` | staff | painel do dia |
| GET `/reports/summary` · `/reports/whatsapp` | admin | relatórios operacionais |
| GET `/audit` | admin | auditoria da clínica |
| GET/PUT `/settings` · PUT `/clinic` | admin | configurações e dados da clínica |
| GET/PUT `/whatsapp` · POST `/whatsapp/test` · PUT `/whatsapp/templates/:code` · POST `/whatsapp/run-now` | admin | integração WhatsApp |
| GET `/messages` | admin | fila de mensagens |

## Prontuário (`/api/c/:slug/pro`) — papéis com acesso a registro clínico

| Rota | Descrição |
|---|---|
| GET `/today` · `/agenda?day=` | agenda do dentista logado |
| GET `/patients/:id/clinical` | prontuário consolidado (auditado) |
| POST `/patients/:id/anamnesis` | anamnese |
| POST `/patients/:id/records` · `/records/:id/amend` · `/records/:id/void` | evolução imutável |
| GET/POST `/patients/:id/odontogram` | odontograma |
| GET/POST `/patients/:id/plans` · POST `/plans/:id/items` · POST `/plan-items/:id/status` | planos de tratamento |
| GET/POST `/patients/:id/documents` | documentos clínicos |

## Público (`/api/c/:slug`) — sem sessão

| Rota | Descrição |
|---|---|
| GET `/info` · `/format-phone` | dados públicos da clínica (branding, unidades, profissionais, procedimentos) e normalização de telefone |
| GET `/availability?professional_id=&procedure_id=&day=` | horários livres |
| GET `/availability/days?professional_id=&days=` | calendário com contagem de vagas |
| POST `/book` | agendamento online (exige `accept_terms: true`; rate limit 8/h por IP) |
| GET `/appointment/:code` | consulta por protocolo |
| GET `/action/:token` · POST `/action/:token/{confirm,reschedule,cancel}` · GET `/action/:token/{options,slots}` | links seguros de uso único |
| POST `/portal/request-code` · `/portal/verify` · `/portal/logout` | portal do paciente |
| GET `/portal/me` · `/portal/documents/:id` | dados do próprio paciente |
| POST `/portal/appointments` · `/portal/appointments/:id/{cancel,reschedule}` · `/portal/consent` | autoatendimento |

## Webhooks e arquivos

| Rota | Descrição |
|---|---|
| GET/POST `/api/webhooks/whatsapp` | verificação e recebimento da Meta (HMAC + idempotência) |
| POST `/api/c/:slug/uploads/document` | upload de documento (R2 privado) |
| POST `/api/c/:slug/uploads/logo` | logomarca (único conteúdo público) |
| GET `/uploads/logo/:clinicId/:file` | logo público |
| GET `/uploads/doc/:clinicId/...` | documento com checagem de permissão |
