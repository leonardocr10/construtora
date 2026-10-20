import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PublicController, SurroundingsAdminController } from './public.controller';
import { PublicService } from './public.service';

@Module({ imports: [JwtModule.register({})], controllers: [PublicController, SurroundingsAdminController], providers: [PublicService, JwtAuthGuard] })
export class PublicModule {}
