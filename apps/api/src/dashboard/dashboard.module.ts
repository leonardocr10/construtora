import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../common/prisma.module';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
@Module({ imports: [AuthModule, PrismaModule, JwtModule.register({})], controllers: [DashboardController], providers: [DashboardService, JwtAuthGuard] })
export class DashboardModule {}
