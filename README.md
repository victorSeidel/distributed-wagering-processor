# Distributed Wagering Processor

Serviço financeiro que processa transações de apostas recebidas de provedores de jogos, com saldo materializado, ledger imutável, idempotência persistente e mensageria assíncrona.

---

## Sumário

1. [Requisitos](#requisitos)
2. [Subindo o Sistema](#subindo-o-sistema)
3. [Escala Horizontal](#escala-horizontal)
4. [Configuração](#configuração-variáveis-de-ambiente)
5. [Migrations](#migrations)
6. [Testes](#testes)
7. [API HTTP](#api-http)
8. [Mensageria](#mensageria)
9. [Health Checks e Métricas](#health-checks-e-métricas)
10. [Logs](#logs)
11. [Estrutura do Projeto](#estrutura-do-projeto)

---

## Requisitos

| Ferramenta | Versão | Modo | Uso |
|---|---|---|---|
| Bun | recente | Local | runtime, package manager e test runner |
| Docker + Docker Compose | recentes | Docker | PostgreSQL e LocalStack |

- `LOCALSTACK_AUTH_TOKEN` válido, definido no `.env` e/ou `.env.docker`

---

## Subindo o Sistema

### Execução Local

#### Pré-Requisitos

| Ferramenta | Versão | Uso |
|---|---|---|
| Bun | recente | runtime, package manager e test runner |

- Os serviços PostgreSQL e LocalStack já rodando.

#### Passo a Passo

```bash
# 1. Crie e preencha o arquivo de ambiente
cp .env.example .env

# 2. Instale as dependências
bun install

# 3. Aplique as migrations
bun run migration

# 4. Inicie a aplicação
bun run start
```

### Com Docker Compose

| Ferramenta | Versão | Uso |
|---|---|---|
| Docker + Docker Compose | recentes | PostgreSQL 16 e LocalStack (SQS) |

#### Passo a Passo

```bash
# 1. Crie e preencha o arquivo de ambiente
cp .env.example .env.docker

# 2. Suba a infraestrutura e a aplicação
docker compose up --build
```

#### Ordem de Inicialização

O compose garante a seguinte sequência:

1. `postgres` e `localstack` ficam saudáveis (healthchecks).
2. `migrate` aplica as migrations e termina com código 0.
3. `app` sobe somente após o `migrate` concluir com sucesso.

O LocalStack executa `localstack/init-sqs.sh` no boot e cria as três filas (`wager-transactions.fifo`, `wager-transactions-dlq.fifo` e `wager-events.fifo`).

### Ajustes no `.env`

Fora do compose, os serviços são acessados pelo host, e não pelo nome do container. Confira estes valores no `.env`:

| Variável | Docker Compose (`.env.docker`) | Local (`.env`) |
|---|---|---|
| `DB_HOST` | `postgres` | `localhost` |
| `AWS_ENDPOINT` | `http://localstack:4566` | `http://localhost:4566` |

Os valores de `DB_*` precisam ser iguais aos que o Postgres do compose usou na criação do volume.
As demais variáveis são as mesmas nos dois modos.

### Verificação Rápida

Acesse (caso execução local)

http://localhost:3000/health/ready

ou (caso via docker e com instância única)

```bash
curl -s http://localhost:3000/health/ready
```

### Derrubando Tudo

```bash
bun run infra:down
```

Esse comando é equivalente a

```bash
docker compose down -v
```

## Escala Horizontal

O serviço `app` pode rodar com várias instâncias. O código é seguro para múltiplas réplicas
(ver `ARCHITECTURE.md`, seção de concorrência). Para isso, duas condições precisam ser atendidas:

1. **Sem nome de container fixo.** O serviço `app` não define `container_name`, justamente para que o Compose possa nomear as réplicas automaticamente.
2. **Sem porta fixa no host.** O mapeamento `ports: "3000:3000"` faz todas as réplicas disputarem a mesma porta do host. Para escalar, troque-o por `expose`:

```yaml
   # docker-compose.yml (serviço app)
   # ports:
   #   - "3000:3000"
   expose:
     - "3000"
```

Com `expose`, a porta 3000 fica acessível apenas dentro da rede do Docker, e não mais em `localhost:3000`. É necessário colocar um balanceador/gateway na frente.

Depois disso, suba N instâncias com `--scale`:

```bash
# Exemplo: 3 instâncias da aplicação
docker compose up -d --build --scale app=3
```

> **Atenção:** com `expose` e sem gateway, a aplicação não fica acessível pelo host, então o
> `curl` de verificação acima só funciona a partir de dentro da rede do Docker ou através do
> balanceador.

## Configuração (variáveis de ambiente)

| Variável | Padrão | Obrigatória | Descrição |
|---|---|---|---|
| `PORT` | `3000` | não | porta HTTP |
| `NODE_ENV` | — | não | use `production` em ambientes reais |
| `LOG_LEVEL` | `info` | não | `debug` habilita logs de depuração |
| `SERVICE_NAME` | `wagering-processor` | não | campo `service` nos logs JSON |
| `DB_HOST` / `DB_PORT` | `postgres ` / `5432` | sim | PostgreSQL |
| `DB_USER` / `DB_PASS` / `DB_NAME` | `postgres` / — / `wageringdb` | sim | credenciais e banco |
| `MIKRO_ORM_DEBUG` | `false` | não | loga queries SQL (contém valores; use só em diagnóstico) |
| `AWS_REGION` | — | sim | região das filas |
| `AWS_ENDPOINT` | — | sim| endpoint SQS (ex.: `http://localstack:4566`) |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | — | sim | credenciais (LocalStack aceita qualquer valor) |
| `LOCALSTACK_AUTH_TOKEN` | — | não | usado apenas pelo serviço `localstack` no compose |

---

## Migrations

As migrations são versionadas, transacionais e possuem `down`.

```bash
bun run migration          # aplica pendentes
bun run migration:up       # aplica via mikro-orm cli
bun run migration:down     # reverte a última
bun run migration:create   # gera uma nova a partir das entidades
```

Todas as garantias de integridade ficam no **schema** (CHECKs, UNIQUEs, FKs, índices parciais, trigger de imutabilidade do ledger). Veja `ARCHITECTURE.md`, seção "Schema".

---

## Testes

```bash
bun test tests/unit         # domínio e utilitários; não exige infraestrutura
bun run test:integration    # SQS (retry, DLQ) e PostgreSQL (constraints, idempotência, mensageria, referências, reconciliação)
bun run test:concurrency    # paralelismo, inclusive com 3 processos Bun independentes
```

Os testes de integração e concorrência usam a infraestrutura real. Eles leem a configuração de `DB_*` e `AWS_ENDPOINT` e precisam da infra de pé:

```bash
bun run infra:up
bun run migration
bun run test:integration
```

Os testes de concorrência cobrem: 50 requisições idênticas em paralelo, duas apostas disputando o mesmo saldo, wallets distintas em paralelo, três processos independentes, dois publishers sobre a mesma outbox, REFUND entregue antes da referência e reinício a frio.

---

## API HTTP

Todos os valores monetários são **objetos** `{ "amount": "25.00", "currency": "BRL" }`, com `amount` em string decimal de até 2 casas.

Header opcional `X-Correlation-Id` é propagado em logs e na resposta. Se ausente, é gerado.

### Wallets

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/wallets` | cria a wallet de um jogador na moeda do saldo inicial |
| `GET` | `/wallets/:walletId` | consulta saldo e versão |
| `GET` | `/wallets/:walletId/ledger?cursor=&limit=` | extrato paginado (limite 1–100, padrão 50) |
| `POST` | `/wallets/:walletId/reconciliation` | compara saldo materializado com o ledger |

Exemplo:

```bash
curl -X POST http://localhost:3000/wallets \
  -H 'content-type: application/json' \
  -d '{"playerId":"0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1","initialBalance":{"amount":"1000.00","currency":"BRL"}}'
```

Um saldo inicial positivo gera a transação interna `OPENING` e um lançamento CREDIT.

### Transações de aposta

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/wagering/transactions` | submete uma transação (**header `Idempotency-Key` obrigatório**) |
| `GET` | `/wagering/transactions/:transactionId` | consulta pelo id interno |
| `GET` | `/providers/:providerId/wagering/transactions/:externalTransactionId` | consulta pelo id do provedor |

Exemplo:

```bash
curl -X POST http://localhost:3000/wagering/transactions \
  -H 'content-type: application/json' \
  -H 'Idempotency-Key: provider-a:transaction-123' \
  -d '{
    "providerId": "provider-a",
    "externalTransactionId": "transaction-123",
    "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
    "walletId": "0192f291-27dd-7d3f-8071-5f8685deef37",
    "roundId": "round-987",
    "gameId": "fortune-chimp",
    "kind": "BET",
    "money": { "amount": "25.00", "currency": "BRL" }
  }'
```

Para REFUND e ROLLBACK, inclua `"referenceExternalTransactionId": "<id do provedor da transação original>"`.

### Códigos de resposta

| Status | Quando |
|---|---|
| `200` | transação processada (inclui LOSS) ou replay idempotente |
| `202` | aceita, com a referência ainda ausente (`PENDING_REFERENCE`) |
| `400` | payload inválido, header ausente, UUID malformado, `limit`/`cursor` inválidos, `OPENING` submetido |
| `404` | wallet ou transação não encontrada |
| `409` | conflito: mesma `Idempotency-Key` com payload diferente, mesmo `externalTransactionId` com outra chave, wallet duplicada, moeda divergente |
| `422` | rejeição por regra de negócio (corpo traz `failureCode`) |
| `503` | falha transitória de infraestrutura (com `Retry-After`); pode reenviar |
| `500` | erro inesperado (mensagem interna não é exposta) |

Os corpos de erro seguem o formato `{ "statusCode", "code", "message" }`. As respostas de transação seguem `{ "transactionId", "status", "balance", "idempotentReplay", "failureCode"? }`.

### Failure codes

Os códigos são estáveis e legíveis por máquina, para o provedor decidir se corrige o payload, reenvia ou desiste:

| Código | Significado | Ação sugerida ao provedor |
|---|---|---|
| `INSUFFICIENT_FUNDS` | saldo insuficiente para a aposta | não reenviar sem alterar a situação |
| `REVERSAL_WOULD_PRODUCE_NEGATIVE_BALANCE` | reversão deixaria saldo negativo | operacional; investigar |
| `REFERENCE_NOT_FOUND` | referência não apareceu no prazo | investigar a origem da referência |
| `REFERENCE_NOT_PROCESSED` | referência existe mas foi rejeitada | não reenviar a reversão |
| `REFERENCE_ALREADY_REVERSED` | referência já revertida pelo mesmo tipo | não reenviar |
| `INVALID_REFERENCE_TYPE` | tipo de referência não permitido (ex.: REFUND de WIN) | corrigir o payload |
| `REFERENCE_MISMATCH` | jogador, wallet, rodada ou moeda divergentes | corrigir o payload |
| `AMOUNT_MISMATCH` | valor diferente da referência | corrigir o payload |
| `PLAYER_MISMATCH` | jogador não pertence à wallet | corrigir o payload |
| `IDEMPOTENCY_CONFLICT` | chave reutilizada com outro payload | usar uma chave nova |

### Reconciliação

```bash
curl -X POST http://localhost:3000/wallets/<walletId>/reconciliation
```

Resposta (HTTP 200): `consistent: true` quando saldo e ledger batem. Divergências **não** são corrigidas: são logadas em nível `error`, contabilizadas em métrica e sinalizadas com `consistent: false` e `difference`.

---

## Mensageria

| Fila | Papel |
|---|---|
| `wager-transactions.fifo` | **comandos** de entrada, consumidos pela aplicação |
| `wager-transactions-dlq.fifo` | mensagens permanentemente inválidas (após erro permanente ou 5 recebimentos) |
| `wager-events.fifo` | **eventos** de integração publicados pela outbox |

Mensagem de comando esperada:

```json
{
  "messageId": "msg-123",
  "type": "WagerTransactionRequested",
  "occurredAt": "2026-07-29T15:00:00.000Z",
  "data": {
    "providerId": "provider-a",
    "externalTransactionId": "transaction-123",
    "idempotencyKey": "provider-a:transaction-123",
    "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
    "walletId": "0192f291-27dd-7d3f-8071-5f8685deef37",
    "roundId": "round-987",
    "gameId": "fortune-chimp",
    "kind": "BET",
    "money": { "amount": "25.00", "currency": "BRL" }
  }
}
```

Tratamento por classe de erro:

| Classe | Exemplos | Ação |
|---|---|---|
| negócio | wallet inexistente, conflito de idempotência | `ack` (descartada, registrada em log) |
| permanente | JSON inválido, tipo não suportado, valor inválido, payload divergente do inbox | envio à DLQ com `ErrorCode`, depois `ack` |
| transitória | banco ou rede indisponível | nova visibilidade com backoff exponencial (5 s, 10 s, 20 s… máx. 300 s, com jitter); após 5 recebimentos o redrive move para a DLQ |

O `ack` só ocorre após o commit da transação. Em `SIGTERM` o consumidor termina a mensagem em curso e devolve a visibilidade das demais do lote.

---

## Health Checks e Métricas

Essas rotas não necessitam de autenticação.

| Rota | Conteúdo |
|---|---|
| `GET /health/live` | processo vivo (`200`) |
| `GET /health/ready` | PostgreSQL e as duas filas SQS alcançáveis (`200` ou `503`, com detalhe em `checks`) |
| `GET /metrics` | métricas no formato Prometheus |

Principais métricas (prefixo `wager_`):

| Métrica | Tipo | Labels |
|---|---|---|
| `wager_transactions_total` | counter | `kind`, `status`, `failure_code` |
| `wager_duplicates_detected_total` | counter | `channel` |
| `wager_idempotency_conflicts_total` | counter | — |
| `wager_retries_total` | counter | `component` |
| `wager_dlq_messages_total` | counter | `reason` |
| `wager_lock_conflicts_total` | counter | `resource` (`wallet`, `advisory`, `deadlock`) |
| `wager_outbox_lag_seconds` | gauge | — |
| `wager_outbox_published_total` | counter | — |
| `wager_processing_duration_seconds` | histogram | `channel`, `outcome` |
| `wager_reconciliation_divergences_total` | counter | — |
| `http_request_duration_seconds` | histogram | `method`, `route`, `status` |

Os labels nunca carregam ids de wallet, jogador ou transação, nem valores monetários, para manter a cardinalidade limitada.

---

## Logs

Logs são **JSON estruturado**, uma linha por evento, com `timestamp`, `level`, `service`, `message`, `correlationId`, `messageId` e os campos de contexto (`transactionId`, `walletId`, `providerId`, `failureCode` etc.).

Redação automática: campos cujo nome contém `amount`, `money`, `balance`, `payload`, `body`, `password`, `secret`, `token`, `authorization`, `credential`, `cookie`, `apikey`, `document`, `cpf` ou `email` são substituídos por `[REDACTED]`. Objetos aninhados viram marcador e strings são truncadas. Logs HTTP não registram corpo nem query string.

---

## Estrutura do Projeto

```
src/
├── index.ts, app.module.ts        bootstrap e módulo raiz
├── migrate.ts                     executa as migrations (usado pelo serviço migrate do compose)
├── domain/                        regras puras, sem NestJS nem banco
│   ├── shared/                    Money, erros da taxonomia, hash canônico
│   ├── wager/                     WagerTransaction, WagerSettlement (serviço de domínio), enums
│   ├── wallet/                    Wallet (aggregate root), WalletLedgerEntry, direção
│   ├── messaging/                 InboxMessage, OutboxMessage
│   └── events/                    envelopes de eventos de integração
├── application/                   casos de uso e portas
│   ├── usecases/                  um arquivo por caso de uso
│   ├── services/                  WagerSettlementService, ReferenceRetryPolicy
│   ├── ports/                     interfaces de repositórios, UnitOfWork, consultas, observabilidade
│   ├── dto/                       comandos e respostas da camada de aplicação
│   ├── validation/                validação de entrada (HTTP e SQS compartilham)
│   └── errors.ts                  erros de aplicação
└── infra/                         adaptadores
    ├── http/                      controllers, filtro de erros, middleware, guard (ponto de extensão)
    ├── messaging/sqs/             consumidor de comandos, publicador de eventos, cliente SQS
    ├── workers/                   agendadores: outbox e referências pendentes
    ├── persistence/               MikroORM: entidades, mappers, repositórios, UnitOfWork, consultas, migrations
    ├── observability/             logger JSON, redação, métricas Prometheus, contexto de requisição
    └── health/                    readiness
tests/
├── unit/                          domínio, Money, liquidação, redação de logs, mapeamento HTTP
├── integration/                   SQS: retry, DLQ e PostgreSQL: constraints, idempotência, mensageria, referências, reconciliação
├── concurrency/                   paralelismo e processos independentes
└── support/                       montagem do grafo de objetos para testes
localstack/init-sqs.sh             provisionamento das filas
```