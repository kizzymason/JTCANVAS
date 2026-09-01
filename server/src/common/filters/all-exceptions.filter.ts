import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { FastifyReply } from "fastify";

export type ApiErrorBody = {
    statusCode: number;
    /** Stable machine-readable code the frontend can branch on, e.g. INSUFFICIENT_BALANCE. */
    code: string;
    message: string;
    details?: unknown;
};

/**
 * Normalises every error into one shape so the frontend never has to guess, and makes sure an
 * unexpected throw does not leak a stack trace or a decrypted credential to the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
    private readonly logger = new Logger("Exception");

    catch(exception: unknown, host: ArgumentsHost) {
        const reply = host.switchToHttp().getResponse<FastifyReply>();

        if (exception instanceof HttpException) {
            const status = exception.getStatus();
            const response = exception.getResponse();
            const body = this.fromHttpException(status, response);
            if (status >= HttpStatus.INTERNAL_SERVER_ERROR) this.logger.error(body.message, exception.stack);
            return reply.status(status).send(body);
        }

        this.logger.error(exception instanceof Error ? exception.message : String(exception), exception instanceof Error ? exception.stack : undefined);
        return reply.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            code: "INTERNAL_ERROR",
            message: "服务器内部错误",
        } satisfies ApiErrorBody);
    }

    private fromHttpException(status: number, response: unknown): ApiErrorBody {
        if (typeof response === "string") return { statusCode: status, code: "HTTP_ERROR", message: response };
        const payload = (response ?? {}) as { message?: unknown; code?: unknown; details?: unknown; error?: unknown };
        // class-validator hands back an array of messages; surface them as details, not as the message.
        const message = Array.isArray(payload.message) ? "请求参数不合法" : String(payload.message ?? payload.error ?? "请求失败");
        return {
            statusCode: status,
            code: String(payload.code ?? (status === HttpStatus.BAD_REQUEST ? "VALIDATION_ERROR" : "HTTP_ERROR")),
            message,
            details: Array.isArray(payload.message) ? payload.message : payload.details,
        };
    }
}
