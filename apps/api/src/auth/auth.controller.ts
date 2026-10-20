import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { AuthService } from './auth.service';

class LoginDto { @IsEmail() email!: string; @IsString() @MinLength(8) password!: string; @IsString() organizationId!: string; }
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post('login') login(@Body() body: LoginDto) { return this.auth.login(body.email, body.password, body.organizationId); }
}
