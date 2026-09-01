import { HttpException, HttpStatus } from "@nestjs/common";

/** Throw these instead of bare HttpException so the frontend gets a stable `code`. */
export class AppError extends HttpException {
    constructor(status: HttpStatus, code: string, message: string, details?: unknown) {
        super({ code, message, details }, status);
    }
}

export const badRequest = (code: string, message: string, details?: unknown) => new AppError(HttpStatus.BAD_REQUEST, code, message, details);
export const unauthorized = (message = "请先登录") => new AppError(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", message);
export const forbidden = (message = "没有权限执行该操作") => new AppError(HttpStatus.FORBIDDEN, "FORBIDDEN", message);
export const notFound = (message = "资源不存在") => new AppError(HttpStatus.NOT_FOUND, "NOT_FOUND", message);
export const conflict = (code: string, message: string, details?: unknown) => new AppError(HttpStatus.CONFLICT, code, message, details);

/** 402 so the frontend can unambiguously route the user to the top-up page. */
export const insufficientBalance = (required: string, balance: string) =>
    new AppError(HttpStatus.PAYMENT_REQUIRED, "INSUFFICIENT_BALANCE", "余额不足，请先充值", { required, balance });

export const tooManyActiveTasks = (limit: number) => new AppError(HttpStatus.TOO_MANY_REQUESTS, "TOO_MANY_ACTIVE_TASKS", `同时进行中的任务不能超过 ${limit} 个，请稍后再试`, { limit });

export const noUsableChannel = (message = "当前没有可用的模型渠道，请联系管理员配置") => new AppError(HttpStatus.SERVICE_UNAVAILABLE, "NO_USABLE_CHANNEL", message);

export const serviceDisabled = (message: string) => new AppError(HttpStatus.FORBIDDEN, "SERVICE_DISABLED", message);

/** Optimistic lock failure on a canvas save. */
export const versionConflict = (currentVersion: number) => new AppError(HttpStatus.CONFLICT, "VERSION_CONFLICT", "该画布在别处已被修改，请刷新后重试", { currentVersion });
