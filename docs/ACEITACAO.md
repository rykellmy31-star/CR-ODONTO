# Critérios de aceitação — CR ODONTO

Legenda: **✅ implementado e verificado** · **⚠️ implementado com limitação declarada** · **❌ não implementado**

Verificação automática: `npm test` (43 testes unitários) e `npm run smoke`
(69 verificações ponta a ponta contra o Worker real). A coluna “evidência” indica onde está o teste
ou a tela correspondente.

## Plataforma e multi-tenancy

| # | Critério | Estado | Evidência |
|---|---|---|---|
| 1 | Superadmin cria clínica com administrador inicial | ✅ | `smoke`: “Superadmin cria clínica + admin” |
| 2 | Superadmin gerencia planos e limites (unidades, dentistas, mensagens) | ✅ | `SuperAdminPlanos` + `GET/POST/PUT /super/plans`; tela “Superadmin: planos” |
| 3 | Trial com data de expiração e bloqueio de escrita ao vencer | ✅ | `api/lib/access.ts` (`trialExpired`, `canWrite`) + `tenantMiddleware` (402) |
| 4 | Suspensão/bloqueio de clínica com motivo, dados preservados | ✅ | `smoke`: “Clínica suspensa responde 403 honesto” |
| 5 | Superadmin **não** acessa prontuário/dados clínicos | ✅ | `smoke`: “Superadmin não abre painel clínico”; suporte em modo leitura |
| 6 | Isolamento total entre clínicas e unidades | ✅ | `smoke`: “Isolamento: admin de uma clínica não acessa outra” |
| 7 | Painel do administrador da clínica completo | ✅ | telas dashboard/agenda/pacientes/equipe/procedimentos/whatsapp/relatórios/configurações |
| 8 | Painel do dentista com CRO/UF e agenda própria | ✅ | `ProPanelPage`; `smoke`: cadastro de dentista com CRO/UF |
| 9 | Recepção sem acesso a prontuário por padrão | ✅ | `smoke`: “Recepção sem prontuário é bloqueada no painel clínico” |
| 10 | Portal do paciente com código enviado por WhatsApp | ✅ | `smoke`: request-code → verify → `/portal/me` |

## Agenda e agendamento

| # | Critério | Estado | Evidência |
|---|---|---|---|
| 11 | Agendamento pela recepção e pelo site público | ✅ | `smoke`: “Admin cria agendamento”, “Agendamento online criado” |
| 12 | Regras do online: antecedência mínima, janela de dias, aceite de termos, opt-in | ✅ | `public.ts` (`/book`) + bloqueio de termos; tela pública |
| 13 | Duração definida pelo procedimento | ✅ | `dayAvailability` + `slotToInstants`; `tests/unit.scheduling.test.ts` |
| 14 | Disponibilidade por profissional (escala, almoço, exceções) | ✅ | `smoke`: “Admin define a escala semanal do dentista” |
| 15 | Bloqueios de agenda e exceções (folga, férias, feriado) | ✅ | `POST /agenda-blocks`, `POST /schedule-exceptions`; modal “Escala” |
| 16 | Encaixe com aviso de conflito, motivo obrigatório e autor registrado | ✅ | `smoke`: encaixe com/sem motivo; auditoria `appointment.fit_in_created` |
| 17 | Concorrência: dois pedidos no mesmo horário → apenas um vence | ✅ | índice único parcial + `createAppointmentGuarded`; `smoke`: “Conflito de horário é bloqueado” |
| 18 | Reagendamento validado por escala, sala e duração | ✅ | `rescheduleAppointment`; `smoke`: “Reagendamento pelo link (com validação de agenda)” |
| 19 | Cancelamento e não comparecimento com motivo | ✅ | `cancelAppointment`/`markNoShow`; modal de cancelamento na agenda |
| 20 | Lista de espera | ✅ | `GET/POST /waitlist` + painel na agenda com ações “Contatado/Remover” |
| 21 | Visões diária, semanal **e mensal** | ✅ | `AgendaPage`: abas Dia / 7 dias / Mês |
| 22 | Máquina de estados com os 9 estados exigidos | ✅ | `tests/unit.appointments.test.ts` (8 casos) |
| 23 | Finalizar atendimento com 3 opções de retorno | ✅ | `smoke`: “Finalizar atendimento com retorno agendado” + `return_appointment_id` |

## WhatsApp e lembretes

| # | Critério | Estado | Evidência |
|---|---|---|---|
| 24 | Integração configurável por clínica, com credenciais cifradas | ✅ | `PUT /whatsapp`; `smoke`: token cifrado e nunca devolvido |
| 25 | Lembretes 24h e 5h, janela de envio e opt-in | ⚠️ | fila e offsets implementados e testados em modo simulado; envio real depende de WABA |
| 26 | Botões interativos Confirmar/Reagendar | ✅ | `reminderButtons` (≤3 botões, ≤20 caracteres) + `tests/unit.messaging.test.ts` |
| 27 | Webhook idempotente e assinado | ✅ | `/api/webhooks/whatsapp` (HMAC tempo constante + idempotência) |
| 28 | Links seguros de uso único, invalidados ao cancelar/reagendar | ✅ | `smoke`: confirmação, reuso tratado, `/action` sem dados sensíveis |
| 29 | Nenhum dado clínico nas mensagens | ✅ | `tests/unit.messaging.test.ts`: “nunca inclui dados clínicos” |

## Prontuário e documentos

| # | Critério | Estado | Evidência |
|---|---|---|---|
| 30 | Cadastro de pacientes com dedupe e “atender novamente” | ✅ | `smoke`: “Dedupe bloqueia cadastro duplicado”; botão no prontuário |
| 31 | Prontuário: anamnese, diagnóstico, evolução com autoria e imutabilidade | ✅ | `clinical_records` append-only + `clinical_record_events`; `smoke` |
| 32 | Odontograma interativo (faces, permanente/decídua, planejado × executado) | ✅ | `Odontogram.tsx` + `tests/unit.clinical.test.ts` (FDI, faces) |
| 33 | Especialidades/procedimentos e planos de tratamento por etapas | ✅ | telas + `smoke`: “Plano de tratamento criado” |
| 34 | Documentos clínicos e exames com armazenamento privado | ⚠️ | atestado/receita/encaminhamento/termo e **upload de PDF/imagem** funcionam; **não há geração automática de PDF** (imprima pelo navegador) |
| 35 | Assinatura eletrônica somente onde é legalmente válida | ⚠️ | assinatura **interna** (hash de integridade + autor/CRO), sinalizada na UI; **não é ICP-Brasil** |
| 36 | Finalizar atendimento com pagamento totalmente opcional | ✅ | `smoke`: finalização com `payment`; campos opcionais (Pix/dinheiro/crédito/débito/transferência/pendente/outro/não informado) |
| 37 | Relatórios operacionais com filtros | ✅ | `smoke`: relatório responde; tela com período e dentista |

## Transversais

| # | Critério | Estado | Evidência |
|---|---|---|---|
| 38 | Personalização visual por clínica (logo, cores, textos) | ✅ | aba “Identidade visual” + `/info` público; sem identidade de barbearia |
| 39 | Responsividade completa | ✅ | verificação em viewport 390px; layout mobile-first |
| 40 | LGPD/segurança: RBAC, auditoria, criptografia, R2 privado | ✅ | `docs/SEGURANCA-LGPD.md`; `smoke`: auditoria registra ações |
| 41 | Deploy independente na Cloudflare (Worker, D1, R2, Turnstile, cron) | ⚠️ | Worker/D1/R2/cron validados localmente; **falta publicar** (sem credenciais Cloudflare). Turnstile: não integrado (mitigação atual: rate limit + origem) |
| 42 | Bootstrap seguro do primeiro superadmin com troca de senha | ✅ | `smoke`: bootstrap, token inválido rejeitado, troca obrigatória |
| 43 | Testes automatizados cobrindo os itens acima | ✅ | 43 unitários + 69 ponta a ponta + verificação de UI em navegador |

**Resumo:** 4 itens com limitação declarada (25, 34, 35, 41) e **nenhum item marcado como pronto sem
implementação**. Os itens ❌ do escopo proibido (Mercado Pago, cobrança automática, estoque/comissão
obrigatórios) não existem por decisão de projeto.
