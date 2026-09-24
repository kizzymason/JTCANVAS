import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from "class-validator";
import { IsMediaInput, IsVideoContent } from "../media-input";

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
    @IsIn(["auto", "low", "medium", "high", "standard", "hd", "1K", "2K", "4K", "1k", "2k", "4k"])
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
    @IsMediaInput("image")
    image?: string | string[];

    @IsOptional()
    @IsArray()
    @IsMediaInput("image")
    image_urls?: string[];

    @IsOptional()
    @IsString()
    @IsMediaInput("image")
    mask?: string;

    @IsOptional()
    @IsString()
    @MaxLength(32)
    resolution?: string;

    @IsOptional()
    @IsString()
    @MaxLength(32)
    ratio?: string;

    @IsOptional()
    @IsString()
    @MaxLength(32)
    aspect_ratio?: string;

    @IsOptional()
    @IsBoolean()
    watermark?: boolean;

    @IsOptional()
    @IsBoolean()
    web_search?: boolean;

    @ApiPropertyOptional({ description: "调用方自定义标识，仅回显" })
    @IsOptional()
    @IsString()
    @MaxLength(256)
    user?: string;
}

/** Options accepted both at the top level and in New API's metadata object. */
export class VideoOptionsDto {
    @IsOptional()
    @IsVideoContent()
    content?: unknown[];

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(600)
    seconds?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(600)
    duration?: number;

    @IsOptional()
    @IsString()
    @MaxLength(32)
    size?: string;

    @IsOptional()
    @IsString()
    @MaxLength(32)
    resolution?: string;

    @IsOptional()
    @IsString()
    @MaxLength(32)
    ratio?: string;

    @IsOptional()
    @IsString()
    @MaxLength(32)
    aspect_ratio?: string;

    @IsOptional()
    @IsMediaInput()
    input_reference?: unknown;

    @IsOptional()
    @IsMediaInput("image")
    image?: unknown;

    @IsOptional()
    @IsArray()
    @IsMediaInput("image")
    images?: unknown[];

    @IsOptional()
    @IsArray()
    @IsMediaInput("image")
    image_urls?: unknown[];

    @IsOptional()
    @IsArray()
    @IsMediaInput("image")
    reference_images?: unknown[];

    @IsOptional()
    @IsArray()
    @IsMediaInput("video")
    videos?: unknown[];

    @IsOptional()
    @IsArray()
    @IsMediaInput("video")
    reference_videos?: unknown[];

    @IsOptional()
    @IsArray()
    @IsMediaInput("audio")
    audios?: unknown[];

    @IsOptional()
    @IsArray()
    @IsMediaInput("audio")
    reference_audios?: unknown[];

    @IsOptional()
    @IsBoolean()
    generate_audio?: boolean;

    @IsOptional()
    @IsBoolean()
    watermark?: boolean;

    @IsOptional()
    @IsInt()
    seed?: number;

    @IsOptional()
    @IsBoolean()
    camera_fixed?: boolean;

    @IsOptional()
    @IsBoolean()
    web_search?: boolean;
}

export class VideoCreateDto extends VideoOptionsDto {
    @ApiProperty({ example: "seedance-2-0-fast-NSFW" })
    @IsString()
    @MaxLength(256)
    model!: string;

    @IsOptional()
    @IsString()
    @MaxLength(20_000)
    prompt?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(4)
    n?: number;

    @IsOptional()
    @IsObject()
    @ValidateNested()
    @Type(() => VideoOptionsDto)
    metadata?: VideoOptionsDto;

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
