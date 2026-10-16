import { Migration } from '@mikro-orm/migrations';

export class Migration20261013224051 extends Migration
{
    override name = 'Migration20261013224051';

    override up(): void | Promise<void>
    {
        this.addSql(`create table "inbox_messages" ("consumer_name" varchar(255) not null, "message_id" varchar(255) not null, "payload_hash" varchar(64) not null, "received_at" timestamptz not null, "processed_at" timestamptz null, primary key ("consumer_name", "message_id"));`);

        this.addSql(`create table "outbox_messages" ("id" uuid not null, "aggregate_id" varchar(255) not null, "event_type" varchar(255) not null, "payload" jsonb not null, "occurred_at" timestamptz not null, "attempts" int not null default 0, "next_attempt_at" timestamptz not null, "published_at" timestamptz null, primary key ("id"));`);
        this.addSql(`create index "outbox_messages_next_attempt_at_index" on "outbox_messages" ("next_attempt_at");`);
        this.addSql(`create index "outbox_messages_published_at_index" on "outbox_messages" ("published_at");`);
        this.addSql(`create index "idx_outbox_due" on "outbox_messages" ("published_at", "next_attempt_at");`);

        this.addSql(`create table "wager_transactions" ("id" uuid not null, "provider_id" varchar(255) not null, "external_transaction_id" varchar(255) not null, "idempotency_key" varchar(255) not null, "payload_hash" varchar(64) not null, "wallet_id" uuid not null, "player_id" varchar(255) not null, "round_id" varchar(255) not null, "game_id" varchar(255) not null, "type" text not null, "amount" numeric(18,2) not null, "currency" varchar(3) not null, "reference_external_transaction_id" varchar(255) null, "reference_transaction_id" uuid null, "status" text not null default 'PENDING', "failure_code" text null, "processed_at" timestamptz null, "created_at" timestamptz not null, primary key ("id"));`);
        this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_idempotency_key_unique" unique ("idempotency_key");`);
        this.addSql(`create index "wager_transactions_wallet_id_index" on "wager_transactions" ("wallet_id");`);
        this.addSql(`create index "wager_transactions_status_index" on "wager_transactions" ("status");`);
        this.addSql(`create index "idx_wagers_wallet" on "wager_transactions" ("wallet_id");`);
        this.addSql(`create index "idx_wagers_status" on "wager_transactions" ("status");`);
        this.addSql(`create index "idx_wagers_reference" on "wager_transactions" ("provider_id", "reference_external_transaction_id");`);

        this.addSql(`create table "wallets" ("id" uuid not null, "player_id" varchar(255) not null, "currency" varchar(3) not null, "balance" numeric(18,2) not null, "version" int not null default 1, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
        this.addSql(`alter table "wallets" add constraint "uk_wallets_player_currency" unique ("player_id", "currency");`);

        this.addSql(`create table "wallet_ledger_entries" ("id" uuid not null, "wallet_id" uuid not null, "transaction_id" uuid not null, "direction" text not null, "amount" numeric(18,2) not null, "currency" varchar(3) not null, "balance_before" numeric(18,2) not null, "balance_after" numeric(18,2) not null, "created_at" timestamptz not null, primary key ("id"));`);
        this.addSql(`create index "wallet_ledger_entries_wallet_id_index" on "wallet_ledger_entries" ("wallet_id");`);
        this.addSql(`alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_transaction_id_unique" unique ("transaction_id");`);
        this.addSql(`create index "wallet_ledger_entries_created_at_index" on "wallet_ledger_entries" ("created_at");`);
        this.addSql(`create index "idx_ledger_wallet_created" on "wallet_ledger_entries" ("wallet_id", "created_at");`);

        this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_type_check" check ("type" in ('OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK'));`);
        this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_status_check" check ("status" in ('PENDING', 'PENDING_REFERENCE', 'PROCESSED', 'REJECTED', 'FAILED'));`);
        this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_failure_code_check" check ("failure_code" in ('INSUFFICIENT_FUNDS', 'REFERENCE_NOT_FOUND', 'REFERENCE_ALREADY_REVERSED', 'INVALID_REFERENCE_TYPE', 'INVALID_CURRENCY', 'REVERSAL_WOULD_PRODUCE_NEGATIVE_BALANCE', 'AMOUNT_MISMATCH', 'IDEMPOTENCY_CONFLICT'));`);

        this.addSql(`alter table "wallets" add constraint "chk_wallet_balance_positive" check (balance >= 0.00);`);

        this.addSql(`alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_direction_check" check ("direction" in ('DEBIT', 'CREDIT'));`);
    }

    override down(): void | Promise<void>
    {
        this.addSql(`drop table if exists "inbox_messages" cascade;`);
        this.addSql(`drop table if exists "outbox_messages" cascade;`);
        this.addSql(`drop table if exists "wager_transactions" cascade;`);
        this.addSql(`drop table if exists "wallets" cascade;`);
        this.addSql(`drop table if exists "wallet_ledger_entries" cascade;`);
    }
}