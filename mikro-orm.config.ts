import { defineConfig } from "@mikro-orm/postgresql";
import { Migrator } from "@mikro-orm/migrations";

export default defineConfig({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASS || "postgrespassword",
    dbName: process.env.DB_NAME || "wageringdb",
    entities: ["./src/infra/database/entities/**/*.ts"],
    entitiesTs: ["./src/infra/database/entities/**/*.ts"],
    extensions: [Migrator],
    migrations: {
        path: "./src/infra/database/migrations",
        pathTs: "./src/infra/database/migrations",
        tableName: "mikro_orm_migrations",
        transactional: true,
        allOrNothing: true,
        emit: "ts",
    },
    debug: process.env.NODE_ENV === "development",
});