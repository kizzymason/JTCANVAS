import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { PaginationDto } from "../../wallet/dto/wallet.dto";

export class VisitorBeaconDto {
    @ApiProperty({ example: "/canvas" })
    @IsString()
    @MaxLength(512)
    path!: string;

    @ApiPropertyOptional({ example: "1920x1080" })
    @IsOptional()
    @IsString()
    @MaxLength(32)
    screen?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(64)
    timezone?: string;

    /** Ignored. Kept so older clients that still send a fingerprint do not fail whitelist validation. */
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(64)
    fingerprint?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    webdriver?: boolean;
}

export class VisitorEventsQueryDto extends PaginationDto {
    @ApiPropertyOptional({ enum: ["human", "bot", "suspected"] })
    @IsOptional()
    @IsIn(["human", "bot", "suspected"])
    kind?: "human" | "bot" | "suspected";

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(200)
    path?: string;

    @ApiPropertyOptional({ description: "匹配 IP、UA 或路径" })
    @IsOptional()
    @IsString()
    @MaxLength(64)
    keyword?: string;
}
