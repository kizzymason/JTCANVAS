import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsNumberString, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateNested } from "class-validator";

const ORDER_STATUSES = ["pending", "paid", "failed", "cancelled"] as const;

/* ---------------------------------- Admin ---------------------------------- */

export class CardMerchantPriceDto {
    @ApiProperty()
    @IsUUID()
    productId!: string;

    @ApiProperty({ description: "该渠道的对外售价（仍是主站定的价）", example: "9.90" })
    @IsNumberString()
    unitPrice!: string;
}

export class UpsertCardMerchantDto {
    @ApiProperty({ description: "渠道名称，仅在后台展示" })
    @IsString()
    @Length(1, 128)
    name!: string;

    @ApiPropertyOptional({ enum: ["rate", "fixed"], description: "rate 按成交金额比例分红，fixed 按每张固定金额" })
    @IsOptional()
    @IsIn(["rate", "fixed"])
    commissionMode?: "rate" | "fixed";

    @ApiPropertyOptional({ description: "比例模式填 0.15 表示 15%；固定模式填每张分红金额", example: "0.15" })
    @IsOptional()
    @IsNumberString()
    commissionRate?: string;

    @ApiPropertyOptional({ description: "佣金冻结天数，退款/拒付会在冻结期内冲回", default: 7 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    @Max(180)
    holdDays?: number;

    @ApiPropertyOptional({ description: "该渠道每日成交上限（元），0 表示不限。用于避免收款账户单日流水异常放大" })
    @IsOptional()
    @IsNumberString()
    dailySalesLimit?: string;

    @ApiPropertyOptional({ description: "允许销售的商品 ID，留空表示全部", type: [String] })
    @IsOptional()
    @IsArray()
    @IsUUID(undefined, { each: true })
    productScope?: string[];

    @ApiPropertyOptional({ description: "允许调用 API 的来源 IP，留空表示不限", type: [String] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    @MaxLength(64, { each: true })
    allowedIps?: string[];

    @ApiPropertyOptional({ description: "付款后回跳地址白名单（下游自己的页面），留空则回跳到主站查单页", type: [String] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    @MaxLength(512, { each: true })
    returnUrls?: string[];

    @ApiPropertyOptional({ description: "收银台显示的商品名，留空用商品原名" })
    @IsOptional()
    @IsString()
    @MaxLength(128)
    checkoutLabel?: string;

    @ApiPropertyOptional({ description: "指定走哪个支付渠道，留空自动选择" })
    @IsOptional()
    @IsUUID()
    preferredChannelId?: string;

    @ApiPropertyOptional({ description: "分红打款方式与账号，仅备注用" })
    @IsOptional()
    @IsString()
    @MaxLength(200)
    payoutAccount?: string;

    @ApiPropertyOptional({ description: "订单事件回调地址，留空表示不推送" })
    @IsOptional()
    @IsString()
    @MaxLength(512)
    webhookUrl?: string;

    @ApiPropertyOptional({ description: "回调签名密钥，留空自动生成" })
    @IsOptional()
    @IsString()
    @MaxLength(128)
    webhookSecret?: string;

    @ApiPropertyOptional({ default: true })
    @IsOptional()
    @IsBoolean()
    enabled?: boolean;
}

export class ReplaceCardMerchantPricesDto {
    @ApiProperty({ type: [CardMerchantPriceDto] })
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CardMerchantPriceDto)
    prices!: CardMerchantPriceDto[];
}

export class CardMerchantPayoutDto {
    @ApiProperty({ description: "本次分红金额，不能超过应付佣金", example: "500" })
    @IsNumberString()
    amount!: string;

    @ApiProperty({ description: "打款方式，例如 银行转账 / 微信" })
    @IsString()
    @Length(1, 64)
    method!: string;

    @ApiPropertyOptional({ description: "打款流水号或凭证编号，便于日后对账" })
    @IsOptional()
    @IsString()
    @MaxLength(128)
    reference?: string;

    @ApiPropertyOptional({ description: "备注" })
    @IsOptional()
    @IsString()
    @MaxLength(200)
    note?: string;
}

export class AdjustCardMerchantCommissionDto {
    /** Signed: positive adds to what we owe, negative writes it down. */
    @ApiProperty({ description: "调整金额，正数增加应付佣金，负数减少", example: "-50" })
    @IsNumberString()
    amount!: string;

    @ApiProperty({ description: "调整原因，会写入佣金流水" })
    @IsString()
    @Length(1, 200)
    note!: string;
}

export class PaginationQueryDto {
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
}

export class CardMerchantScopedQueryDto extends PaginationQueryDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsUUID()
    merchantId?: string;
}

export class ReverseCardCommissionDto {
    @ApiProperty({ description: "要冲回佣金的订单号" })
    @IsString()
    @Length(4, 64)
    orderNo!: string;

    @ApiProperty({ description: "冲回原因，例如已退款给买家" })
    @IsString()
    @Length(1, 200)
    note!: string;
}

/* ------------------------------- Channel API ------------------------------- */

export class CreateChannelCheckoutDto {
    @ApiProperty({ description: "商品 ID" })
    @IsUUID()
    productId!: string;

    @ApiProperty({ description: "购买数量", minimum: 1, maximum: 100 })
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    quantity!: number;

    @ApiProperty({ description: "买家邮箱，用于买家自助找回卡密" })
    @IsEmail()
    @MaxLength(160)
    email!: string;

    /** The channel's own order id. Doubles as the idempotency key for this checkout. */
    @ApiProperty({ description: "你自己的订单号，重复提交同一个值不会重复下单" })
    @IsString()
    @Length(1, 128)
    reference!: string;

    @ApiProperty({ description: "支付方式，取自 GET /products 返回的 methods" })
    @IsString()
    @MaxLength(32)
    method!: string;

    @ApiPropertyOptional({ description: "付款后回跳地址，必须在后台登记的白名单内" })
    @IsOptional()
    @IsString()
    @MaxLength(512)
    returnUrl?: string;
}

export class CardChannelOrderQueryDto extends PaginationQueryDto {
    @ApiPropertyOptional({ enum: ORDER_STATUSES })
    @IsOptional()
    @IsIn(ORDER_STATUSES)
    status?: (typeof ORDER_STATUSES)[number];
}
