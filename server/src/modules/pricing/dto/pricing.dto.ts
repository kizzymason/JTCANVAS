import { ApiPropertyOptional, ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export class EstimateDto {
    @ApiProperty({ description: "channelId::modelName" })
    @IsString()
    @MaxLength(256)
    model!: string;

    @ApiPropertyOptional({ description: "生成数量", default: 1 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(50)
    count?: number;

    @ApiPropertyOptional({ description: "视频时长（秒）" })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(600)
    seconds?: number;

    @ApiPropertyOptional({ description: "尺寸或质量档位，用于命中差异化定价" })
    @IsOptional()
    @IsString()
    @MaxLength(32)
    spec?: string;

    @ApiPropertyOptional({ description: "参考图数量" })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    @Max(20)
    referenceCount?: number;
}

export class ModelsQueryDto {
    @ApiPropertyOptional({ enum: ["image", "video", "text", "audio"] })
    @IsOptional()
    @IsIn(["image", "video", "text", "audio"])
    capability?: "image" | "video" | "text" | "audio";
}
