import { Migration } from '@mikro-orm/migrations';

export class Migration20261015183817 extends Migration
{
    override name = 'Migration20261015183817';

    override up(): void | Promise<void>
    {
        this.addSql(`alter table "inbox_messages" add constraint "uk_inbox_messages_consumer_message" unique ("consumer_name", "message_id");`);
    }

    override down(): void | Promise<void>
    {
        this.addSql(`alter table "inbox_messages" drop constraint "uk_inbox_messages_consumer_message";`);
    }
}