import { Migration } from '@mikro-orm/migrations';

export class Migration20261015192625 extends Migration
{
    override name = 'Migration20261015192625';

    override up(): void | Promise<void>
    {
        this.addSql(`alter table "inbox_messages" drop constraint "uk_inbox_messages_consumer_message";`);

        this.addSql(`alter table "outbox_messages" add constraint "chk_outbox_attempts_non_negative" check (attempts >= 0);`);

        this.addSql(`alter table "wallets" add constraint "chk_wallet_currency_format" check (currency ~ '^[A-Z]{3}\$');`);

        this.addSql(`drop index "wager_transactions_status_index";`);
        this.addSql(`drop index "wager_transactions_wallet_id_index";`);
        this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_wallet_id_foreign" foreign key ("wallet_id") references "wallets" ("id") on delete restrict;`);
        this.addSql(`alter table "wager_transactions" add constraint "chk_wager_amount_positive" check (amount > 0);`);

        this.addSql(`alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_wallet_id_foreign" foreign key ("wallet_id") references "wallets" ("id") on delete restrict;`);
        this.addSql(`alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_transaction_id_foreign" foreign key ("transaction_id") references "wager_transactions" ("id") on delete restrict;`);
        this.addSql(`alter table "wallet_ledger_entries" add constraint "uq_ledger_transaction" unique ("transaction_id");`);
        this.addSql(`alter index "wallet_ledger_entries_wallet_id_index" rename to "idx_ledger_wallet";`);
        this.addSql(`alter table "wallet_ledger_entries" add constraint "chk_ledger_amount_positive" check (amount > 0);`);
        this.addSql(`alter table "wallet_ledger_entries" add constraint "chk_ledger_balance_before_non_negative" check (balance_before >= 0);`);
        this.addSql(`alter table "wallet_ledger_entries" add constraint "chk_ledger_balance_after_non_negative" check (balance_after >= 0);`);
        this.addSql(`alter table "wallet_ledger_entries" add constraint "chk_ledger_balance_arithmetic" check ((direction = 'CREDIT' and balance_after = balance_before + amount) or (direction = 'DEBIT' and balance_after = balance_before - amount));`);
    }

    override down(): void | Promise<void>
    {
        this.addSql(`alter table "wager_transactions" drop constraint "wager_transactions_wallet_id_foreign";`);

        this.addSql(`alter table "wallet_ledger_entries" drop constraint "wallet_ledger_entries_wallet_id_foreign";`);
        this.addSql(`alter table "wallet_ledger_entries" drop constraint "wallet_ledger_entries_transaction_id_foreign";`);

        this.addSql(`alter table "inbox_messages" add constraint "uk_inbox_messages_consumer_message" unique ("consumer_name", "message_id");`);

        this.addSql(`alter table "outbox_messages" drop constraint "chk_outbox_attempts_non_negative";`);

        this.addSql(`alter table "wager_transactions" drop constraint "chk_wager_amount_positive";`);
        this.addSql(`create index "wager_transactions_status_index" on "wager_transactions" ("status");`);
        this.addSql(`create index "wager_transactions_wallet_id_index" on "wager_transactions" ("wallet_id");`);

        this.addSql(`alter table "wallet_ledger_entries" drop constraint "uq_ledger_transaction";`);
        this.addSql(`alter table "wallet_ledger_entries" drop constraint "chk_ledger_amount_positive";`);
        this.addSql(`alter table "wallet_ledger_entries" drop constraint "chk_ledger_balance_before_non_negative";`);
        this.addSql(`alter table "wallet_ledger_entries" drop constraint "chk_ledger_balance_after_non_negative";`);
        this.addSql(`alter table "wallet_ledger_entries" drop constraint "chk_ledger_balance_arithmetic";`);
        this.addSql(`alter index "idx_ledger_wallet" rename to "wallet_ledger_entries_wallet_id_index";`);

        this.addSql(`alter table "wallets" drop constraint "chk_wallet_currency_format";`);
    }
}
