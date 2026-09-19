import { applyDecorators, createParamDecorator, ExecutionContext, UseFilters, UseGuards } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { ApiSecurity, ApiTags } from "@nestjs/swagger";
import { Public } from "../../common/decorators";
import { ApiKeyGuard, type ApiCaller, type RequestWithApiCaller } from "./api-key.guard";
import { OpenAiExceptionFilter } from "./openai-exception.filter";

/**
 * Everything a `/v1` controller needs, in one decorator so a new endpoint cannot ship half-secured.
 *
 * `@Public()` only tells the global session guard to stand aside; `ApiKeyGuard` then does the real
 * authentication. The global throttler is skipped because it counts per session, which is meaningless
 * here — `RateLimitService` enforces the per-key budget instead.
 */
export const OpenApiEndpoint = () =>
    applyDecorators(ApiTags("open-platform"), ApiSecurity("bearer"), Public(), SkipThrottle(), UseGuards(ApiKeyGuard), UseFilters(OpenAiExceptionFilter));

export const CurrentCaller = createParamDecorator((_data: unknown, context: ExecutionContext): ApiCaller => {
    const request = context.switchToHttp().getRequest<RequestWithApiCaller>();
    return request.apiCaller!;
});
