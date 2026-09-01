/// <reference types="@fastify/cookie" />
/// <reference types="@fastify/multipart" />

/**
 * Pulls in the declaration merging from the Fastify plugins registered in main.ts, so `reply.setCookie`
 * and `request.file()` are typed everywhere without importing the plugin in each controller.
 */
import type { AuthUser } from "../common/types";

declare module "fastify" {
    interface FastifyRequest {
        /** Set by AuthGuard. Present on every authenticated route. */
        user?: AuthUser;
    }
}
