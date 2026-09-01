import { ApiProperty } from "@nestjs/swagger";
import { IsObject, IsString, Matches, MaxLength, MinLength } from "class-validator";

/** Username rules are deliberately strict: they are the login identity and appear in admin lists. */
const USERNAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

export class RegisterDto {
    @ApiProperty({ minLength: 3, maxLength: 32, description: "字母、数字、下划线或连字符" })
    @IsString()
    @MinLength(3, { message: "用户名至少 3 个字符" })
    @MaxLength(32, { message: "用户名最多 32 个字符" })
    @Matches(USERNAME_PATTERN, { message: "用户名只能包含字母、数字、下划线和连字符" })
    username!: string;

    @ApiProperty({ minLength: 8, maxLength: 128 })
    @IsString()
    @MinLength(8, { message: "密码至少 8 个字符" })
    @MaxLength(128, { message: "密码最多 128 个字符" })
    password!: string;
}

export class LoginDto {
    @ApiProperty()
    @IsString()
    @MaxLength(32)
    username!: string;

    @ApiProperty()
    @IsString()
    @MaxLength(128)
    password!: string;
}

export class UpdatePreferencesDto {
    @ApiProperty({ description: "前台生成默认参数等偏好，整体覆盖保存" })
    @IsObject()
    preferences!: Record<string, unknown>;
}

export class ChangePasswordDto {
    @ApiProperty()
    @IsString()
    @MaxLength(128)
    currentPassword!: string;

    @ApiProperty({ minLength: 8, maxLength: 128 })
    @IsString()
    @MinLength(8, { message: "新密码至少 8 个字符" })
    @MaxLength(128)
    newPassword!: string;
}
