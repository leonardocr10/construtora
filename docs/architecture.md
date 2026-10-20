# Arquitetura técnica

## Aplicações

- `apps/admin-web`: Angular, painel autenticado e gestão interna.
- `apps/public-web`: futuro shell Angular sem autenticação para a URL pública.
- `apps/api`: NestJS REST, OpenAPI, regras de autorização e persistência.
- `apps/worker`: futuro consumidor BullMQ para processamento de arquivos, IA e 3D.

## Referência de interface

Os 26 layouts em `D:/construtora/vistahub_telas` são a referência visual do produto. Eles cobrem do dashboard à publicação, visualizador público, leads, analytics, usuários, organização e planos. São mockups, portanto métricas, preços, disponibilidade, leads e nomes exibidos neles não são dados de produção e não serão usados como seed. Os arquivos de imagem do material Union Vista só devem ser exibidos quando houver direito de uso.

## Isolamento multiempresa

O token contém o usuário e a organização ativa. O guard resolve essa associação em `organization_users`; os serviços recebem este contexto e filtram por `organizationId`. Identificadores sozinhos não são autorização. Para uma organização diferente, a API responde como recurso inexistente.

## Fluxo prioritário

Cadastro de empreendimento → upload de implantação → torres → gerador de unidades → espelho → regiões → publicação. IA e modelo 3D são extensões assíncronas, revisáveis e nunca fontes automáticas de dados comerciais.

## Entidades e retenção

`sales_status_history`, `audit_logs`, `leads`, `publication_versions` e `usage_ledger` são registros históricos. Operações de negócio relevantes usam `Restrict`; o arquivamento lógico é preferível à exclusão.
