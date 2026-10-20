import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ImplantationController, PublicRegionsController } from './implantation.controller';
import { ImplantationService } from './implantation.service';

@Module({ imports: [JwtModule.register({})], controllers: [ImplantationController, PublicRegionsController], providers: [ImplantationService, JwtAuthGuard] })
export class ImplantationModule {}
