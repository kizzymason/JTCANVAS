import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, ValidateNested } from "class-validator";

const emptyToNull = ({ value }: { value: unknown }) => (value === "" ? null : value);
const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);

export class ModelBadgeDto {
    @ApiProperty({ description: "标识 key，便于前端做图标映射" })
    @IsString()
    @MaxLength(24)
    key!: string;

    @ApiProperty({ description: "展示文案，例如「最新」「推荐」" })
    @IsString()
    @MaxLength(16)
    label!: string;

    @ApiPropertyOptional({ enum: ["primary", "neutral", "warning"] })
    @IsOptional()
    @IsIn(["primary", "neutral", "warning"])
    tone?: "primary" | "neutral" | "warning";
}

export class UpsertModelGroupDto {
    @ApiProperty({ description: "分组 key，代码引用用" })
    @Transform(trim)
    @IsString()
    @MaxLength(48)
    key!: string;

    @ApiProperty({ description: "分组的展示名称" })
    @Transform(trim)
    @IsString()
    @MaxLength(48)
    name!: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(200)
    description?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsInt()
    @Min(0)
    sortOrder?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    visible?: boolean;
}

export class UpsertModelPresentationDto {
    @ApiProperty({ description: "渠道模型值，格式 channelId::modelName" })
    @Transform(trim)
    @IsString()
    @MaxLength(160)
    modelValue!: string;

    @ApiPropertyOptional({ description: "所属分组 id，留空表示未分组" })
    @IsOptional()
    @Transform(emptyToNull)
    @IsString()
    @MaxLength(64)
    groupId?: string | null;

    @ApiPropertyOptional({ description: "一句话简介" })
    @IsOptional()
    @IsString()
    @MaxLength(120)
    summary?: string;

    @ApiPropertyOptional({ description: "详细介绍，支持换行" })
    @IsOptional()
    @IsString()
    @MaxLength(4000)
    description?: string;

    @ApiPropertyOptional({ type: [ModelBadgeDto] })
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ModelBadgeDto)
    badges?: ModelBadgeDto[];

    @ApiPropertyOptional()
    @IsOptional()
    @IsInt()
    @Min(0)
    sortOrder?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    visible?: boolean;
}
