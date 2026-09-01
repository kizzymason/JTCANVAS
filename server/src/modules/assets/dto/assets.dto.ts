import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsIn, IsObject, IsOptional, IsString, MaxLength } from "class-validator";
import { PaginationDto } from "../../wallet/dto/wallet.dto";

export class AssetQueryDto extends PaginationDto {
    @ApiPropertyOptional({ enum: ["text", "image", "video", "audio"] })
    @IsOptional()
    @IsIn(["text", "image", "video", "audio"])
    kind?: "text" | "image" | "video" | "audio";

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(100)
    keyword?: string;
}

export class CreateAssetDto {
    @ApiProperty({ enum: ["text", "image", "video", "audio"] })
    @IsIn(["text", "image", "video", "audio"])
    kind!: "text" | "image" | "video" | "audio";

    @ApiProperty()
    @IsString()
    @MaxLength(200)
    title!: string;

    @ApiPropertyOptional({ description: "文本素材正文" })
    @IsOptional()
    @IsString()
    @MaxLength(100_000)
    content?: string;

    @ApiPropertyOptional({ description: "附件文件 id" })
    @IsOptional()
    @IsString()
    @MaxLength(36)
    fileId?: string;

    @ApiPropertyOptional({ description: "封面文件 id" })
    @IsOptional()
    @IsString()
    @MaxLength(36)
    coverFileId?: string;

    @ApiPropertyOptional({ description: "已上传文件的 storageKey，服务端据此绑定 fileId" })
    @IsOptional()
    @IsString()
    @MaxLength(200)
    storageKey?: string;

    @ApiPropertyOptional({ type: [String] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    tags?: string[];

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(200)
    source?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(2000)
    note?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsObject()
    metadata?: Record<string, unknown>;
}

export class UpdateAssetDto extends CreateAssetDto {
    @ApiPropertyOptional({ enum: ["text", "image", "video", "audio"] })
    @IsOptional()
    @IsIn(["text", "image", "video", "audio"])
    declare kind: "text" | "image" | "video" | "audio";

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(200)
    declare title: string;
}
