import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsBoolean, IsEmail, IsIn, IsInt, IsNumberString, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min } from "class-validator";
import { PAYMENT_METHODS } from "../../payments/payment-gateway";

export class CardCheckoutDto {
    @ApiProperty({ description: "商品 ID" })
    @IsUUID()
    productId!: string;

    @ApiProperty({ description: "购买数量", minimum: 1, maximum: 100 })
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    quantity!: number;

    /** The only identity a guest buyer has: it is how they find the order again. */
    @ApiProperty({ description: "接收卡密与查单使用的邮箱" })
    @IsEmail({}, { message: "邮箱格式不正确" })
    @MaxLength(160)
    email!: string;

    @ApiProperty({ enum: PAYMENT_METHODS })
    @IsIn([...PAYMENT_METHODS])
    method!: string;

    @ApiPropertyOptional({ description: "指定支付渠道，留空由平台自动选择" })
    @IsOptional()
    @IsUUID()
    channelId?: string;
}

export class CardOrderLookupDto {
    @ApiProperty({ description: "下单时填写的邮箱" })
    @IsEmail({}, { message: "邮箱格式不正确" })
    @MaxLength(160)
    email!: string;

    @ApiPropertyOptional({ default: 1 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page: number = 1;

    @ApiPropertyOptional({ default: 20, maximum: 50 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(50)
    pageSize: number = 20;
}

export class UpsertCardProductDto {
    @ApiProperty({ description: "商品名称，例如「50 元余额卡」" })
    @IsString()
    @Length(1, 128)
    name!: string;

    @ApiPropertyOptional({ description: "商品说明" })
    @IsOptional()
    @IsString()
    @MaxLength(500)
    description?: string;

    @ApiProperty({ description: "卡密面值（兑换后到账金额）", example: "50" })
    @IsNumberString()
    faceValue!: string;

    @ApiProperty({ description: "售价（买家实付）", example: "45" })
    @IsNumberString()
    salePrice!: string;

    @ApiPropertyOptional({ description: "单次购买上限", default: 10 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    perOrderLimit?: number;

    @ApiPropertyOptional({ default: true })
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

export class GenerateProductCardsDto {
    @ApiProperty({ description: "生成数量", minimum: 1, maximum: 5000 })
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(5000)
    quantity!: number;

    @ApiPropertyOptional({ description: "批次备注，留空用商品名" })
    @IsOptional()
    @IsString()
    @MaxLength(128)
    batchName?: string;

    @ApiPropertyOptional({ description: "过期时间（ISO 8601），留空表示长期有效" })
    @IsOptional()
    @IsString()
    @MaxLength(40)
    expiresAt?: string;
}

export class ImportProductCardsDto {
    @ApiProperty({ description: "卡密清单，一行一个（也支持逗号/分号分隔）" })
    @IsString()
    @MaxLength(400_000)
    codes!: string;

    @ApiPropertyOptional({ description: "批次备注，留空用商品名" })
    @IsOptional()
    @IsString()
    @MaxLength(128)
    batchName?: string;

    @ApiPropertyOptional({ description: "过期时间（ISO 8601），留空表示长期有效" })
    @IsOptional()
    @IsString()
    @MaxLength(40)
    expiresAt?: string;
}

/**
 * Manual settlement. The amount is required and must match the order: it is the same check the
 * gateway callback makes, and keeping it here means a typo cannot deliver goods for the wrong money.
 */
export class SettleCardOrderDto {
    @ApiProperty({ description: "订单号" })
    @IsString()
    @Length(4, 64)
    orderNo!: string;

    @ApiProperty({ description: "实际到账金额，必须与订单金额一致", example: "9.90" })
    @IsNumberString()
    amount!: string;

    @ApiPropertyOptional({ description: "支付方水单号，便于对账" })
    @IsOptional()
    @IsString()
    @MaxLength(128)
    providerTxnId?: string;
}

export class AdminCardOrderQueryDto {
    @ApiPropertyOptional({ default: 1 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page: number = 1;

    @ApiPropertyOptional({ default: 20, maximum: 100 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    pageSize: number = 20;

    @ApiPropertyOptional({ enum: ["pending", "paid", "failed", "cancelled"] })
    @IsOptional()
    @IsIn(["pending", "paid", "failed", "cancelled"])
    status?: "pending" | "paid" | "failed" | "cancelled";

    @ApiPropertyOptional({ description: "按邮箱或订单号搜索" })
    @IsOptional()
    @IsString()
    @MaxLength(160)
    keyword?: string;

    @ApiPropertyOptional({ description: "按商品筛选" })
    @IsOptional()
    @IsUUID()
    productId?: string;
}
