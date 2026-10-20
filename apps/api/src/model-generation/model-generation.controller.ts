import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrganizationContext } from '../common/organization-context';
import { ModelGenerationService } from './model-generation.service';

type Request = { organization: OrganizationContext };

@ApiTags('model-generation') @ApiBearerAuth()
@Controller() @UseGuards(JwtAuthGuard)
export class ModelGenerationController {
  constructor(private readonly generation: ModelGenerationService) {}

  /** Gera o GLB paramétrico da torre no Blender local e registra uma nova versão do modelo 3D. */
  @Post('buildings/:id/model/generate') generate(@Req() r: Request, @Param('id') id: string) { return this.generation.generateTowerModel(r.organization, id); }
  @Get('buildings/:id/model/jobs') jobs(@Req() r: Request, @Param('id') id: string) { return this.generation.listTowerJobs(r.organization, id); }
}
