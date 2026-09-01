import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export class CreateGenerationDto {
    @ApiProperty({ enum: ["image", "video", "text", "audio"] })
    @IsIn(["image", "video", "text", "audio"])
    capability!: "image" | "video" | "text" | "audio";

    @ApiProperty({ description: "channelId::modelName" })
    @IsString()
    @MaxLength(256)
    model!: string;

    @ApiProperty()
    @IsString()
    @MaxLength(20_000)
    prompt!: string;

    @ApiPropertyOptional({ description: "参考图 storageKey 列表", type: [String] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    references?: string[];

    @ApiPropertyOptional({ description: "蒙版 storageKey" })
    @IsOptional()
    @IsString()
    mask?: string;

    @ApiPropertyOptional({ default: 1, maximum: 15 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(15)
    count?: number;

    @ApiPropertyOptional({ description: "auto、16:9 或 1024x1024" })
    @IsOptional()
    @IsString()
    @MaxLength(32)
    size?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(32)
    quality?: string;

    @ApiPropertyOptional({ description: "transparent 表示透明背景" })
    @IsOptional()
    @IsString()
    @MaxLength(32)
    background?: string;

    @ApiPropertyOptional({ description: "视频时长（秒）", maximum: 600 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(600)
    seconds?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(32)
    resolution?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    generateAudio?: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    watermark?: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(64)
    voice?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(16)
    audioFormat?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(16)
    audioSpeed?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(2000)
    audioInstructions?: string;

    @ApiPropertyOptional({ enum: ["auto", "low", "medium", "high", "xhigh"] })
    @IsOptional()
    @IsIn(["auto", "low", "medium", "high", "xhigh"])
    reasoningEffort?: string;

    @ApiPropertyOptional({ description: "调用来源，便于客服排查", example: "canvas" })
    @IsOptional()
    @IsString()
    @MaxLength(64)
    source?: string;
}
