import { Module } from '@nestjs/common';
import { PrismaModule } from '../common/prisma.module';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DevelopmentsController } from './developments.controller';
import { DevelopmentsService } from './developments.service';

@Module({ imports: [PrismaModule, JwtModule.register({})], controllers: [DevelopmentsController], providers: [DevelopmentsService, JwtAuthGuard], exports: [DevelopmentsService] })
export class DevelopmentsModule {}
