import { Migration } from '@mikro-orm/migrations';

export class Migration20261013224235 extends Migration
{
    override name = 'Migration20261013224235';

    override up(): void | Promise<void>
    {
        this.addSql(`
            CREATE OR REPLACE FUNCTION forbid_ledger_mutation()
            RETURNS TRIGGER AS $$
            BEGIN
                RAISE EXCEPTION 'Lançamentos contábeis no ledger são estritamente imutáveis. Operações de UPDATE ou DELETE são proibidas';
            END;
            $$ LANGUAGE plpgsql;
        `);

        this.addSql(`CREATE TRIGGER trg_protect_ledger BEFORE UPDATE OR DELETE ON wallet_ledger_entries FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();`);
    }

    override down(): void | Promise<void>
    {
        this.addSql(`select 1`);
    }
}
