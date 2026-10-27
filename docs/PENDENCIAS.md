# Pendências reais — CR ODONTO

Lista honesta do que **não** está pronto. Nada aqui está “meio feito escondido”: ou não existe, ou
existe com a limitação descrita.

## Bloqueios externos (dependem de credenciais/decisões)

1. **Deploy em produção na Cloudflare** — o projeto está pronto para publicar, mas não foi publicado:
   faltam `wrangler login`, criação do D1 (`crodonto-db`) e do bucket R2 (`crodonto-media`), e a
   troca do `database_id` placeholder em `wrangler.jsonc`. O preflight (`npm run deploy`) bloqueia
   justamente esse caso. Passo a passo: `docs/DEPLOY.md`.
2. **Envio real de WhatsApp** — toda a lógica (credenciais cifradas por clínica, fila, lembretes,
   botões, webhook assinado) está implementada e testada com provedor simulado. Para valer em
   produção é necessário: app Meta Business + WABA + número aprovado + templates aprovados +
   `WHATSAPP_WEBHOOK_VERIFY_TOKEN`/`WHATSAPP_APP_SECRET` configurados.
3. **Cloudflare Turnstile** — não integrado. Mitigação atual no agendamento público: rate limit por
   IP (8/h), validação de disponibilidade no servidor e dedupe de paciente. Integrar Turnstile é
   recomendado antes de expor o agendamento público a tráfego alto.

## Limitações funcionais conhecidas

4. **Documentos em PDF** — os documentos clínicos são gerados como texto estruturado (visualizável e
   imprimível no navegador) e aceitam **upload de PDF/imagem**. Não há geração server-side de PDF
   nem layout com cabeçalho/rodapé da clínica.
5. **Assinatura digital** — a assinatura é interna (SHA-256 do conteúdo + autor + CRO). Não é
   ICP-Brasil, portanto **não** serve para os casos em que a lei exige certificado digital.
6. **Módulos financeiros/estoque/comissão** — existem apenas como chaves de configuração desligadas
   (`settings.modules`). Não há telas de contas a receber/pagar, caixa, comissão ou estoque.
   Nenhum desses módulos foi solicitado como obrigatório e nenhum bloqueia agenda ou atendimento.
7. **Exclusão automática de dados por retenção** — a política está documentada, mas não há rotina
   automática de expurgo; a anonimização é manual (`POST /patients/:id/anonymize`).
8. **Backup automatizado** — há comandos de export/restauração documentados; agendamento diário
   (GitHub Action ou cron próprio) ainda não configurado.
9. **Notificações fora do WhatsApp** — não há e-mail/SMS/push.

## Dívidas técnicas e qualidade

10. **Cobertura de testes** — 43 testes unitários cobrem regras puras (URL, tempo/fuso, máquina de
    estados, disponibilidade, odontograma, mensagens, tokens) e o `smoke` cobre o fluxo completo.
    **Não há** testes unitários de integração com D1 real por função, nem testes de carga.
11. **Testes de UI** — a verificação em navegador (`scripts/ui-check.mjs`) é funcional (conteúdo por
    tela, erros de console, chamadas de API), não uma suíte E2E com snapshot/regressão visual.
12. **i18n** — interface e mensagens apenas em pt-BR.
13. **Acessibilidade** — há rótulos, foco visível e contraste razoável, mas **não** houve auditoria
    formal (WCAG) nem leitores de tela testados.
14. **Índices/performance** — índices criados para agenda e busca por telefone/CPF; não houve teste
    com volume realista (milhares de pacientes/consultas).
15. **Superadmin** — não há tela para editar/remover superadmins adicionais (só o bootstrap cria o
    primeiro); a criação de novos superadmins hoje exigiria acesso ao banco.

## Escopo explicitamente fora do projeto (proibições respeitadas)

- Nenhuma integração com Mercado Pago ou qualquer gateway de pagamento.
- Nenhuma cobrança automática, assinatura financeira ou processamento de pagamento.
- Estoque, comissão e dados financeiros **não** são obrigatórios em nenhum fluxo.
- Nenhuma alteração no repositório original do TIGU, nem reutilização de seus bancos/segredos.
