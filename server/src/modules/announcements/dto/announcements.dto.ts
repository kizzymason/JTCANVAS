import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from "class-validator";
import { PaginationDto } from "../../wallet/dto/wallet.dto";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class AnnouncementQueryDto extends PaginationDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(64)
    keyword?: string;
}

export class UpsertAnnouncementDto {
    @ApiProperty()
    @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
    @IsString()
    @MinLength(1)
    @MaxLength(120)
    title!: string;

    @ApiProperty()
    @IsString()
    @MaxLength(200_000)
    content!: string;

    @ApiPropertyOptional({ description: "公开路径，例如 join-community。留空则自动生成" })
    @IsOptional()
    @Transform(({ value }) => (typeof value === "string" && !value.trim() ? undefined : value))
    @IsString()
    @MaxLength(64)
    @Matches(SLUG_PATTERN, { message: "标识只能包含小写字母、数字和连字符" })
    slug?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    published?: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    pinned?: boolean;

    @ApiPropertyOptional({ default: 100 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    @Max(10_000)
    sortOrder?: number;
}
