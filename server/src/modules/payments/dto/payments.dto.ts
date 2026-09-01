import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from "class-validator";
import { PAYMENT_DRIVERS, PAYMENT_METHODS } from "../payment-gateway";

const MONEY_PATTERN = /^\d{1,12}(\.\d{1,6})?$/;
const GATEWAY_URL_PATTERN = /^https?:\/\/[^\s]+$/i;

export class CreateRechargeDto {
    @ApiPropertyOptional({ description: "充值套餐 id；与自定义金额二选一" })
    @ValidateIf((body: CreateRechargeDto) => !body.amount)
    @IsUUID()
    packageId?: string;

    @ApiPropertyOptional({ description: "自定义充值金额（实付=到账）" })
    @ValidateIf((body: CreateRechargeDto) => !body.packageId)
    @IsString()
    @Matches(MONEY_PATTERN, { message: "金额格式不正确" })
    amount?: string;

    @ApiProperty({ enum: PAYMENT_METHODS })
    @IsIn(PAYMENT_METHODS)
    method!: (typeof PAYMENT_METHODS)[number];

    @ApiPropertyOptional()
    @IsOptional()
    @IsUUID()
    channelId?: string;
}

export class CreatePaymentChannelDto {
    @ApiProperty()
    @IsString()
    @MaxLength(64)
    name!: string;

    @ApiProperty({ enum: PAYMENT_DRIVERS })
    @IsIn(PAYMENT_DRIVERS)
    driver!: (typeof PAYMENT_DRIVERS)[number];

    @ApiProperty({ example: "https://zpayz.cn" })
    @IsString()
    @MaxLength(500)
    @Matches(GATEWAY_URL_PATTERN, { message: "网关地址必须是 http 或 https URL" })
    gatewayUrl!: string;

    @ApiProperty({ description: "商户 PID" })
    @IsString()
    @MaxLength(64)
    merchantId!: string;

    @ApiProperty({ description: "商户密钥，仅创建时必填" })
    @IsString()
    @MaxLength(256)
    secret!: string;

    @ApiProperty({ enum: PAYMENT_METHODS, isArray: true })
    @IsArray()
    @ArrayMinSize(1)
    @IsIn(PAYMENT_METHODS, { each: true })
    methods!: Array<(typeof PAYMENT_METHODS)[number]>;

    @ApiPropertyOptional({ description: "易支付渠道 ID，多个用逗号分隔" })
    @IsOptional()
    @IsString()
    @MaxLength(128)
    cid?: string;

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
    sortOrder?: number;
}

export class UpdatePaymentChannelDto {
    @ApiProperty()
    @IsString()
    @MaxLength(64)
    name!: string;

    @ApiProperty({ enum: PAYMENT_DRIVERS })
    @IsIn(PAYMENT_DRIVERS)
    driver!: (typeof PAYMENT_DRIVERS)[number];

    @ApiProperty()
    @IsString()
    @MaxLength(500)
    @Matches(GATEWAY_URL_PATTERN, { message: "网关地址必须是 http 或 https URL" })
    gatewayUrl!: string;

    @ApiProperty()
    @IsString()
    @MaxLength(64)
    merchantId!: string;

    @ApiPropertyOptional({ description: "留空表示不修改已保存的密钥" })
    @IsOptional()
    @IsString()
    @MaxLength(256)
    secret?: string;

    @ApiProperty({ enum: PAYMENT_METHODS, isArray: true })
    @IsArray()
    @ArrayMinSize(1)
    @IsIn(PAYMENT_METHODS, { each: true })
    methods!: Array<(typeof PAYMENT_METHODS)[number]>;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(128)
    cid?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    enabled?: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    @Max(10_000)
    sortOrder?: number;
}

export class UpsertRechargePackageDto {
    @ApiProperty()
    @IsString()
    @MaxLength(64)
    name!: string;

    @ApiProperty({ description: "到账面额" })
    @IsString()
    @Matches(MONEY_PATTERN, { message: "金额格式不正确" })
    faceValue!: string;

    @ApiProperty({ description: "实付售价" })
    @IsString()
    @Matches(MONEY_PATTERN, { message: "金额格式不正确" })
    salePrice!: string;

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
    sortOrder?: number;
}

export class RechargeSettingsDto {
    @ApiProperty()
    @IsBoolean()
    allowCustomAmount!: boolean;

    @ApiProperty({ description: "自定义充值最小金额，默认 10" })
    @IsString()
    @Matches(MONEY_PATTERN, { message: "金额格式不正确" })
    minAmount!: string;

    @ApiProperty({ description: "自定义充值最大金额，默认 10000" })
    @IsString()
    @Matches(MONEY_PATTERN, { message: "金额格式不正确" })
    maxAmount!: string;
}
