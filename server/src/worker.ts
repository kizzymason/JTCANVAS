import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { WorkerModule } from "./worker.module";

/**
 * Separate process from the API. Video polling can run for tens of minutes, which would otherwise
 * occupy request-handling capacity, and keeping providers out of the API process means a credential
 * is never decrypted anywhere a user request can reach.
 */
async function bootstrap() {
    const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
    app.useLogger(app.get(Logger));
    app.enableShutdownHooks();
    app.get(Logger).log("Generation worker started");
}

void bootstrap();
