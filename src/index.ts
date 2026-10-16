import "reflect-metadata";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { JsonLogger } from "./infra/observability/json-logger";

async function bootstrap()
{
    const app = await NestFactory.create(AppModule, { bufferLogs: true });
    app.enableShutdownHooks();

    const logger = app.get(JsonLogger);
    app.useLogger(logger);
    
    const port = Number(process.env.PORT) || 3000;
    await app.listen(port);

    logger.info("Servidor iniciado", { port });
}

bootstrap();