import { Migration } from '@mikro-orm/migrations';

export class Migration20261015182420 extends Migration
{
    override name = 'Migration20261015182420';

    override up(): void | Promise<void>
    {
        this.addSql(`create unique index "uq_wagers_single_reversal_per_reference" on "wager_transactions" ("reference_transaction_id", "kind") where "status" = 'PROCESSED' and "kind" in ('REFUND', 'ROLLBACK');`);
        this.addSql(`alter table "wager_transactions" add constraint "uq_wagers_provider_external_tx" unique ("provider_id", "external_transaction_id");`);
    }

    override down(): void | Promise<void>
    {
        this.addSql(`drop index "uq_wagers_single_reversal_per_reference";`);
        this.addSql(`alter table "wager_transactions" drop constraint "uq_wagers_provider_external_tx";`);
    }
}
