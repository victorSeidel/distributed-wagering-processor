import { Global, Module } from "@nestjs/common";
import { MikroOrmModule } from "@mikro-orm/nestjs";

import mikroOrmConfig from "../../../mikro-orm.config";
import { MikroOrmUnitOfWork } from "./mikro-orm-unit-of-work";
import { MikroOrmWagerQueries, MikroOrmWalletQueries } from "./queries/mikro-orm-queries";

import { UnitOfWork } from "../../application/ports/unit-of-work.port";
import { WagerQueries, WalletQueries } from "../../application/ports/queries.port";

@Global()
@Module({
    imports: [
        MikroOrmModule.forRoot(mikroOrmConfig),
    ],

    providers: [
        MikroOrmUnitOfWork,
        MikroOrmWalletQueries,
        MikroOrmWagerQueries,
        { provide: UnitOfWork, useExisting: MikroOrmUnitOfWork },
        { provide: WalletQueries, useExisting: MikroOrmWalletQueries },
        { provide: WagerQueries, useExisting: MikroOrmWagerQueries },
    ],

    exports: [
        UnitOfWork,
        WalletQueries,
        WagerQueries,
    ],
})

export class PersistenceModule {}