import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from "class-validator";

export class PaginationDto {
    @ApiPropertyOptional({ default: 1 })
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page = 1;

    /** Canvas and asset libraries fetch the first page in one shot; 200 matches those clients. */
    @ApiPropertyOptional({ default: 20, maximum: 200 })
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(200)
    pageSize = 20;
}

export class LedgerQueryDto extends PaginationDto {
    @ApiPropertyOptional({ enum: ["recharge", "redeem", "freeze", "settle", "refund", "admin_adjust"] })
    @IsOptional()
    @IsIn(["recharge", "redeem", "freeze", "settle", "refund", "admin_adjust"])
    type?: "recharge" | "redeem" | "freeze" | "settle" | "refund" | "admin_adjust";
}

export class RedeemDto {
    @ApiProperty({ description: "卡密，忽略大小写与空格" })
    @IsString()
    @Length(8, 64)
    code!: string;
}
