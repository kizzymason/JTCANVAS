import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsNumberString, IsOptional, IsString, Length, Max, MaxLength, Min } from "class-validator";
import { PaginationDto } from "../../wallet/dto/wallet.dto";

export class UpsertResellerTierDto {
    @ApiProperty({ description: "等级名称" })
    @IsString()
    @Length(1, 64)
    name!: string;

    /**
     * Signed surcharge, not the final coefficient: 0.2 means +20%, -0.2 means a 20% discount.
     * Kept as a numeric string so the value never round-trips through a float.
     */
    @ApiProperty({ description: "倍率（有符号加价幅度），0.2 表示上浮 20%，-0.2 表示优惠 20%", example: "0.2" })
    @IsNumberString()
    multiplier!: string;

    @ApiPropertyOptional({ description: "等级说明" })
    @IsOptional()
    @IsString()
    @MaxLength(500)
    description?: string;

    @ApiPropertyOptional({ description: "是否作为审批通过时的默认等级" })
    @IsOptional()
    @IsBoolean()
    isDefault?: boolean;

    @ApiPropertyOptional({ description: "排序值，越小越靠前" })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    @Max(10_000)
    sortOrder?: number;
}

export class ResellerListQueryDto extends PaginationDto {
    @ApiPropertyOptional({ enum: ["pending", "approved", "rejected", "suspended"] })
    @IsOptional()
    @IsIn(["pending", "approved", "rejected", "suspended"])
    status?: "pending" | "approved" | "rejected" | "suspended";

    @ApiPropertyOptional({ description: "按用户名或公司名模糊搜索" })
    @IsOptional()
    @IsString()
    @MaxLength(128)
    keyword?: string;

    @ApiPropertyOptional({ description: "按等级筛选" })
    @IsOptional()
    @IsString()
    @MaxLength(64)
    tierId?: string;
}

export class ReviewResellerDto {
    @ApiProperty({ enum: ["approve", "reject"] })
    @IsIn(["approve", "reject"])
    decision!: "approve" | "reject";

    @ApiPropertyOptional({ description: "通过时指定等级，留空使用默认等级" })
    @IsOptional()
    @IsString()
    @MaxLength(64)
    tierId?: string;

    @ApiPropertyOptional({ description: "驳回原因，驳回时必填" })
    @IsOptional()
    @IsString()
    @MaxLength(500)
    rejectReason?: string;
}

export class UpdateResellerDto {
    @ApiPropertyOptional({ description: "调整等级" })
    @IsOptional()
    @IsString()
    @MaxLength(64)
    tierId?: string;

    @ApiPropertyOptional({ description: "专属倍率，优先于等级倍率", example: "-0.15" })
    @IsOptional()
    @IsNumberString()
    multiplierOverride?: string;

    /** Explicit, because `undefined` has to keep meaning "leave the override alone". */
    @ApiPropertyOptional({ description: "true 表示清除专属倍率，回落到等级倍率" })
    @IsOptional()
    @IsBoolean()
    clearMultiplierOverride?: boolean;

    @ApiPropertyOptional({ enum: ["approved", "suspended"], description: "停用或恢复代理商资格" })
    @IsOptional()
    @IsIn(["approved", "suspended"])
    status?: "approved" | "suspended";
}
