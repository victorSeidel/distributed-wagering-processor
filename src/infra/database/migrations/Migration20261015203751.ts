import { Migration } from '@mikro-orm/migrations';

export class Migration20261015203751 extends Migration
{
    override name = 'Migration20261015203751';

    override up(): void | Promise<void>
    {
        this.addSql(`alter table "wager_transactions" drop constraint "wager_transactions_failure_code_check";`);
        this.addSql(`alter table "wager_transactions" add "balance_after" numeric(18,2) null;`);
        this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_failure_code_check" check ("failure_code" in ('INSUFFICIENT_FUNDS', 'REFERENCE_NOT_FOUND', 'REFERENCE_ALREADY_REVERSED', 'INVALID_REFERENCE_TYPE', 'INVALID_CURRENCY', 'REVERSAL_WOULD_PRODUCE_NEGATIVE_BALANCE', 'AMOUNT_MISMATCH', 'IDEMPOTENCY_CONFLICT', 'REFERENCE_NOT_PROCESSED', 'REFERENCE_MISMATCH', 'PLAYER_MISMATCH'));`);
    }

    override down(): void | Promise<void>
    {
        this.addSql(`alter table "wager_transactions" drop constraint "wager_transactions_failure_code_check";`);
        this.addSql(`alter table "wager_transactions" drop column "balance_after";`);
        this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_failure_code_check" check ("failure_code" in ('INSUFFICIENT_FUNDS', 'REFERENCE_NOT_FOUND', 'REFERENCE_ALREADY_REVERSED', 'INVALID_REFERENCE_TYPE', 'INVALID_CURRENCY', 'REVERSAL_WOULD_PRODUCE_NEGATIVE_BALANCE', 'AMOUNT_MISMATCH', 'IDEMPOTENCY_CONFLICT'));`);
    }
}
