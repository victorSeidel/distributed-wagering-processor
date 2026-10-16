import { Migration } from '@mikro-orm/migrations';

export class Migration20261015205347 extends Migration
{
    override name = 'Migration20261015205347';

    override up(): void | Promise<void>
    {
        this.addSql(`alter table "wager_transactions" add "reference_attempts" int not null default 0, add "reference_next_attempt_at" timestamptz null;`);
        this.addSql(`create index "idx_wagers_pending_due" on "wager_transactions" ("status", "reference_next_attempt_at");`);
        this.addSql(`alter table "wager_transactions" add constraint "chk_wager_reference_attempts_non_negative" check (reference_attempts >= 0);`);
    }

    override down(): void | Promise<void>
    {
        this.addSql(`drop index "idx_wagers_pending_due";`);
        this.addSql(`alter table "wager_transactions" drop constraint "chk_wager_reference_attempts_non_negative";`);
        this.addSql(`alter table "wager_transactions" drop column "reference_attempts", drop column "reference_next_attempt_at";`);
    }
}
