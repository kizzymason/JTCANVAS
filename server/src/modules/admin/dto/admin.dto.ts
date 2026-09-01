import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsIn, IsInt, IsNumberString, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from "class-validator";
import { PaginationDto } from "../../wallet/dto/wallet.dto";

/** Money always arrives as a string so it never round-trips through a JS float. */
const MONEY_PATTERN = /^\d{1,12}(\.\d{1,6})?$/;

export class UserQueryDto extends PaginationDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(64)
    keyword?: string;

    @ApiPropertyOptional({ enum: ["user", "admin"] })
    @IsOptional()
    @IsIn(["user", "admin"])
    role?: "user" | "admin";

    @ApiPropertyOptional({ enum: ["active", "disabled"] })
    @IsOptional()
    @IsIn(["active", "disabled"])
    status?: "active" | "disabled";
}

export class UpdateUserDto {
    @ApiPropertyOptional({ enum: ["user", "admin"] })
    @IsOptional()
    @IsIn(["user", "admin"])
    role?: "user" | "admin";

    @ApiPropertyOptional({ enum: ["active", "disabled"] })
    @IsOptional()
    @IsIn(["active", "disabled"])
    status?: "active" | "disabled";

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(64)
    displayName?: string;

    @ApiPropertyOptional({ minLength: 8 })
    @IsOptional()
    @IsString()
    @MinLength(8)
    @MaxLength(128)
    password?: string;
}

export class AdminLedgerQueryDto extends PaginationDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(64)
    keyword?: string;

    @ApiPropertyOptional({ enum: ["recharge", "redeem", "freeze", "settle", "refund", "admin_adjust"] })
    @IsOptional()
    @IsIn(["recharge", "redeem", "freeze", "settle", "refund", "admin_adjust"])
    type?: "recharge" | "redeem" | "freeze" | "settle" | "refund" | "admin_adjust";
}

export class AdminTaskQueryDto extends PaginationDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(64)
    keyword?: string;

    @ApiPropertyOptional({ enum: ["pending", "running", "succeeded", "partial", "failed", "cancelled"] })
    @IsOptional()
    @IsIn(["pending", "running", "succeeded", "partial", "failed", "cancelled"])
    status?: "pending" | "running" | "succeeded" | "partial" | "failed" | "cancelled";

    @ApiPropertyOptional({ enum: ["image", "video", "text", "audio"] })
    @IsOptional()
    @IsIn(["image", "video", "text", "audio"])
    capability?: "image" | "video" | "text" | "audio";

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(36)
    userId?: string;
}

export class CardBatchQueryDto extends PaginationDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(128)
    keyword?: string;
}

export class CardItemsQueryDto extends PaginationDto {
    @ApiPropertyOptional({ enum: ["unused", "used", "void"] })
    @IsOptional()
    @IsIn(["unused", "used", "void"])
    status?: "unused" | "used" | "void";
}

export class AdjustBalanceDto {
    @ApiProperty({ description: "调整金额，正数增加，负数扣减", example: "10.00" })
    @IsString()
    @Matches(/^-?\d{1,12}(\.\d{1,6})?$/, { message: "金额格式不正确" })
    amount!: string;

    @ApiProperty({ description: "调整原因，会写入审计日志" })
    @IsString()
    @MaxLength(200)
    note!: string;
}

export class ModelFeaturesDto {
    @ApiPropertyOptional({ type: [String], description: "生图分辨率档位，如 1K、2K、4K" })
    @IsOptional()
    @IsArray()
    @IsIn(["1K", "2K", "4K"], { each: true })
    resolutions?: string[];

    @ApiPropertyOptional({ description: "单次最多生成张数，1 表示不可批量", minimum: 1, maximum: 15 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(15)
    maxCount?: number;

    @ApiPropertyOptional({ description: "是否向用户展示透明背景开关" })
    @IsOptional()
    @IsBoolean()
    supportsTransparent?: boolean;

    @ApiPropertyOptional({ type: [String], description: "允许的宽高比，含 auto" })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    @MaxLength(16, { each: true })
    aspectRatios?: string[];

    @ApiPropertyOptional({ type: [String], description: "视频清晰度，如 480、720、1080" })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    @MaxLength(8, { each: true })
    videoResolutions?: string[];

    @ApiPropertyOptional({ description: "视频最长秒数", minimum: 1, maximum: 600 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(600)
    maxSeconds?: number;
}

export class ChannelModelDto {
    @ApiProperty()
    @IsString()
    @MaxLength(128)
    name!: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(128)
    displayName?: string;

    @ApiProperty({ enum: ["image", "video", "text", "audio"] })
    @IsIn(["image", "video", "text", "audio"])
    capability!: "image" | "video" | "text" | "audio";

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    enabled?: boolean;

    @ApiPropertyOptional({ description: "服务端沙箱执行的自定义调用脚本" })
    @IsOptional()
    @IsString()
    @MaxLength(50_000)
    script?: string;

    @ApiPropertyOptional({ type: ModelFeaturesDto, description: "按模型控制分辨率、张数、透明背景等生成选项" })
    @IsOptional()
    @IsObject()
    @ValidateNested()
    @Type(() => ModelFeaturesDto)
    features?: ModelFeaturesDto;
}

export class UpsertChannelDto {
    @ApiProperty()
    @IsString()
    @MaxLength(128)
    name!: string;

    @ApiProperty()
    @IsString()
    @MaxLength(500)
    baseUrl!: string;

    @ApiProperty({ enum: ["openai", "gemini", "piapi"] })
    @IsIn(["openai", "gemini", "piapi"])
    apiFormat!: "openai" | "gemini" | "piapi";

    @ApiPropertyOptional({ description: "留空表示不修改已保存的密钥" })
    @IsOptional()
    @IsString()
    @MaxLength(500)
    apiKey?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    enabled?: boolean;

    @ApiPropertyOptional({ default: 100 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    @Max(10_000)
    priority?: number;
}

export class UpsertPriceDto {
    @ApiProperty({ enum: ["per_image", "per_second", "per_call"] })
    @IsIn(["per_image", "per_second", "per_call"])
    billingMode!: "per_image" | "per_second" | "per_call";

    @ApiPropertyOptional({ description: "尺寸或质量档位，留空表示该模型默认价" })
    @IsOptional()
    @IsString()
    @MaxLength(32)
    spec?: string;

    @ApiProperty({ description: "单价（元/张 或 元/秒）", example: "0.30" })
    @IsString()
    @Matches(MONEY_PATTERN, { message: "单价格式不正确" })
    unitPrice!: string;

    @ApiPropertyOptional({ description: "第二张及以后参考图的加价", example: "0.003" })
    @IsOptional()
    @IsString()
    @Matches(MONEY_PATTERN, { message: "加价格式不正确" })
    extraReferencePrice?: string;

    @ApiPropertyOptional({ description: "最低收费" })
    @IsOptional()
    @IsString()
    @Matches(MONEY_PATTERN, { message: "最低收费格式不正确" })
    minCharge?: string;
}

export class CreateCardBatchDto {
    @ApiProperty()
    @IsString()
    @MaxLength(128)
    name!: string;

    @ApiProperty({ example: "10.00" })
    @IsString()
    @Matches(MONEY_PATTERN, { message: "面额格式不正确" })
    faceValue!: string;

    @ApiProperty({ minimum: 1, maximum: 5000 })
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(5000)
    quantity!: number;

    @ApiPropertyOptional({ description: "过期时间，ISO 字符串，留空表示不过期" })
    @IsOptional()
    @IsString()
    expiresAt?: string;
}

export class SiteSettingsDto {
    @ApiProperty()
    @IsBoolean()
    registrationEnabled!: boolean;

    @ApiProperty({ description: "新用户注册赠送金额，0 表示不赠送" })
    @IsNumberString()
    newUserGiftAmount!: string;

    @ApiProperty()
    @IsString()
    @MaxLength(64)
    siteName!: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(500)
    rechargeNotice?: string;
}

export class ServiceSettingsDto {
    @ApiProperty({ description: "是否开放图片生成（含生图工作台与画布图片节点）" })
    @IsBoolean()
    imageGenerationEnabled!: boolean;

    @ApiProperty({ description: "是否开放视频生成（含视频创作台与画布视频节点）" })
    @IsBoolean()
    videoGenerationEnabled!: boolean;

    @ApiProperty({ description: "是否显示前台与画布的 Agent 入口" })
    @IsBoolean()
    agentEnabled!: boolean;
}

export class S3SettingsDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(300)
    endpoint?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(64)
    region?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(128)
    bucket?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(200)
    accessKeyId?: string;

    @ApiPropertyOptional({ description: "留空表示不修改已保存的密钥" })
    @IsOptional()
    @IsString()
    @MaxLength(300)
    secretAccessKey?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    forcePathStyle?: boolean;

    @ApiPropertyOptional({ description: "CDN 公共前缀，填了就不再签名" })
    @IsOptional()
    @IsString()
    @MaxLength(300)
    publicBaseUrl?: string;
}

export class StorageSettingsDto {
    @ApiProperty({ enum: ["local", "s3"] })
    @IsIn(["local", "s3"])
    driver!: "local" | "s3";

    @ApiPropertyOptional({ type: S3SettingsDto })
    @IsOptional()
    @IsObject()
    @ValidateNested()
    @Type(() => S3SettingsDto)
    s3?: S3SettingsDto;
}

export class ImportPiapiDto {
    @ApiProperty({ description: "账号列表", type: [Object] })
    @IsArray()
    accounts!: Array<{ username: string; apiKey: string }>;
}
