import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsInt, IsObject, IsOptional, IsString, MaxLength, Min } from "class-validator";

export class CreateProjectDto {
    @ApiProperty()
    @IsString()
    @MaxLength(200)
    title!: string;

    @ApiPropertyOptional({ description: "画布数据：nodes、connections、chatSessions 等" })
    @IsOptional()
    @IsObject()
    data?: Record<string, unknown>;
}

export class UpdateProjectDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(200)
    title?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsObject()
    data?: Record<string, unknown>;

    @ApiProperty({ description: "客户端加载时的版本号，用于乐观锁" })
    @Type(() => Number)
    @IsInt()
    @Min(1)
    version!: number;
}

export class DeleteManyDto {
    @ApiProperty({ type: [String] })
    @IsArray()
    @IsString({ each: true })
    ids!: string[];
}
