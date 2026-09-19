import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from "class-validator";

/**
 * Request shapes for the downstream API. They mirror the OpenAI reference exactly where it exists;
 * anything the OpenAI schema has no room for (reference images for image-to-video, an explicit
 * resolution) is added as a clearly-named extension rather than by overloading a standard field.
 */

export class ImageGenerationDto {
    @ApiProperty({ example: "seedream-4-0-250828" })
    @IsString()
    @MaxLength(256)
    model!: string;

    @ApiProperty()
    @IsString()
    @MaxLength(20_000)
    prompt!: string;

    @ApiPropertyOptional({ description: "生成张数", default: 1, maximum: 15 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(15)
    n?: number;

    @ApiPropertyOptional({ description: "1024x1024、16:9 或 auto" })
    @IsOptional()
    @IsString()
    @MaxLength(32)
    size?: string;

    @ApiPropertyOptional({ enum: ["auto", "low", "medium", "high"] })
    @IsOptional()
    @IsIn(["auto", "low", "medium", "high", "standard", "hd"])
    quality?: string;

    @ApiPropertyOptional({ enum: ["auto", "transparent", "opaque"] })
    @IsOptional()
    @IsIn(["auto", "transparent", "opaque"])
    background?: string;

    @ApiPropertyOptional({ enum: ["url", "b64_json"], default: "url" })
    @IsOptional()
    @IsIn(["url", "b64_json"])
    response_format?: "url" | "b64_json";

    /** Extension: public https URLs used as reference images. */
    @ApiPropertyOptional({ description: "参考图公网 https 地址", type: [String] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    image?: string[];

    @ApiPropertyOptional({ description: "调用方自定义标识，仅回显" })
    @IsOptional()
    @IsString()
    @MaxLength(256)
    user?: string;
}

export class VideoInputReferenceDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(2048)
    image_url?: string;
}

export class VideoCreateDto {
    @ApiProperty({ example: "seedance-1-0-pro-250528" })
    @IsString()
    @MaxLength(256)
    model!: string;

    @ApiProperty()
    @IsString()
    @MaxLength(20_000)
    prompt!: string;

    /** OpenAI sends this as a string ("4"); numbers are accepted too. */
    @ApiPropertyOptional({ description: "时长（秒）", example: "5" })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(600)
    seconds?: number;

    @ApiPropertyOptional({ description: "1280x720 等" })
    @IsOptional()
    @IsString()
    @MaxLength(32)
    size?: string;

    /** Extension: the resolution tier directly, avoiding a size-to-tier guess. */
    @ApiPropertyOptional({ description: "480 / 720 / 1080" })
    @IsOptional()
    @IsString()
    @MaxLength(16)
    resolution?: string;

    @ApiPropertyOptional({ type: VideoInputReferenceDto })
    @IsOptional()
    @IsObject()
    @ValidateNested()
    @Type(() => VideoInputReferenceDto)
    input_reference?: VideoInputReferenceDto;

    @ApiPropertyOptional({ description: "是否生成配音" })
    @IsOptional()
    @IsBoolean()
    generate_audio?: boolean;

    @ApiPropertyOptional({ description: "生成条数", default: 1, maximum: 4 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(4)
    n?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(256)
    user?: string;
}

export class ChatMessageDto {
    @ApiProperty({ enum: ["system", "developer", "user", "assistant", "tool"] })
    @IsIn(["system", "developer", "user", "assistant", "tool"])
    role!: string;

    /** A string, or the OpenAI content-parts array. Validated loosely and flattened by the mapper. */
    @ApiPropertyOptional()
    @IsOptional()
    content?: unknown;
}

export class ChatStreamOptionsDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    include_usage?: boolean;
}

export class ChatCompletionDto {
    @ApiProperty({ example: "gpt-5.1" })
    @IsString()
    @MaxLength(256)
    model!: string;

    @ApiProperty({ type: [ChatMessageDto] })
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ChatMessageDto)
    messages!: ChatMessageDto[];

    @ApiPropertyOptional({ default: false })
    @IsOptional()
    @IsBoolean()
    stream?: boolean;

    @ApiPropertyOptional({ type: ChatStreamOptionsDto })
    @IsOptional()
    @IsObject()
    @ValidateNested()
    @Type(() => ChatStreamOptionsDto)
    stream_options?: ChatStreamOptionsDto;

    @ApiPropertyOptional({ description: "输出上限，同时作为冻结依据", maximum: 128_000 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(128_000)
    max_tokens?: number;

    @ApiPropertyOptional({ description: "max_tokens 的新名称，优先生效", maximum: 128_000 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(128_000)
    max_completion_tokens?: number;

    /** Accepted for SDK compatibility; the upstream Responses call does not take it. */
    @ApiPropertyOptional()
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    @Max(2)
    temperature?: number;

    @ApiPropertyOptional({ enum: ["auto", "low", "medium", "high", "xhigh"] })
    @IsOptional()
    @IsIn(["auto", "low", "medium", "high", "xhigh"])
    reasoning_effort?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(256)
    user?: string;
}
