# VistaHub — plataforma de empreendimentos interativos

Monorepo da plataforma SaaS multiempresa para criação, gestão e publicação de empreendimentos imobiliários. A referência visual original permanece em `../telas_plataforma_imobiliaria` e não é dependência de produção.

## Estado atual

A Fase 1 está estruturada: API NestJS, painel Angular com Signals, modelo Prisma multiempresa, autenticação JWT e endpoint de indicadores. As fases de upload, unidades, implantação, publicação, IA e 3D ainda não foram implementadas.

## Executar localmente

No Windows, a forma mais simples e executar `iniciar-vistahub.bat` como usuario comum. Se necessario, ele tenta instalar Node.js LTS e MySQL 8 pelo `winget`; em seguida cria `.env` com segredos locais aleatorios, cria o banco `vistahub` e seu banco de sombra, aplica as migrations e abre a API e o painel. O instalador do MySQL pode solicitar a senha root; registre-a em `MYSQL_ROOT_PASSWORD` no `.env` antes de executar o arquivo novamente.

1. Copie `.env.example` para `.env` e substitua os segredos JWT.
2. Tenha o MySQL Server 8 instalado e em execução.
3. Execute `npm install` na raiz.
4. Execute `npm run prisma:generate` e `npm run prisma:migrate -- --name init`.
5. Crie o primeiro administrador: `npm run provision:admin --workspace=@vistahub/api -- "Construtora Exemplo" construtora-exemplo "Nome Admin" admin@exemplo.com "senha-com-ao-menos-12-caracteres"`.
6. Em terminais separados, execute `npm run dev:api` e `npm run dev:admin`.

O banco inicia vazio; o comando de provisionamento acima cria somente os registros informados pelo operador.

## Decisões de arquitetura

- `organizationId` é obrigatório nas entidades de negócio e é obtido da associação do usuário autenticado — nunca do corpo da requisição.
- Dados comerciais têm histórico e relacionamentos `Restrict`; exclusões destrutivas não são usadas.
- Publicações são versionadas e separadas do rascunho editável.
- IA e 3D são filas opcionais: sem credenciais, a operação manual continua disponível.

Veja `docs/architecture.md`, `docs/database.md` e `docs/implementation-status.md`.
