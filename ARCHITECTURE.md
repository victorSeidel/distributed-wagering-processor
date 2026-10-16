# Arquitetura e Decisões Técnicas

- [1. Visão Geral e Garantias](#1-visão-geral-e-garantias)
- [2. Organização em Camadas](#2-organização-em-camadas)
- [3. Modelo de Domínio](#3-modelo-de-domínio)
- [4. Dinheiro (Money)](#4-dinheiro-money)
- [5. Schema do Banco e Onde as Garantias Vivem](#5-schema-do-banco-e-onde-as-garantias-vivem)
- [6. Concorrência e Locks](#6-concorrência-e-locks)
- [7. Idempotência](#7-idempotência)
- [8. Regras de Liquidação e Interpretações Adotadas](#8-regras-de-liquidação-e-interpretações-adotadas)
- [9. Referências Fora de Ordem](#9-referências-fora-de-ordem)
- [10. Transactional Outbox](#10-transactional-outbox)
- [11. Inbox e Consumo de SQS](#11-inbox-e-consumo-de-sqs)
- [12. Contratos de Evento](#12-contratos-de-evento)
- [13. Códigos de Falha e Mapeamento HTTP](#13-códigos-de-falha-e-mapeamento-http)
- [14. Autenticação](#14-autenticação)
- [15. Observabilidade](#15-observabilidade)
- [16. Estratégia de Testes](#16-estratégia-de-testes)
- [17. Implantação e Escala](#17-implantação-e-escala)
- [18. Trade-offs e Limitações](#18-trade-offs-e-limitações)

---

## 1. Visão Geral e Garantias

O sistema recebe transações de apostas de provedores (at-least-once), aplica-as a uma carteira por jogador e mantém duas representações do mesmo fato: o **saldo materializado** (`wallets.balance`) e o **ledger** (`wallet_ledger_entries`), que é append-only. O objetivo é que as duas nunca divirjam.

Invariantes que o sistema sustenta, e onde cada uma é garantida:

| Invariante | Garantia principal | Verificação complementar |
|---|---|---|
| Saldo nunca negativo | `CHECK (balance >= 0)` no banco | `WagerSettlement` recusa débito sem saldo |
| Nenhum débito/crédito duplicado | idempotência persistente (`UNIQUE idempotency_key`) + inbox | replay devolve o resultado original |
| Saldo = soma do ledger | toda movimentação gera lançamento na mesma transação | `POST /wallets/:id/reconciliation` |
| Ledger imutável | trigger `BEFORE UPDATE OR DELETE` | testes de integração por SQL direto |
| Um lançamento por transação | `UNIQUE (transaction_id)` no ledger | teste de integração |
| Uma reversão por referência e tipo | índice parcial único | `REFERENCE_ALREADY_REVERSED` no domínio |
| Evento só após commit | outbox gravada na mesma transação | publicação posterior, por worker |
| Sem perda de evento confirmado | outbox persistente, com retry | teste de recuperação após crash |

O sistema é **at-least-once** para entrada e saída, e **exatamente-uma-vez no efeito financeiro**: uma mesma operação pode ser entregue várias vezes, mas só altera o saldo uma vez.

---

## 2. Organização em Camadas

```
          ┌──────────────────────────────────────────────────────────┐
          │ infra/http  ·  infra/messaging/sqs  ·  infra/workers     │  entrada e agendadores
          └────────────────────────────┬─────────────────────────────┘
                                       │ chamam casos de uso
          ┌────────────────────────────▼─────────────────────────────┐
          │ application: use-cases · services · ports · dto · errors │  orquestração
          └────────────────────────────┬─────────────────────────────┘
                                       │ usa interfaces (portas)
          ┌────────────────────────────▼─────────────────────────────┐
          │ domain: Money · Wallet · WagerTransaction · Settlement   │  regras puras
          └──────────────────────────────────────────────────────────┘
                                       ▲
          ┌────────────────────────────┴─────────────────────────────┐
          │ infra/persistence (MikroORM) · infra/observability · …   │  implementa as portas
          └──────────────────────────────────────────────────────────┘
```

Regras de dependência:

- **Domínio** não importa NestJS, MikroORM, AWS nem `EntityManager`. Testável sem nenhuma infraestrutura.
- **Aplicação** depende apenas de **portas** (classes abstratas e interfaces). Os casos de uso recebem `UnitOfWork`, repositórios, `Metrics`, `AppLogger` por injeção.
- **Infraestrutura** implementa as portas. É o único lugar que conhece `EntityManager`, entidades ORM, SQL e SDK da AWS.
- Os **controllers** são finos: validam o transporte (header, UUID) e delegam. Não contêm regra de negócio.

### Por que portas e não acesso direto ao ORM

O domínio não depende do ORM e as garantias são testáveis. Com portas:

- os casos de uso são testados com a infraestrutura real, mas sem acoplamento a `EntityManager` no código de aplicação;
- trocar MikroORM por outro acesso a dados afeta somente `infra/persistence`;
- a fronteira transacional é explícita: um único `UnitOfWork.run()` define o que é confirmado junto.

---

## 3. Modelo de Domínio

### Aggregates e objetos de valor

| Tipo | Papel | Estado mutável? |
|---|---|---|
| `Money` | valor monetário (decimal exato + moeda) | não (imutável) |
| `Wallet` | **aggregate root**: saldo, versão, aplica movimentações | sim (saldo, versão), só via `debit`/`credit` |
| `WalletLedgerEntry` | lançamento contábil | **não** (sem setters nem transições) |
| `WagerTransaction` | transação de aposta com máquina de estados | sim, só via transições |
| `InboxMessage` | registro de deduplicação de mensagem recebida | só `markProcessed` |
| `OutboxMessage` | evento aguardando publicação | só `markPublished` e `scheduleRetry` |

### Máquina de estados de `WagerTransaction`

```
PENDING ──► PROCESSED   (terminal)
   │
   ├──────► REJECTED    (terminal)
   │
   ├──────► FAILED      (terminal, reservado para erro permanente de infraestrutura)
   │
   └──► PENDING_REFERENCE ──► PROCESSED | REJECTED | FAILED
```

Qualquer transição fora desse grafo lança `InvalidTransactionStateError`, que é um erro de programação. `PROCESSED`, `REJECTED` e `FAILED` são terminais: após atingi-los, nenhuma transição é aceita.

### Regra de quem decide o desfecho

`WagerSettlement` (serviço de domínio, sem I/O) recebe a wallet, a transação e a referência já carregadas e devolve um de três desfechos: `PROCESSED` (com o lançamento, se houver), `REJECTED` (com o código de falha) ou `AWAITING_REFERENCE`. Ele muta o agregado de forma consistente: saldo, versão, estado e saldo observado.

A camada de aplicação só carrega dados, chama o domínio e persiste o resultado. Isso mantém a regra em um único lugar, usada tanto pelo fluxo HTTP/SQS quanto pelo worker de referências pendentes.

### Rehydrate

`rehydrate` reconstrói o agregado a partir do banco **sem revalidar transições**. Validações ocorrem apenas na criação e nas operações de negócio.

---

## 4. Dinheiro (Money)

### Representação

- Na **API, nos eventos e na outbox**, valores são strings decimais com 2 casas (`"25.00"`).
- Internamente, `Money` usa `decimal.js` (precisão 28, arredondamento `ROUND_HALF_UP`).
- No banco, `numeric(18,2)`. A leitura reidrata via string para `Money`.

### Entrada

`Money.from` aceita somente: string não vazia, sem notação científica, sem `NaN`/`Infinity`, no máximo 2 casas e **não negativa**. Moeda deve ter 3 letras e é normalizada para maiúsculas. Violações viram `InvalidInputError`.
`Money.fromSigned` existe **somente** para diagnóstico na reconciliação, onde um saldo calculado pode ser negativo em caso de corrupção. Não é usado em contratos de entrada.

### Operações

Soma, subtração e comparação exigem a mesma moeda; caso contrário, `CurrencyConflictError`. Todas as operações devolvem novas instâncias.

### Por que escala fixa de 2

Todas as entradas são limitadas a 2 casas. Como soma e subtração de valores de 2 casas continuam com 2 casas, o arredondamento nunca é acionado no fluxo atual. O `ROUND_HALF_UP` fica configurado como salvaguarda para futuras operações (por exemplo, taxas proporcionais).

---

## 5. Schema do Banco e Onde as Garantias Vivem

A unicidade, imutabilidade e não-negatividade estão **no schema**. As constraints atuais:

| Tabela | Garantia | Tipo |
|---|---|---|
| `wallets` | `UNIQUE (player_id, currency)` | unicidade |
| `wallets` | `balance >= 0` | CHECK |
| `wallets` | `currency ~ '^[A-Z]{3}$'` | CHECK |
| `wager_transactions` | `UNIQUE (idempotency_key)` | unicidade (idempotência) |
| `wager_transactions` | `UNIQUE (provider_id, external_transaction_id)` | unicidade (id do provedor) |
| `wager_transactions` | `amount > 0` | CHECK |
| `wager_transactions` | `reference_attempts >= 0` | CHECK |
| `wager_transactions` | índice parcial `UNIQUE (reference_transaction_id, kind) WHERE status = 'PROCESSED' AND kind IN ('REFUND','ROLLBACK')` | unicidade de reversão |
| `wager_transactions` | FK `wallet_id → wallets` | integridade referencial |
| `wallet_ledger_entries` | `UNIQUE (transaction_id)` | um lançamento por transação |
| `wallet_ledger_entries` | `amount > 0`, `balance_before >= 0`, `balance_after >= 0` | CHECK |
| `wallet_ledger_entries` | `(CREDIT ∧ after = before + amount) ∨ (DEBIT ∧ after = before − amount)` | CHECK aritmético |
| `wallet_ledger_entries` | trigger `BEFORE UPDATE OR DELETE` → exceção | imutabilidade |
| `inbox_messages` | `PRIMARY KEY (consumer_name, message_id)` | deduplicação |
| `outbox_messages` | `attempts >= 0`; índice `(published_at, next_attempt_at)` | consistência e busca de pendentes |

### Histórico de migrations

As migrations estão em `src/infra/persistence/migrations/`.

### Por que triggers e CHECKs e não só código

A aplicação pode ter bugs, ser executada por outro processo ou ter um acesso manual feito por engano. O banco é a última linha de defesa. Os testes de integração acessam o banco por SQL direto justamente para comprovar que a proteção não depende do código.

---

## 6. Concorrência e Locks

### Unidade de concorrência: a wallet

A estratégia adotada tem três camadas, cada uma com um papel:

1. **Lock de idempotência por chave** (`pg_advisory_xact_lock(hashtextextended(idempotency_key))`). Serializa requisições com a mesma chave, inclusive entre instâncias. Acontece antes de qualquer leitura de saldo, então duas requisições idênticas nunca disputam a wallet.
2. **Lock pessimista da wallet** (`SELECT ... FOR UPDATE`). Serializa todas as operações sobre o mesmo saldo. Dentro da transação, a leitura do saldo, a decisão e a escrita acontecem sem interferência.
3. **Constraints no banco** como última barreira (`CHECK balance >= 0`).

Wallets distintas nunca se bloqueiam entre si: o lock é por linha, não global.

### Por que pessimista e não otimista

| Critério | Pessimista (escolhido) | Otimista com versão |
|---|---|---|
| Correção sob contenção | garantida | depende de retry limitado |
| Hot wallet (muitas apostas no mesmo saldo) | fila por linha, previsível | retries em cascata |
| Complexidade | menor | retry, backoff e limite de tentativas |
| Custo | segura o lock durante a transação (curta) | sem lock, mas com conflitos |

A versão (`version`) existe e é incrementada a cada mudança de saldo, mas a serialização é feita pelo lock. Ela serve para auditoria e para o lançamento (`walletVersion` no evento).

### Ordem de aquisição de locks

Para evitar deadlocks, a ordem é sempre a mesma:

1. inbox (`advisory`, por `consumer:messageId`), quando a entrada é SQS;
2. chave de idempotência (`advisory`);
3. wallet (`FOR UPDATE`);
4. transação de referência (`FOR UPDATE SKIP LOCKED`, no worker, sem bloquear).

O worker de referências pendentes reserva a transação **antes** de travar a wallet e não usa advisory lock, então não há ciclo com o fluxo HTTP/SQS.

### Ausência de lock global

Não há lock compartilhado por todas as wallets nem `LOCK TABLE`. Testes de concorrência cobrem wallets distintas em paralelo.

### Observação de contenção

Esperas acima de 50 ms em locks são contabilizadas em `wager_lock_conflicts_total`, por recurso. Isso dá visibilidade de hot wallets sem instrumentar cada query.

---

## 7. Idempotência

### Chave e fonte da verdade

- A **`Idempotency-Key`** (header) é a fonte da verdade. O header é obrigatório: sua ausência responde `400`.
- Ela é **única no banco** (`UNIQUE`), e a tabela guarda o `payload_hash` da primeira requisição.
- A identidade de negócio do provedor (`providerId + externalTransactionId`) também é única no banco. Uma mesma transação do provedor enviada com outra chave gera `409 DUPLICATE_EXTERNAL_TRANSACTION`, e não um segundo débito.

### Payload hash

O hash é SHA-256 do **JSON canônico** dos campos de negócio:

- campos incluídos: `providerId`, `externalTransactionId`, `playerId`, `walletId`, `roundId`, `gameId`, `kind`, `money` (já normalizado: `{amount, currency}`), `referenceExternalTransactionId` (ou `null`);
- campos excluídos: header `Idempotency-Key`, `correlationId`, headers de transporte e metadados;
- canonicalização: chaves de objeto ordenadas lexicograficamente, recursivamente; arrays preservam a ordem; primitivos via `JSON.stringify`.

Consequência: `"25.5"` e `"25.50"` produzem o mesmo hash porque o valor é normalizado antes de entrar no payload.

### Comportamento

| Situação | Resultado |
|---|---|
| mesma chave, mesmo payload | replay: mesma resposta, `idempotentReplay: true` |
| mesma chave, payload diferente | `409 IDEMPOTENCY_CONFLICT`, sem efeito |
| chave nova, mesmo `externalTransactionId` | `409 DUPLICATE_EXTERNAL_TRANSACTION`, sem efeito |
| chave nova, `externalTransactionId` novo | processamento normal |

### Replay devolve o saldo original

A transação grava o **saldo observado ao concluí-la** (`balance_after`). O replay devolve esse valor, e não o saldo atual. Transações antigas sem o campo caem no saldo atual, e esse caso é o único em que o replay pode diferir do original.

### Por que não cache em memória

A deduplicação é uma consulta ao banco sob lock, válida entre instâncias e entre reinícios.

---

## 8. Regras de Liquidação e Interpretações Adotadas

| Operação | Efeito no saldo | Ledger | Validações (em ordem) |
|---|---|---|---|
| `BET` | débito | 1 DEBIT | jogador, saldo suficiente |
| `WIN` | crédito | 1 CREDIT | jogador |
| `LOSS` | nenhum | nenhum | jogador; registra `PROCESSED` |
| `REFUND` | crédito do valor da referência | 1 CREDIT | referência resolvida e `PROCESSED`, tipo `BET`, mesmos jogador/wallet/rodada/moeda, valor igual, sem reversão anterior do mesmo tipo |
| `ROLLBACK` | inverso da referência | 1 lançamento invertido | referência resolvida e `PROCESSED`, tipo `BET`, `WIN` ou `REFUND`, mesmos dados, valor igual, sem reversão anterior do mesmo tipo, saldo suficiente se for débito |

### Interpretações

1. **LOSS** é `PROCESSED`, não move saldo, não incrementa `version` e não gera lançamento. Emite `WagerTransactionProcessed`, mas não `WalletBalanceChanged`.
2. **Rejeições** (`REJECTED`) não alteram saldo nem geram lançamento, mas são gravadas com `failure_code` e geram `WagerTransactionRejected` na outbox. São auditáveis.
3. **Operação sem saldo suficiente** (`INSUFFICIENT_FUNDS`) e **reversão que deixaria saldo negativo** (`REVERSAL_WOULD_PRODUCE_NEGATIVE_BALANCE`) são códigos **distintos**. Uma é a situação do jogador; a outra é operacional.
4. **Reversões repetidas**: a regra 4 diz "não pode ser revertida duas vezes pelo mesmo tipo de operação". Interpretamos que `REFUND` e `ROLLBACK` são tipos distintos: a mesma `BET` pode ser reembolsada uma vez e revertida uma vez. O índice parcial aplica exatamente isso (por `kind`).
5. **ROLLBACK de ROLLBACK** é recusado (`INVALID_REFERENCE_TYPE`), porque a regra 3 limita a referência a `BET`, `WIN` ou `REFUND`.
6. **Valor da reversão** deve ser igual ao da referência (regra 5). Reversão parcial não existe.
7. **OPENING** é interno. Não pode ser submetido por API nem por fila (`400`). É criado somente pela abertura de wallet com saldo positivo, junto com seu lançamento CREDIT.
8. **Divergência de jogador** entre a transação e a wallet gera `PLAYER_MISMATCH` antes de qualquer outra regra.
9. **Divergência de rodada, jogador ou moeda** na referência gera `REFERENCE_MISMATCH`. Valor divergente gera `AMOUNT_MISMATCH`. São códigos separados porque a ação do provedor é diferente.
10. **Referência rejeitada** gera `REFERENCE_NOT_PROCESSED`. Essa é a correção do "crédito fantasma": só uma referência efetivamente aplicada pode ser revertida.

---

## 9. Referências Fora de Ordem

REFUND e ROLLBACK podem chegar antes da operação que referenciam.

### Fluxo

1. A referência não existe, ou ainda está `PENDING`/`PENDING_REFERENCE`: a transação é gravada como `PENDING_REFERENCE`, um evento `WagerTransactionPendingReference` é enfileirado e a resposta é `202`.
2. O worker `PendingReferenceWorker` roda a cada 3 s e processa até 20 transações por ciclo. Cada transação é reservada com `SELECT ... FOR UPDATE SKIP LOCKED` dentro da transação que a aplica, então várias instâncias não processam a mesma transação.
3. Ao reprocessar, a regra é a **mesma** do fluxo HTTP/SQS (`WagerSettlementService`). Se a referência chegou e está `PROCESSED`, a transação é aplicada. Se foi rejeitada, vira `REFERENCE_NOT_PROCESSED`.
4. Se a referência continua ausente, o número de tentativas aumenta e a próxima é agendada com backoff exponencial (base 2 s, máximo 60 s, com jitter de 50%).

### Política de expiração

Uma transação expira quando **um dos dois limites** é atingido:

- **TTL de 5 minutos** desde a criação;
- **10 tentativas**.

A escolha de 5 minutos cobre a defasagem típica entre provedores e filas sem manter pendências por tempo excessivo. Dez tentativas com backoff limitado a 60 s evitam martelar o banco. Esgotado o limite, a transação vira `REJECTED` com `REFERENCE_NOT_FOUND` e `WagerTransactionRejected` é publicado. Os dois valores são constantes da classe `ReferenceRetryPolicy`; alterá-los exige novo build.

### Garantias

- Uma referência é aplicada no máximo uma vez: o reprocessamento roda dentro de uma transação com a wallet travada, e o índice parcial impede a segunda reversão do mesmo tipo.
- Reprocessamento repetido (várias passadas do worker) não duplica efeito, porque o estado é relido após o lock.

---

## 10. Transactional Outbox

### Por que outbox

Gravar no banco e publicar no broker são duas operações sem transação comum. Publicar antes do commit pode gerar evento de algo que não aconteceu; publicar depois pode perder o evento se o processo morrer entre as duas. A outbox resolve isso gravando o evento **na mesma transação** da mudança de estado e publicando depois, em outro processo.

### Como funciona

- Os eventos são gravados em `outbox_messages` na mesma transação de wallet, transação, ledger e (quando há) inbox.
- `PublishOutboxUseCase` roda a cada 500 ms, reserva um lote de até 25 mensagens devidas com `FOR UPDATE SKIP LOCKED` e publica cada uma.
- Publicação bem-sucedida marca `published_at` no commit do lote. Falha agenda nova tentativa com backoff exponencial (1 s, 2 s, 4 s… máximo 60 s).
- Vários publishers rodam em paralelo sem processar o mesmo evento: o `SKIP LOCKED` garante isso no banco.

### Garantias e o que não é garantido

- **At-least-once** para o broker: se o processo morrer depois de publicar e antes do commit do lote, o evento é publicado de novo. Isso é aceitável porque:
  - o `eventId` é o `MessageDeduplicationId` (FIFO descarta duplicatas dentro da janela de deduplicação do SQS);
  - o consumidor pode ignorar eventos já vistos pelo `eventId`.
- **Ordem**: o `MessageGroupId` é o `aggregateId`, então eventos de um mesmo agregado seguem ordem FIFO.

### Cenário de falha comprovado

O teste de integração `Crash após o commit e antes da publicação` grava uma transação, descarta a instância sem publicar e comprova que outra instância publica o evento.

---

## 11. Inbox e Consumo de SQS

### Fluxo de um comando

1. `SqsCommandConsumer` recebe até 10 mensagens com `ReceiveMessage` (long polling de 5 s, visibilidade de 30 s).
2. Valida o envelope (`type`, `messageId`, `data`).
3. Chama **o mesmo caso de uso** da entrada HTTP (`ProcessWagerUseCase`), passando o inbox.
4. No caso de uso, dentro de **uma transação SQL**: grava ou reconhece o registro de inbox `(consumer, messageId)`, aplica a transação, grava ledger e outbox, e marca o inbox como processado.
5. Só após o commit, o consumidor faz `DeleteMessage` (ack).

### Redelivery

Se o ack se perder, a mensagem volta. A reentrega encontra o inbox já processado (ou a chave de idempotência) e devolve o resultado original sem efeito. O teste `Redelivery da mesma mensagem` comprova isso em nível de caso de uso e de SQS.

Se o `messageId` voltar com **payload diferente**, o inbox detecta pelo hash e lança `InboxPayloadMismatchError` (permanente, DLQ). Esse é um sinal de bug do provedor ou de corrupção, e não deve ser processado.

### Classes de erro e destino

| Classe | Exemplos | Destino |
|---|---|---|
| negócio | wallet inexistente, conflito de idempotência | `ack` (log `warn`) |
| permanente | JSON inválido, tipo não suportado, valor inválido, payload divergente | DLQ com `ErrorCode`, depois `ack` |
| transitória | banco ou rede indisponível | nova visibilidade com backoff (5 s base, máx. 300 s, jitter); após 5 recebimentos, redrive para a DLQ |

Erros desconhecidos são tratados como transitórios: é mais seguro reentregar do que perder uma mensagem.

### Shutdown

Em `SIGTERM`, o consumidor termina a mensagem em andamento e devolve a visibilidade das demais do lote (`ChangeMessageVisibility = 0`), para que outra instância as pegue imediatamente.

### Por que SQS FIFO não basta

A deduplicação do broker é uma **otimização** dentro de uma janela de tempo. A garantia de não duplicar efeito fica no banco (inbox, idempotência e constraints).

---

## 12. Contratos de Evento

Todo evento tem um envelope comum, serializado em JSON na outbox e na fila:

```json
{
  "eventId": "0192f2a0-…",
  "eventType": "WalletBalanceChanged",
  "aggregateId": "0192f291-…",
  "correlationId": "0192f2a0-…",
  "causationId": "msg-123",
  "occurredAt": "2026-07-29T15:00:00.000Z",
  "version": 1,
  "data": { }
}
```

| Evento | Quando é emitido | Dados principais |
|---|---|---|
| `WagerTransactionProcessed` | qualquer transação aplicada, inclusive LOSS | transação, jogador, rodada, `kind`, valor, `balanceAfter` |
| `WagerTransactionRejected` | rejeição por regra de negócio ou expiração | transação, `kind`, `failureCode` |
| `WalletBalanceChanged` | **somente** quando o saldo muda | direção, valor, saldo antes e depois, `walletVersion` |
| `WagerTransactionPendingReference` | referência ausente | transação, `referenceExternalTransactionId` |

Regras de contrato:

- `data` contém apenas tipos serializáveis: valores monetários são `{amount, currency}` em string. Nunca a instância de `Money`.
- `version` é parte do tipo de cada evento. Mudanças incompatíveis exigem nova versão.
- Eventos são publicados na fila `wager-events.fifo`, separada da fila de comandos. Isso evita que o consumidor de comandos receba eventos (o que foi um bug corrigido durante o desenvolvimento).

---

## 13. Códigos de Falha e Mapeamento HTTP

### Taxonomia de erros (`domain/shared/errors.ts`)

```
DomainError
├── BusinessError     → regra de negócio; terminal (HTTP 4xx, SQS: ack)
├── PermanentError    → entrada/estado que nunca será aceito (HTTP 400/500, SQS: DLQ)
└── TransientError    → infraestrutura temporariamente indisponível (HTTP 503, SQS: retry)
```

A classe de erro indica **como tratar**. O código HTTP não é responsabilidade do domínio: ele é decidido na camada de interface, pelo `GlobalExceptionFilter`.

### Mapeamento único

| Código do erro | HTTP |
|---|---|
| `INVALID_INPUT`, `INVALID_MESSAGE` | 400 |
| `WALLET_NOT_FOUND`, `TRANSACTION_NOT_FOUND` | 404 |
| `IDEMPOTENCY_CONFLICT`, `DUPLICATE_EXTERNAL_TRANSACTION`, `WALLET_ALREADY_EXISTS`, `CURRENCY_MISMATCH`, `CURRENCY_CONFLICT`, `UNIQUE_VIOLATION` | 409 |
| `INSUFFICIENT_FUNDS`, `INBOX_PAYLOAD_MISMATCH` | 422 |
| rejeição de transação (`REJECTED`) | 422, com `failureCode` no corpo |
| transação `PENDING_REFERENCE` | 202 |
| `TRANSIENT`, `ConnectionException`, `DeadlockException`, `LockWaitTimeoutException` | 503 com `Retry-After` |
| `INVALID_TRANSACTION_STATE`, `LEDGER_INVARIANT_VIOLATED`, erro desconhecido | 500 (mensagem interna não é exposta) |

A consistência entre endpoints vem do filtro único. Não há `try/catch` espalhado nos controllers.

### Por que 503 separado de 500

É distiguindo falha transitória (o provedor pode reenviar) de erro permanente. O 503 com `Retry-After` comunica isso. Um 500 genérico faria o provedor interpretar mensagens de erro para decidir.

---

## 14. Autenticação

**Decisão:** não implementada neste escopo.

**Desenho que adotaria:**

- Um **Identity Provider externo** (Keycloak ou Zitadel), com OIDC.
- Cada provedor de jogos recebe um cliente OAuth2 (client credentials) com escopos próprios. O token traz um claim com o `providerId` permitido.
- O guard valida assinatura, expiração e audience do token. O `providerId` do payload deve ser igual ao claim: um provedor não submete transações em nome de outro. Isso é uma validação de domínio, ainda que o token seja confiável.
- Endpoints de health e de métricas permanecem abertos. Mensagens da fila são tratadas como canal interno confiável, mas o `providerId` continua sujeito às validações de domínio.

**Ponto de extensão no código:** `src/infra/http/guards/auth.guard.ts` é um guard que hoje retorna `true`, documentado como ponto de extensão. Os controllers de transação e wallet já o usam; os de health e métricas não.

---

## 15. Observabilidade

### Logs

- **JSON estruturado**, uma linha por evento, em `stdout`/`stderr`.
- Campos de correlação obrigatórios quando disponíveis: `correlationId`, `messageId`, `transactionId`, `walletId`, `providerId`.
- O `correlationId` é propagado por `AsyncLocalStorage` (`RequestContext`), então logs emitidos em qualquer camada dentro da mesma requisição ou mensagem o carregam sem repasse explícito.
- Redação na fronteira do logger: campos sensíveis viram `[REDACTED]` (valores monetários, saldos, payloads, credenciais, dados pessoais). Não é possível logar um valor financeiro por descuido de quem chama.
- Erros inesperados incluem stack trace truncada; erros de domínio não.

### Métricas

Prometheus via `prom-client`, exposto em `GET /metrics`. Cobrem: transações por status, duplicatas, retries, DLQ, conflitos de lock, outbox lag, latência de processamento e divergências de reconciliação, além de latência HTTP.

Cardinalidade limitada: nenhum label tem id de wallet, jogador ou transação.

### Health checks

- `/health/live`: processo vivo. Não toca dependências.
- `/health/ready`: PostgreSQL (`SELECT 1`) e as duas filas (`GetQueueAttributes`) alcançáveis. Falhas viram `false` no relatório, nunca exceção, para que o probe sempre responda.

### Por que não OpenTelemetry

Métricas e logs estruturados cobrem o diagnóstico exigido. Tracing distribuído entraria como evolução.

---

## 16. Estratégia de Testes

Os testes seguem a pirâmide, com dependências reais.

| Camada | Diretório | Infraestrutura | Foco |
|---|---|---|---|
| Unidade | `tests/unit/` | nenhuma | `Money`, invariantes de `Wallet`, regras de liquidação (BET, WIN, LOSS, REFUND, ROLLBACK), hash canônico, redação de logs, mapeamento HTTP |
| Integração | `tests/integration/` | SQS e PostgreSQL, migrado | constraints e triggers por SQL direto, idempotência (conflito, duplicata, replay), atomicidade com falha injetada, inbox e redelivery, outbox (crash e retry), referências fora de ordem e expiração, reconciliação com divergência |
| Concorrência | `tests/concurrency/` | PostgreSQL | 50 requisições idênticas em paralelo, disputa de saldo, wallets distintas, 3 processos Bun independentes, dois publishers, REFUND antes da referência, reinício a frio |

### Técnicas

- **Falha injetada** (`FailingOnEventUnitOfWork`): envolve a `UnitOfWork` real e lança erro na escrita de um evento, para provar que nada da transação sobrevive ao rollback.
- **Crash simulado**: a instância é fechada entre o commit e a publicação; outra instância recupera o evento.
- **Tempo forçado via SQL** (`created_at`, `next_attempt_at`) para testar TTL e backoff sem esperar minutos. Os asserts comprovam o efeito, não o tempo.
- **Divergência forçada** por `UPDATE` no saldo materializado (mutável), para testar que a reconciliação sinaliza sem corrigir.
- **Processos reais**: `Bun.spawn` com três processos independentes disputando a mesma wallet.

### Invariante final

Todo teste que altera saldo termina comprovando `saldo materializado == soma do ledger`, via reconciliação.

---

## 17. Implantação e Escala

### Componentes (docker-compose)

| Serviço | Papel | Dependência |
|---|---|---|
| `postgres` | banco transacional | — |
| `localstack` | SQS (filas FIFO e DLQ) | — |
| `migrate` | aplica as migrations e termina | `postgres` saudável |
| `app` | API + consumidor SQS + workers | `localstack`, `migrate` concluído |

### Múltiplas instâncias

O código é seguro para N instâncias porque toda decisão crítica acontece no banco sob lock:

- idempotência: advisory lock + `UNIQUE`;
- saldo: `FOR UPDATE` por wallet;
- workers: `FOR UPDATE SKIP LOCKED` (pendentes e outbox);
- consumo SQS: visibilidade da mensagem + inbox.

Não há estado em memória que precise ser compartilhado, exceto métricas (por instância, agregadas pelo Prometheus).

**Estado atual do compose:** a porta 3000 do serviço `app` é publicada no host. Para N instâncias, o próximo passo é remover o mapeamento e colocar um balanceador (por exemplo, Nginx) à frente, com `docker compose up --scale app=3`. Veja mais detalhes sobre como fazer isso no `README.md`.

### Configuração e segredos

Variáveis obrigatórias são validadas na inicialização (`requireEnv`). Credenciais não têm valor padrão. `.env.example` documenta as variáveis.

---

## 18. Trade-offs e Limitações

### Trade-offs aceitos

| Escolha | Benefício | Custo |
|---|---|---|
| Lock pessimista por wallet | correção sob contenção, previsível | serializa operações da mesma wallet (aceitável: é o domínio) |
| Advisory lock por chave de idempotência | sem race entre duas requisições idênticas | um lock adicional por requisição |
| Outbox com polling de 500 ms | simples, sem CDC nem Debezium | latência de até ~500 ms até o evento sair |
| Replay com saldo gravado | segue a regra 7 literalmente | uma coluna a mais em `wager_transactions` |
| Expiração de referência por TTL **e** tentativas | limita pendências por tempo e por ciclos | dois parâmetros a calibrar |
| Trigger para imutabilidade | garantia independente da aplicação | um `UPDATE` de manutenção exige desativar a trigger |
| Hash canônico com `JSON.stringify` para primitivos | simples e determinístico para o contrato atual | números com representação exótica não são normalizados (não aparecem no contrato: valores são strings) |
| Logger próprio em vez de biblioteca | controle da redação na fronteira | manutenção do formato |

### Limitações conhecidas

1. **Reversões parciais** não são suportadas.
2. **Autenticação** não implementada (ver seção 14).
3. **Replay de transações antigas** sem `balance_after` devolve o saldo atual (caso de migração; não afeta transações criadas após a migration).
4. **Ordem entre transações de wallets diferentes** não é garantida (não é exigida: a ordem é por agregado).
5. **Tracing distribuído** não implementado.
6. **Sem OpenAPI**: contratos descritos no README e nos DTOs.

### Decisões que mudariam com outra escala

- Milhares de wallets quentes: particionar o processamento por `walletId` com filas dedicadas, em vez de confiar só no lock.
- Volume muito maior de eventos: trocar o polling da outbox por CDC (Debezium) ou `LISTEN/NOTIFY`.
- Múltiplos regiões: o modelo atual é de região única (um PostgreSQL com escrita transacional).