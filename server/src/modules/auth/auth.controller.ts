import { Body, Controller, Get, HttpCode, Inject, Patch, Post, Req, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Throttle } from "@nestjs/throttler";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { CurrentUser, Public } from "../../common/decorators";
import { DB, type Database } from "../../db/db.module";
import { users } from "../../db/schema";
import type { AuthUser } from "../../common/types";
import { SettingsService, toPublicSite } from "../settings/settings.service";
import { VisitorsService } from "../visitors/visitors.service";
import { WalletService } from "../wallet/wallet.service";
import { AuthService } from "./auth.service";
import { SliderChallengeService } from "./slider-challenge.service";
import { ChangePasswordDto, LoginDto, RegisterDto, SliderVerifyDto, UpdatePreferencesDto } from "./dto/auth.dto";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
    constructor(
        private readonly auth: AuthService,
        private readonly settings: SettingsService,
        private readonly wallet: WalletService,
        private readonly slider: SliderChallengeService,
        private readonly visitors: VisitorsService,
        private readonly config: ConfigService,
        @Inject(DB) private readonly db: Database,
    ) {}

    @Public()
    @Get("bootstrap")
    @ApiOperation({ summary: "站点公开信息与当前登录态，前端启动时调用" })
    async bootstrap(@Req() request: FastifyRequest & { user?: AuthUser }) {
        void this.visitors.recordBotLanding({ ip: request.ip ?? "", userAgent: String(request.headers["user-agent"] ?? "") }).catch(() => undefined);
        const site = await this.settings.getSite();
        const user = request.user ? await this.currentProfile(request.user) : null;
        return {
            site: toPublicSite(site),
            user,
        };
    }

    @Public()
    @Throttle({ default: { limit: 20, ttl: 60_000 } })
    @Post("slider-challenge")
    @ApiOperation({ summary: "注册滑块挑战" })
    sliderChallenge() {
        return this.slider.create();
    }

    @Public()
    @Throttle({ default: { limit: 20, ttl: 60_000 } })
    @Post("slider-verify")
    @ApiOperation({ summary: "校验注册滑块并换取一次性 token" })
    sliderVerify(@Body() body: SliderVerifyDto) {
        return this.slider.verify(body);
    }

    @Public()
    // Registration is the cheapest thing to abuse, so it is the most tightly limited.
    @Throttle({ default: { limit: 5, ttl: 60_000 } })
    @Post("register")
    @ApiOperation({ summary: "用户名密码注册" })
    async register(@Body() body: RegisterDto, @Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
        const result = await this.auth.register(body, requestContext(request));
        this.setSessionCookie(reply, result.sessionId);
        return { user: await this.currentProfile(result.user) };
    }

    @Public()
    @Throttle({ default: { limit: 10, ttl: 60_000 } })
    @Post("login")
    @ApiOperation({ summary: "登录" })
    async login(@Body() body: LoginDto, @Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
        const result = await this.auth.login(body, requestContext(request));
        this.setSessionCookie(reply, result.sessionId);
        return { user: await this.currentProfile(result.user) };
    }

    @Post("logout")
    @HttpCode(200)
    @ApiOperation({ summary: "退出登录" })
    async logout(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) reply: FastifyReply) {
        await this.auth.logout(user);
        reply.clearCookie(this.config.get<string>("session.cookieName")!, { path: "/" });
        return { ok: true };
    }

    @Get("me")
    @ApiOperation({ summary: "当前用户资料与余额" })
    me(@CurrentUser() user: AuthUser) {
        return this.currentProfile(user);
    }

    @Post("password")
    @HttpCode(200)
    @ApiOperation({ summary: "修改密码，成功后所有会话失效" })
    async changePassword(@CurrentUser() user: AuthUser, @Body() body: ChangePasswordDto, @Res({ passthrough: true }) reply: FastifyReply) {
        await this.auth.changePassword(user.id, body);
        reply.clearCookie(this.config.get<string>("session.cookieName")!, { path: "/" });
        return { ok: true };
    }

    @Patch("preferences")
    @ApiOperation({ summary: "保存前台偏好设置（生成默认参数等）" })
    async updatePreferences(@CurrentUser() user: AuthUser, @Body() body: UpdatePreferencesDto) {
        await this.db.update(users).set({ preferences: JSON.stringify(body.preferences), updatedAt: new Date() }).where(eq(users.id, user.id));
        return { ok: true };
    }

    private async currentProfile(user: AuthUser) {
        const [row] = await this.db
            .select({ id: users.id, username: users.username, role: users.role, status: users.status, displayName: users.displayName, preferences: users.preferences, createdAt: users.createdAt })
            .from(users)
            .where(eq(users.id, user.id))
            .limit(1);
        if (!row) return null;
        const wallet = await this.wallet.get(user.id);
        return { ...row, preferences: safeJson(row.preferences), wallet };
    }

    private setSessionCookie(reply: FastifyReply, sessionId: string) {
        reply.setCookie(this.config.get<string>("session.cookieName")!, sessionId, {
            path: "/",
            httpOnly: true,
            sameSite: "lax",
            secure: this.config.get<boolean>("session.cookieSecure"),
            domain: this.config.get<string>("session.cookieDomain"),
            maxAge: this.config.get<number>("session.ttlSeconds"),
        });
    }
}

function requestContext(request: FastifyRequest) {
    return { ip: request.ip ?? "", userAgent: String(request.headers["user-agent"] ?? "") };
}

function safeJson(value: string) {
    try {
        return JSON.parse(value) as Record<string, unknown>;
    } catch {
        return {};
    }
}
