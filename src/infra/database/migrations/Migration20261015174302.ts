import { Migration } from '@mikro-orm/migrations';

export class Migration20261015174302 extends Migration
{
    override name = 'Migration20261015174302';

    override up(): void | Promise<void>
    {
        this.addSql(`alter table "wager_transactions" drop constraint "wager_transactions_type_check";`);
        this.addSql(`alter table "wager_transactions" rename column "type" to "kind";`);
        this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_kind_check" check ("kind" in ('OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK'));`);

        this.addSql(`drop trigger if exists "trg_protect_ledger" on "wallet_ledger_entries";`);
        this.addSql(`drop function if exists "wallet_ledger_entries_trg_protect_ledger_fn"();`);
    }

    override down(): void | Promise<void>
    {
        this.addSql(`alter table "wager_transactions" drop constraint "wager_transactions_kind_check";`);
        this.addSql(`alter table "wager_transactions" rename column "kind" to "type";`);
        this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_type_check" check ("type" in ('OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK'));`);

        this.addSql(`create or replace function "wallet_ledger_entries_trg_protect_ledger_fn"() returns trigger as \$\$ begin ; end; \$\$ language plpgsql;`);
        this.addSql(`create trigger "trg_protect_ledger" BEFORE DELETE OR UPDATE on "wallet_ledger_entries" for each ROW execute function "wallet_ledger_entries_trg_protect_ledger_fn"();`);
    }
}
