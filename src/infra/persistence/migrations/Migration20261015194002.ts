import { Migration } from '@mikro-orm/migrations';

export class Migration20261015194002 extends Migration
{
    override name = 'Migration20261015194002';

    override up(): void | Promise<void>
    {
        this.addSql(`alter table "wallet_ledger_entries" drop constraint "wallet_ledger_entries_transaction_id_unique";`);
    }

    override down(): void | Promise<void>
    {
        this.addSql(`alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_transaction_id_unique" unique ("transaction_id");`);
    }
}
