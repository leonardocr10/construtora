import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DevelopmentsModule } from '../developments/developments.module';
import { ModelGenerationController } from './model-generation.controller';
import { ModelGenerationService } from './model-generation.service';

@Module({ imports: [JwtModule.register({}), DevelopmentsModule], controllers: [ModelGenerationController], providers: [ModelGenerationService, JwtAuthGuard] })
export class ModelGenerationModule {}
