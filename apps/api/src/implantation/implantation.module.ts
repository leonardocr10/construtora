import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CalibrationService } from './calibration.service';
import { CalibrationController, ImplantationController, PublicRegionsController } from './implantation.controller';
import { ImplantationService } from './implantation.service';

@Module({ imports: [JwtModule.register({})], controllers: [ImplantationController, CalibrationController, PublicRegionsController], providers: [ImplantationService, CalibrationService, JwtAuthGuard] })
export class ImplantationModule {}
