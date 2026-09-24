import { Type } from "class-transformer";
import { ArrayUnique, IsArray, IsBoolean, IsDefined, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min, ValidateNested } from "class-validator";

export class HomeMediaDto {
    @IsIn(["brand", "upload"]) source!: "brand" | "upload";
    @IsString() @IsNotEmpty() key!: string;
}
export class HeroDto {
    @IsString() @IsNotEmpty() title!: string;
    @IsString() subtitle!: string;
    @IsBoolean() visible!: boolean;
    @IsOptional() @ValidateNested() @Type(() => HomeMediaDto) media!: HomeMediaDto | null;
}
export class EntryDto {
    @IsIn(["image", "video", "canvas"]) kind!: "image" | "video" | "canvas";
    @IsString() @IsNotEmpty() title!: string;
    @IsString() description!: string;
    @IsBoolean() visible!: boolean;
    @IsOptional() @ValidateNested() @Type(() => HomeMediaDto) media!: HomeMediaDto | null;
}
export class HomeConfigDto {
    @IsDefined() @ValidateNested() @Type(() => HeroDto) hero!: HeroDto;
    @IsArray() @ArrayUnique((entry: EntryDto) => entry.kind) @ValidateNested({ each: true }) @Type(() => EntryDto) entries!: EntryDto[];
}
export class HomeWorkDto {
    @IsString() @IsNotEmpty() title!: string;
    @IsString() @IsNotEmpty() category!: string;
    @IsIn(["image", "video"]) kind!: "image" | "video";
    @IsString() prompt!: string;
    @IsDefined() @ValidateNested() @Type(() => HomeMediaDto) media!: HomeMediaDto;
    @IsOptional() @ValidateNested() @Type(() => HomeMediaDto) poster!: HomeMediaDto | null;
    @IsBoolean() published!: boolean;
    @IsInt() @Min(-2147483648) @Max(2147483647) sortOrder!: number;
}
