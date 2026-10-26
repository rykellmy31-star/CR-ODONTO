# Segurança e LGPD — CR ODONTO

Dados odontológicos são **dados pessoais sensíveis** (art. 5º, II da LGPD). O sistema foi desenhado
com minimização, controle de acesso e rastreabilidade.

## 1. Autenticação

- Senhas com **PBKDF2-SHA256** (100.000 iterações, salt aleatório por senha, formato versionado).
- Sessão por cookie `cr_sess`: `HttpOnly`, `SameSite=Lax`, `Secure` em HTTPS, expiração no servidor
  (hash do token no banco — o token em claro nunca é gravado).
- Troca de senha obrigatória no primeiro acesso (inclusive para o primeiro superadmin).
- Recuperação por código de uso único com validade curta; a resposta é sempre genérica
  (não revela se o e-mail existe).
- Rate limit por IP **e** por conta no login, por IP no bootstrap e no agendamento público.
- Revogação de todas as sessões ao trocar senha ou desativar um vínculo.

## 2. Autorização (RBAC)

- Papéis: `superadmin`, `clinic_admin`, `dentist`, `receptionist` (+ sessão de paciente no portal).
- O vínculo é revalidado **a cada requisição** (não há “permissão no token”).
- Dentista só acessa pacientes com quem tem consulta registrada.
- Recepção **não** acessa prontuário por padrão; só com `can_view_records` explícito.
- Superadmin em modo suporte: apenas leitura administrativa, sem prontuário.
- Toda escrita confere `clinic_id` na cláusula `WHERE` (defesa em profundidade contra IDOR).

## 3. Isolamento entre clínicas

- Tenant resolvido só pelo `slug` da URL; nunca por id enviado pelo cliente.
- Teste automatizado cobre tentativa de acesso cruzado (`scripts/smoke.mjs` → 403).
- Clínica suspensa/bloqueada responde `403` com motivo; dados permanecem intactos.

## 4. Criptografia e segredos

- Segredos nunca no repositório: `wrangler secret put` (produção) e `.dev.vars` (local, ignorado).
- Tokens de WhatsApp cifrados em repouso com **AES-256-GCM** (`MSG_ENC_KEY`); a API nunca devolve
  o token (só `has_token: 1`).
- Tokens de ação (links) e de sessão guardados apenas como **SHA-256**.
- Comparação de segredos/HMAC em tempo constante.

## 5. Auditoria

- `audit_log` (escopo plataforma e clínica): login, criação/alteração de dados, transições de
  agendamento, criação/emenda/anulação de registros clínicos, **visualização de prontuário**, uploads,
  alterações de configuração e de integração.
- `appointment_events`: quem mudou o status, de onde (recepção/whatsapp/portal) e por quê.
- Encaixes registram autor e motivo. Auditoria é somente-leitura pela interface.

## 6. Dados sensíveis e minimização

- WhatsApp **não** transporta diagnóstico, procedimento clínico, alergia ou qualquer dado de saúde:
  apenas nome, data, hora, profissional, unidade e um link seguro de uso único.
- Portal do paciente expõe somente as próprias consultas e documentos marcados como visíveis.
- Respostas públicas nunca incluem telefone, CPF ou histórico.

## 7. Armazenamento de arquivos

- R2 privado. Somente `logo/*` é público.
- Documentos: download por rota autenticada, com checagem de papel/`can_view_records` e de
  propriedade (`visible_to_patient` + sessão do paciente). Cada leitura é auditada.

## 8. Direitos do titular

- Acesso e correção: pela clínica (cadastro do paciente) e pelo portal.
- **Anonimização**: `POST /admin/patients/:id/anonymize` substitui dados identificáveis, mantém
  o histórico clínico desvinculado e exige confirmação literal (`ANONIMIZAR`).
- Exclusão de conta de usuário: desativação do vínculo (mantém trilha de auditoria).

## 9. Retenção e backup

- Prontuário é **append-only**: nada é apagado silenciosamente (correções geram novo registro).
- Sugestão de retenção mínima: 20 anos para prontuário odontológico (prazo prescricional), conforme
  avaliação jurídica da clínica — o sistema não apaga automaticamente.
- Backup: ver `docs/DEPLOY.md` (export do D1 + versionamento do R2).
- Dados de demonstração (`demo = 1`) são identificáveis e podem ser excluídos a qualquer momento.

## 10. O que este sistema NÃO faz (por decisão de escopo)

- Não processa pagamentos, não cobra e não integra gateway.
- Não faz assinatura digital ICP-Brasil; a assinatura é interna (hash de integridade).
- Não envia dados clínicos por WhatsApp.
