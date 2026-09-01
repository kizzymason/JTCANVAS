import { Body, Controller, HttpCode, Logger, Post, Req, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Throttle } from "@nestjs/throttler";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Public, SkipSession } from "../../common/decorators";
import { VisitorBeaconDto } from "./dto/visitors.dto";
import { newVisitorId, VisitorsService } from "./visitors.service";
import { VISITOR_COOKIE, VISITOR_COOKIE_MAX_AGE, deviceSummary, isVisitorId, normalizeVisitorPath } from "./visitors-classify";

@ApiTags("visitors")
@Controller("visitors")
export class VisitorsController {
    private readonly logger = new Logger(VisitorsController.name);

    constructor(
        private readonly visitors: VisitorsService,
        private readonly config: ConfigService,
    ) {}

    @Public()
    @SkipSession()
    @Throttle({ default: { limit: 60, ttl: 60_000 } })
    @Post("beacon")
    @HttpCode(200)
    @ApiOperation({ summary: "前台页面访问上报，失败不影响使用" })
    async beacon(@Body() body: VisitorBeaconDto, @Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
        const path = normalizeVisitorPath(body.path);
        if (!path) return { ok: true };
        const visitorId = this.ensureVisitorCookie(request, reply);
        const input = {
            visitorId,
            ip: request.ip ?? "",
            userAgent: String(request.headers["user-agent"] ?? ""),
            device: deviceSummary({ ua: String(request.headers["user-agent"] ?? ""), screen: body.screen, timezone: body.timezone }),
            path,
            webdriver: body.webdriver,
        };
        // Cookie + 200 first so homepage/mobile first paint is not waiting on Redis/Postgres.
        setImmediate(() => {
            void this.visitors.ingest(input).catch((error: unknown) => {
                const message = error instanceof Error ? error.message : String(error);
                this.logger.warn(`visitor beacon ingest failed: ${message}`);
            });
        });
        return { ok: true };
    }

    private ensureVisitorCookie(request: FastifyRequest, reply: FastifyReply) {
        const existing = request.cookies?.[VISITOR_COOKIE];
        if (isVisitorId(existing)) return existing!;
        const id = newVisitorId();
        reply.setCookie(VISITOR_COOKIE, id, {
            path: "/",
            httpOnly: true,
            sameSite: "lax",
            secure: this.config.get<boolean>("session.cookieSecure"),
            domain: this.config.get<string>("session.cookieDomain"),
            maxAge: VISITOR_COOKIE_MAX_AGE,
        });
        return id;
    }
}
