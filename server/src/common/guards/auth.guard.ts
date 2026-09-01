import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY, ROLES_KEY } from "../decorators";
import { forbidden, unauthorized } from "../errors";
import type { RequestWithUser, UserRole } from "../types";
import { SessionService } from "../../modules/auth/session.service";

/**
 * Applied globally: every route needs a session unless marked @Public().
 * Defaulting to closed means a new controller cannot accidentally ship unauthenticated.
 */
@Injectable()
export class AuthGuard implements CanActivate {
    private readonly cookieName: string;

    constructor(
        private readonly reflector: Reflector,
        private readonly sessions: SessionService,
        config: ConfigService,
    ) {
        this.cookieName = config.get<string>("session.cookieName")!;
    }

    async canActivate(context: ExecutionContext) {
        const handlers = [context.getHandler(), context.getClass()];
        const request = context.switchToHttp().getRequest<RequestWithUser>();

        const token = request.cookies?.[this.cookieName] || "";
        const user = token ? await this.sessions.resolve(token) : null;
        // Resolve the user even on public routes so handlers like the homepage can adapt to a signed-in visitor.
        if (user) request.user = user;

        if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, handlers)) return true;
        if (!user) throw unauthorized();

        const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, handlers);
        if (roles?.length && !roles.includes(user.role)) throw forbidden();
        return true;
    }
}
