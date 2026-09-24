import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumberString, IsOptional, IsString, Length, Max, MaxLength, Min } from "class-validator";
import { PaginationDto } from "../../wallet/dto/wallet.dto";

export class ApplyResellerDto {
    @ApiProperty({ description: "公司或团队名称" })
    @IsString()
    @Length(2, 128)
    companyName!: string;

    @ApiPropertyOptional({ description: "联系邮箱" })
    @IsOptional()
    @IsString()
    @MaxLength(128)
    contactEmail?: string;

    @ApiPropertyOptional({ description: "官网或产品地址" })
    @IsOptional()
    @IsString()
    @MaxLength(256)
    website?: string;

    @ApiProperty({ description: "使用场景说明" })
    @IsString()
    @Length(10, 2000)
    useCase!: string;
}

export class CreateTokenDto {
    @ApiPropertyOptional({ description: "令牌名称" })
    @IsOptional()
    @IsString()
    @MaxLength(64)
    name?: string;

    @ApiPropertyOptional({ description: "累计消费上限（元），留空表示不限" })
    @IsOptional()
    @IsNumberString()
    quotaLimit?: string;

    @ApiPropertyOptional({ description: "每分钟请求上限，0 表示用平台默认值" })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    @Max(100_000)
    rpmLimit?: number;

    @ApiPropertyOptional({ description: "并发上限，0 表示用平台默认值" })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    @Max(1000)
    concurrencyLimit?: number;

    @ApiPropertyOptional({ description: "允许调用的模型标识，留空表示全部", type: [String] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    @MaxLength(256, { each: true })
    modelScope?: string[];

    @ApiPropertyOptional({ description: "允许的来源 IP，留空表示不限", type: [String] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    @MaxLength(64, { each: true })
    allowedIps?: string[];

    @ApiPropertyOptional({ description: "过期时间（ISO 8601），留空表示长期有效" })
    @IsOptional()
    @IsDateString()
    expiresAt?: string;
}

export class UpdateTokenDto extends CreateTokenDto {
    @ApiPropertyOptional({ enum: ["active", "disabled"] })
    @IsOptional()
    @IsIn(["active", "disabled"])
    status?: "active" | "disabled";

    /** Sent explicitly so "leave unlimited" and "clear the limit" stay distinguishable. */
    @ApiPropertyOptional({ description: "true 表示清除额度上限" })
    @IsOptional()
    @IsBoolean()
    clearQuotaLimit?: boolean;

    @ApiPropertyOptional({ description: "true 表示清除过期时间" })
    @IsOptional()
    @IsBoolean()
    clearExpiresAt?: boolean;
}

export class ResellerLogQueryDto extends PaginationDto {
    @ApiPropertyOptional({ description: "起始时间（ISO 8601）" })
    @IsOptional()
    @IsDateString()
    from?: string;

    @ApiPropertyOptional({ description: "结束时间（ISO 8601）" })
    @IsOptional()
    @IsDateString()
    to?: string;

    @ApiPropertyOptional({ description: "模型标识" })
    @IsOptional()
    @IsString()
    @MaxLength(256)
    model?: string;

    @ApiPropertyOptional({ description: "令牌 ID" })
    @IsOptional()
    @IsString()
    @MaxLength(64)
    apiKeyId?: string;

    @ApiPropertyOptional({ enum: ["success", "failed"] })
    @IsOptional()
    @IsIn(["success", "failed"])
    status?: "success" | "failed";
}

export class ResellerOverviewQueryDto {
    @ApiPropertyOptional({ description: "模型分布统计天数", default: 1, maximum: 30 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(30)
    days?: number;
}
