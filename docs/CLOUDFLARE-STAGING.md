# CR ODONTO — Cloudflare staging (somente homologação)

## Recursos exclusivos

- Repositório: `rykellmy31-star/CR-ODONTO`
- **Branch Cloudflare Builds**: `homologacao-cr-odonto` (NÃO selecionar `main`)
- **Worker**: `cr-odonto`
- **D1**: `crodonto-staging-db`
- **D1 ID**: `cc562d69-dd29-4646-8bd2-0df6f26d9907`
- **R2**: `crodonto-staging-media` — CRIAR este bucket antes do deploy.
- `APP_ENV=staging` e `CR_ODONTO_STAGING=1`, com cron desativado.

A branch `main` preserva sua configuracao separada e NAO deve ser conectada ao Worker de staging.

## Configurar Cloudflare Workers Builds (via navegador)

1. Verifique no painel Cloudflare se o D1 e R2 acima existem, na MESMA conta.
2. Workers & Pages → Create application → GitHub → selecione `rykellmy31-star/CR-ODONTO`.
3. Em branch selecione **`homologacao-cr-odonto`**; Worker `cr-odonto`; root `/`.
4. Build command:

```sh
npm ci --legacy-peer-deps --no-audit --no-fund && npm run check:types && npm test && npm run build
```

5. Deploy command:

```sh
node scripts/staging-preflight.mjs && npx wrangler d1 migrations apply DB --remote && npx wrangler deploy
```

Esse comando aplica as migrations somente no D1 definido na configuracao `wrangler.jsonc` da branch de staging.
Para evitar falha na instalacao automatica por peer dependencies, configure a build variable
`NPM_CONFIG_LEGACY_PEER_DEPS=true` se necessario.

6. O token usado pelo Workers Builds deve ter permissoes para Workers Scripts Edit, R2 Storage Edit, **D1 Edit**, e acesso a conta correta. O token criado por padrao pela integracao pode NAO possuir D1 Edit.
7. Confirme os nomes dos recursos. **Nao realize o deploy se o painel apontar outro banco ou bucket.**
8. Salve e publique. A primeira versao pode subir sem segredos; nao use para testes de login ate configura-los.

## Segredos de runtime (somente apos criar o Worker)

Em `Workers & Pages → cr-odonto → Settings → Variables and Secrets`, tipo Secret:

- `SESSION_SECRET` — pelo menos 32 caracteres aleatorios.
- `MSG_ENC_KEY` — chave independente da anterior, pelo menos 32 caracteres aleatorios.
- `SETUP_TOKEN` — token aleatorio para o bootstrap, ao menos 16 caracteres.

Defina PUBLIC_URL com a URL real do Worker, quando conhecida, caso a aplicacao a utilize.
Nao comitar ou compartilhar valores secretos. Segredos do Worker nao sao segredos de build.

## Validacao

- Abra `https://<subdominio-do-worker>/api/health` e confirme `ok: true`, `d1: true`, `r2: true`, e segredos `security.*` configurados.
- Confirme que D1 recebeu tabelas depois das migrations.
- Crie o primeiro superadmin pela rota `/setup` com o SETUP_TOKEN e troque senha.
- Revogue o SETUP_TOKEN depois do cadastro inicial.
- Teste com clinica e pacientes FICTICIOS. WhatsApp real e cron estao desativados no staging.
- Backups/restauracao de D1 e R2 precisam de validacao propria.

> Nao executar `npm run smoke` contra um ambiente com pacientes reais. O smoke cria entidades de teste.

## Comandos equivalentes em terminal (opcional)

```sh
npm ci --legacy-peer-deps
npm run check:types
npm test
npm run build
node scripts/staging-preflight.mjs
npx wrangler d1 migrations apply DB --remote
npx wrangler deploy
```

Os comandos devem ser executados apos autenticar o Wrangler na conta Cloudflare correta.

## Nunca fazer

- Nao selecionar `main` no Worker `cr-odonto`.
- Nao configurar o D1 ou R2 do TIGU.
- Nao usar dados reais de pacientes em homologacao.
- Nao ativar disparos reais de WhatsApp no staging.
