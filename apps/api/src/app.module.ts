import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { PrismaModule } from './common/prisma.module';
import { DevelopmentsModule } from './developments/developments.module';
import { StructureModule } from './structure/structure.module';
import { PublicModule } from './public/public.module';
import { ImplantationModule } from './implantation/implantation.module';
import { ModelGenerationModule } from './model-generation/model-generation.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]), PrismaModule, AuthModule, DashboardModule, DevelopmentsModule, StructureModule, PublicModule, ImplantationModule, ModelGenerationModule],
})
export class AppModule {}
