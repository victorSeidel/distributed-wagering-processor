#!/bin/bash
set -e

echo "===== Criando filas no LocalStack SQS ====="

# 1. Criar Dead-Letter Queue
DLQ_URL=$(awslocal sqs create-queue \
    --queue-name wager-transactions-dlq.fifo \
    --attributes '{"FifoQueue":"true","ContentBasedDeduplication":"false"}' \
    --query 'QueueUrl' \
    --output text)

# 2. Obter ARN da DLQ
DLQ_ARN=$(awslocal sqs get-queue-attributes \
    --queue-url "$DLQ_URL" \
    --attribute-names QueueArn \
    --query 'Attributes.QueueArn' \
    --output text)

# 3. Criar política de redirecionamento
REDRIVE_POLICY=$(printf '{\\"deadLetterTargetArn\\":\\"%s\\",\\"maxReceiveCount\\":\\"5\\"}' "$DLQ_ARN")

# 4. Criar fila de eventos de integração
awslocal sqs create-queue \
    --queue-name wager-events.fifo \
    --attributes '{"FifoQueue":"true","ContentBasedDeduplication":"false"}'

# 5. Criar fila principal
awslocal sqs create-queue \
    --queue-name wager-transactions.fifo \
    --attributes "{\"FifoQueue\":\"true\",\"ContentBasedDeduplication\":\"false\",\"RedrivePolicy\":\"$REDRIVE_POLICY\"}"

echo "===== Filas criadas com sucesso ====="