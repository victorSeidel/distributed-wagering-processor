import { Migration } from '@mikro-orm/migrations';

export class Migration20261015181857 extends Migration
{
    override name = 'Migration20261015181857';

    override up(): void | Promise<void>
    {
        this.addSql(`create or replace function "wallet_ledger_entries_trg_protect_ledger_fn"() returns trigger as \$\$ begin RAISE EXCEPTION 'Lançamentos contábeis no ledger são estritamente imutáveis. Operações de UPDATE ou DELETE são proibidas'; RETURN OLD; end; \$\$ language plpgsql;`);
        this.addSql(`create trigger "trg_protect_ledger" BEFORE UPDATE OR DELETE on "wallet_ledger_entries" for each ROW execute function "wallet_ledger_entries_trg_protect_ledger_fn"();`);
    }

    override down(): void | Promise<void>
    {
        this.addSql(`drop trigger if exists "trg_protect_ledger" on "wallet_ledger_entries";`);
        this.addSql(`drop function if exists "wallet_ledger_entries_trg_protect_ledger_fn"();`);
    }
}
