import 'reflect-metadata';
import { MikroORM } from '@mikro-orm/postgresql';
import config from '../mikro-orm.config';

const orm = await MikroORM.init(config);

try
{
    await orm.migrator.up();
    console.log('Migrations do banco de dados concluídas com sucesso');
}
catch (error)
{
    console.error('Migrations do banco de dados falharam:', error);
    process.exitCode = 1;
}
finally
{
    await orm.close(true);
}

if (process.exitCode === 1) process.exit(1);