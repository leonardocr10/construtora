# Banco de dados MySQL do VistaHub

Toda a persistência da API é feita no MySQL 8 via Prisma. Não há arrays em memória, JSON local nem dados fictícios substituindo o banco. Arquivos (PDF, imagens, GLB) ficam no armazenamento privado (`LOCAL_STORAGE_PATH` ou provedor de objetos); o MySQL guarda metadados, `storageKey` e checksum SHA-256.

## Arquivos

| Caminho | Conteúdo |
|---|---|
| `prisma/schema.prisma` | Modelos, tipos, chaves, índices e relacionamentos |
| `prisma/migrations/*/migration.sql` | Migrations SQL versionadas (aplicadas em ordem) |
| `scripts/db-init.mjs` | Inicialização: migrations + planos + primeiro administrador + verificação |
| `scripts/provision-admin.mjs` | Cria construtora, administrador, assinatura e carteira de créditos |
| `scripts/seed-demo.mjs` | Dados demonstrativos (separados; nunca rodam automaticamente) |
| `scripts/check-database.mjs` | Verifica conexão, todas as tabelas do schema e migrations com falha |
| `scripts/acceptance-test.mjs` | Teste de aceite de persistência via API |

## Modelo de dados (39 tabelas + `_prisma_migrations`)

- **Organizações e usuários:** `Organization`, `User`, `OrganizationUser` (papéis SUPERADMIN/ADMIN/MANAGER/EDITOR/BROKER).
- **Empreendimento:** `Development`, `DevelopmentSettings`, `DevelopmentTheme`, `Building` (torres), `Floor` (pavimentos), `Unit` (apartamentos), `UnitType`, `FloorPlan` (plantas), `UnitFloorPlan`, `Amenity`, `AmenityMedia`.
- **Arquivos:** `DevelopmentAsset`, com vínculo opcional a torre, pavimento, unidade ou planta (imagens por apartamento), autor do upload e capa do empreendimento.
- **Mapas:** `InteractiveMap`, `InteractiveRegion`, `RegionLink`.
- **Modelos 3D:** `ModelVersion` (versões GLB numeradas, únicas por empreendimento), `ModelAnnotation`, `ModelReview`, `ViewerConfiguration` (câmera, luz, interação e versão ativa).
- **IA e geração 3D:** `GenerationJob` (fila de tarefas com tentativas), `ThreeDGeneration` (histórico de geração), `ModelGenerationInput`, `AiExtraction`, `ExtractionReview`, `AiProviderConfiguration`.
- **Comercial:** `Lead` (status do funil), `SalesStatusHistory` (histórico de disponibilidade), `Publication`, `PublicationVersion`, `ViewEvent`.
- **Planos e créditos:** `Plan`, `Subscription`, `CreditWallet` (saldo), `CreditLedger` (extrato com chave de idempotência), `UsageLedger`.
- **Auditoria:** `AuditLog` (antes/depois por entidade).

As chaves estrangeiras usam `RESTRICT` para dados comerciais e históricos (nada é apagado em cascata) e `SET NULL` para referências opcionais (capa, imagem da torre, versão ativa, autor).

## Transações

Operações que gravam mais de uma tabela rodam em `prisma.$transaction`: criação de empreendimento (+ configurações, tema e auditoria), upload (asset + uso de armazenamento + versão do modelo + auditoria), mudança de status da unidade (com trava otimista + histórico + auditoria), cadastro de unidade, vínculos de planta, ativação de modelo, leads, provisionamento de administrador e seed. Se qualquer passo falhar, nada é gravado; no upload, o arquivo físico também é removido.

## Configuração

No `.env` (veja `.env.example`):

```
DATABASE_URL="mysql://USUARIO:SENHA@localhost:3306/vistahub"
SHADOW_DATABASE_URL="mysql://USUARIO:SENHA@localhost:3306/vistahub_shadow"   # só desenvolvimento
DATABASE_CONNECT_RETRIES=5   # opcional
```

Caracteres especiais na senha precisam ser codificados na URL (`@` vira `%40`).

A API tenta conectar ao subir (com novas tentativas) e encerra com mensagem clara se o MySQL estiver indisponível. `GET /api/v1/health/db` informa versão do MySQL, migrations aplicadas e latência. Erros do banco viram respostas HTTP: duplicidade → 409, relacionamento violado → 409, não encontrado → 404, banco fora do ar → 503.

## Desenvolvimento

```bash
npm install
npm run db:init -- --admin "Minha Construtora" minha-construtora "Nome Admin" admin@exemplo.com "senha-com-12-ou-mais"
npm run dev:api
```

`iniciar-vistahub.bat` faz o mesmo no Windows (cria banco/usuário, instala dependências, roda `db:init`).

Dados demonstrativos (opcional, isolados na organização `vistahub-demonstracao`):

```bash
npm run seed:demo
```

Alterar o schema: edite `prisma/schema.prisma` e gere a migration:

```bash
npm run prisma:migrate -- --name descricao_da_mudanca
```

Observação para Windows: o MySQL do Windows usa `lower_case_table_names=1`, o que faz `migrate dev` comparar nomes de tabela com caixa diferente e propor recriar tudo. Se isso acontecer, gere a migration comparando os schemas, sem banco de sombra:

```bash
npx prisma migrate diff --from-schema-datamodel schema-anterior.prisma --to-schema-datamodel prisma/schema.prisma --script
```

Salve a saída em `prisma/migrations/AAAAMMDDHHMMSS_nome/migration.sql` e aplique com `npm run prisma:deploy`.

Outros comandos:

```bash
npm run db:status
```

```bash
npm run db:check
```

## Produção

1. Crie um usuário MySQL dedicado só ao schema `vistahub` (nunca `root`).
2. Defina `DATABASE_URL` no ambiente seguro (não use `SHADOW_DATABASE_URL`).
3. Faça backup (abaixo).
4. Aplique as migrations e os planos:

```bash
npm ci
npm run db:init
```

`db:init` usa `prisma migrate deploy`, que só aplica migrations pendentes e nunca apaga dados. **Nunca rode `prisma migrate dev` nem `migrate reset` em produção.**

Primeiro administrador em produção:

```bash
npm run provision:admin -- "Construtora" slug "Nome" email "senha-forte"
```

## Atualização

Ao receber uma versão nova do código: backup, `npm ci`, `npm run db:init`, reiniciar a API. Se uma migration falhar, `npm run db:check` acusa; corrija a causa, restaure o backup se necessário e use `npx prisma migrate resolve --rolled-back NOME` antes de reaplicar.

## Backup e restauração

Backup lógico consistente (InnoDB, sem travar escrita):

```bash
mysqldump -u USUARIO -p --single-transaction --routines --triggers --set-gtid-purged=OFF vistahub > vistahub-AAAA-MM-DD.sql
```

Restauração em banco vazio:

```bash
mysql -u USUARIO -p vistahub < vistahub-AAAA-MM-DD.sql
```

Faça backup também do diretório de arquivos (`LOCAL_STORAGE_PATH` ou bucket), no mesmo momento, pois o banco guarda apenas as referências. Teste a restauração periodicamente em instância separada.

## Teste de aceite

Com a API rodando e um administrador provisionado:

```bash
node scripts/acceptance-test.mjs create http://localhost:3000 ID_DA_ORGANIZACAO email senha
```

Reinicie a API e rode:

```bash
node scripts/acceptance-test.mjs verify http://localhost:3000 ID_DA_ORGANIZACAO email senha
```

Validado em 2026-10-19 com banco MySQL 8.0.43 vazio: 4 migrations aplicadas, 39 tabelas criadas, empreendimento, torre, pavimentos, unidades, imagem da unidade e modelo GLB mantidos após reiniciar a API.
