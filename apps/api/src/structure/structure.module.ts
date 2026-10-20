import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { HealthController } from '../health/health.controller';
import { StructureController } from './structure.controller';
import { StructureService } from './structure.service';

@Module({ imports: [JwtModule.register({})], controllers: [StructureController, HealthController], providers: [StructureService, JwtAuthGuard] })
export class StructureModule {}
