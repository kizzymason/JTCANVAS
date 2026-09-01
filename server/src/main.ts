import "reflect-metadata";
import fastifyCookie from "@fastify/cookie";
import fastifyMultipart from "@fastify/multipart";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";
import { OpenApiService } from "./modules/admin/openapi.service";

async function bootstrap() {
    const app = await NestFactory.create<NestFastifyApplication>(
        AppModule,
        new FastifyAdapter({
            // Canvas payloads are large JSON documents; 30mb matches the old client-side limit.
            bodyLimit: 30 * 1024 * 1024,
            trustProxy: true,
        }),
        { bufferLogs: true },
    );

    app.useLogger(app.get(Logger));
    const config = app.get(ConfigService);

    await app.register(fastifyCookie);
    await app.register(fastifyMultipart, { limits: { fileSize: 50 * 1024 * 1024, files: 10 } });

    app.setGlobalPrefix(config.get<string>("apiPrefix")!);
    app.useGlobalPipes(
        new ValidationPipe({
            transform: true,
            whitelist: true,
            // Reject unknown fields outright rather than silently dropping them: a typo in a money
            // field should fail loudly, not be ignored.
            forbidNonWhitelisted: true,
            transformOptions: { enableImplicitConversion: false },
        }),
    );

    const origins = config.get<string[]>("corsOrigins") ?? [];
    if (origins.length) app.enableCors({ origin: origins, credentials: true });

    app.getHttpAdapter()
        .getInstance()
        .addHook("onSend", async (_request: unknown, reply: { header: (name: string, value: string) => void }, payload: unknown) => {
            reply.header("X-Content-Type-Options", "nosniff");
            reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
            reply.header("X-Frame-Options", "SAMEORIGIN");
            return payload;
        });

    // OpenAPI is generated for the admin console only. Never mount a public /api/docs UI.
    app.get(OpenApiService).setDocument(
        SwaggerModule.createDocument(app, new DocumentBuilder().setTitle("Infinite Canvas API").setDescription("用户、余额、计费与生成接口").setVersion("1.0").addCookieAuth("ic_session").build()),
    );

    app.enableShutdownHooks();
    const port = config.get<number>("port")!;
    await app.listen(port, "0.0.0.0");
    app.get(Logger).log(`API listening on :${port}`);
}

void bootstrap();
