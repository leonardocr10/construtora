import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
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
  /** Corpo opcional { activate: true }: já passa a usar o GLB gerado no visualizador público. */
  @Post('buildings/:id/model/generate') generate(@Req() r: Request, @Param('id') id: string, @Body() body: { activate?: boolean } = {}) { return this.generation.generateTowerModel(r.organization, id, { activate: body?.activate === true }); }
  /** Escolhe o GLB (asset MODEL_3D) usado pelo visualizador para a torre; { assetId: null } volta ao paramétrico. */
  @Put('buildings/:id/model/viewer') viewer(@Req() r: Request, @Param('id') id: string, @Body() body: { assetId?: string | null; version?: number }) { return this.generation.setViewerModel(r.organization, id, { assetId: body?.assetId ?? null, version: body?.version }); }
  @Get('buildings/:id/model/jobs') jobs(@Req() r: Request, @Param('id') id: string) { return this.generation.listTowerJobs(r.organization, id); }
}
