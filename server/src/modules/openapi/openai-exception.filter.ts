import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { errorTypeForStatus, isOpenAiErrorBody, OpenAiApiError, publicMessageFor, type OpenAiErrorBody } from "./openai-errors";

/**
 * Applied to the `/v1` controllers only. Every failure leaving the open platform has to look like an
 * OpenAI error, otherwise a downstream SDK raises an opaque parse error instead of the actual reason.
 * Internal `AppError`s carry `{ code, message }`, validation failures carry `{ message: string[] }`,
 * and both are normalised here rather than at each throw site.
 */
@Catch()
export class OpenAiExceptionFilter implements ExceptionFilter {
    private readonly logger = new Logger(OpenAiExceptionFilter.name);

    catch(exception: unknown, host: ArgumentsHost) {
        const reply = host.switchToHttp().getResponse<FastifyReply>();
        const { status, body } = this.normalise(exception);

        // A stream that already started cannot be turned into a JSON error response.
        if (reply.raw.headersSent) {
            if (!reply.raw.writableEnded) {
                reply.raw.write(`data: ${JSON.stringify(body)}\n\n`);
                reply.raw.end();
            }
            return;
        }

        if (exception instanceof OpenAiApiError) {
            for (const [name, value] of Object.entries(exception.headers)) reply.header(name, value);
        }
        void reply.status(status).header("content-type", "application/json; charset=utf-8").send(body);
    }

    private normalise(exception: unknown): { status: number; body: OpenAiErrorBody } {
        if (exception instanceof HttpException) {
            const status = exception.getStatus();
            const response = exception.getResponse();
            if (isOpenAiErrorBody(response)) return { status, body: response };

            if (response && typeof response === "object") {
                const record = response as { code?: unknown; message?: unknown };
                const code = typeof record.code === "string" ? record.code : "";
                // Validation details are already English field names, so they are surfaced verbatim.
                const raw = Array.isArray(record.message) ? record.message.join("; ") : typeof record.message === "string" ? record.message : exception.message;
                const message = Array.isArray(record.message) ? raw : publicMessageFor(code, raw);
                return {
                    status,
                    body: { error: { message, type: errorTypeForStatus(status, code), code: code || null, param: null } },
                };
            }
            return {
                status,
                body: { error: { message: typeof response === "string" ? response : exception.message, type: errorTypeForStatus(status, ""), code: null, param: null } },
            };
        }

        this.logger.error(`Unhandled open-platform error: ${exception instanceof Error ? exception.stack : String(exception)}`);
        return {
            status: HttpStatus.INTERNAL_SERVER_ERROR,
            body: { error: { message: "The server had an error while processing your request.", type: "server_error", code: "internal_error", param: null } },
        };
    }
}
