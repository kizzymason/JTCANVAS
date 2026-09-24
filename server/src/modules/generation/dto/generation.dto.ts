import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from "class-validator";
import { PaginationDto } from "../../wallet/dto/wallet.dto";

export class GenerationQueryDto extends PaginationDto {
    @IsOptional()
    @IsIn(["image", "video", "text", "audio"])
    capability?: "image" | "video" | "text" | "audio";

    @IsOptional()
    @IsIn(["active"])
    status?: "active";
}

export class GenerationReferenceDto {
    @IsString()
    url!: string;

    @IsIn(["image", "video", "audio"])
    type!: "image" | "video" | "audio";

    @IsOptional()
    @IsIn(["first_frame", "last_frame", "reference_image", "reference_video", "reference_audio"])
    role?: "first_frame" | "last_frame" | "reference_image" | "reference_video" | "reference_audio";
}

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

    @ApiPropertyOptional({ description: "参考图 storageKey 或公网 http(s) 图片地址", type: [String] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    @MaxLength(2048, { each: true })
    references?: string[];

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => GenerationReferenceDto)
    referenceMedia?: GenerationReferenceDto[];

    @IsOptional()
    @IsInt()
    seed?: number;

    @IsOptional()
    @IsBoolean()
    cameraFixed?: boolean;

    @IsOptional()
    @IsBoolean()
    webSearch?: boolean;

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

    /**
     * Output ceiling for token-billed models. It is both the freeze basis and the upstream limit, so a
     * caller lowering it lowers the hold *and* the reply length; it can never be used to under-pay.
     */
    @ApiPropertyOptional({ description: "按 token 计费模型的输出上限", maximum: 128_000 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(128_000)
    maxOutputTokens?: number;

    @ApiPropertyOptional({ description: "调用来源，便于客服排查", example: "canvas" })
    @IsOptional()
    @IsString()
    @MaxLength(64)
    source?: string;
}
