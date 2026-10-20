import { Body, Controller, Get, Param, Patch, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsEnum, IsInt, IsNumber, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { LeadStatus, UnitStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrganizationContext } from '../common/organization-context';
import { BuildingInput, FloorInput, FloorPlanInput, LeadInput, StructureService, UnitInput } from './structure.service';

type Request = { organization: OrganizationContext };

class BuildingDto implements BuildingInput {
  @IsString() @MaxLength(120) name!: string;
  @IsString() @MaxLength(40) code!: string;
  @IsOptional() @Type(() => Number) @IsInt() sortOrder?: number;
  @IsOptional() @IsString() imageAssetId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) floorCount?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) unitsPerFloor?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(2) floorHeight?: number;
  /** Posição no terreno em metros: { x, z, rotation }. */
  @IsOptional() @IsObject() position?: object;
  /** Volumetria: { width, depth, colors, unitSlots }. */
  @IsOptional() @IsObject() model3d?: object;
}
class FloorDto implements FloorInput {
  @IsString() @MaxLength(80) name!: string;
  @Type(() => Number) @IsInt() number!: number;
  @IsOptional() @Type(() => Number) @IsInt() sortOrder?: number;
}
class UnitDto implements UnitInput {
  @IsString() @MaxLength(20) number!: string;
  @IsOptional() @IsString() floorId?: string;
  @IsOptional() @IsString() unitTypeId?: string;
  @IsOptional() @IsString() final?: string;
  @IsOptional() @IsEnum(UnitStatus) status?: UnitStatus;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) privateArea?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) totalArea?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) price?: number;
}
class GenerateUnitsDto {
  @Type(() => Number) @IsInt() @Min(-5) from!: number;
  @Type(() => Number) @IsInt() @Min(-5) to!: number;
  @Type(() => Number) @IsInt() @Min(1) perFloor!: number;
  @IsString() @MaxLength(60) pattern!: string;
  /** Final ("01") → id da planta. */
  @IsOptional() @IsObject() floorPlansByFinal?: Record<string, string>;
}
class UnitStatusDto { @IsEnum(UnitStatus) status!: UnitStatus; @IsOptional() @IsString() @MaxLength(255) reason?: string; }
class FloorPlanDto implements FloorPlanInput {
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @Type(() => Number) @IsNumber() area?: number;
  @IsOptional() @Type(() => Number) @IsInt() bedrooms?: number;
  @IsOptional() @Type(() => Number) @IsInt() suites?: number;
  @IsOptional() @Type(() => Number) @IsInt() bathrooms?: number;
  @IsOptional() @Type(() => Number) @IsInt() parkingSpaces?: number;
  @IsOptional() @IsString() description?: string;
}
class LinkFloorPlanDto { @IsString() floorPlanId!: string; @IsOptional() @IsBoolean() primary?: boolean; }
class FloorPlanLayoutDto { /** Validado em detalhe por parsePlanLayout; null remove. */ @IsOptional() @IsObject() layout!: object | null; }
class ActivateModelDto { @IsString() modelVersionId!: string; }
class ViewerDto { @IsOptional() @IsObject() camera?: object; @IsOptional() @IsObject() lighting?: object; @IsOptional() @IsObject() interaction?: object; @IsOptional() @IsObject() publicLayout?: object; }
class LeadDto implements LeadInput {
  @IsString() @MaxLength(160) name!: string;
  @IsString() @MaxLength(40) phone!: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() message?: string;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsString() unitId?: string;
  @IsOptional() @IsBoolean() consent?: boolean;
}
class LeadUpdateDto { @IsOptional() @IsEnum(LeadStatus) status?: LeadStatus; @IsOptional() @IsString() notes?: string; @IsOptional() @IsString() assignedToId?: string; }

@ApiTags('structure') @ApiBearerAuth()
@Controller() @UseGuards(JwtAuthGuard)
export class StructureController {
  constructor(private readonly structure: StructureService) {}

  @Get('developments/:id/buildings') buildings(@Req() r: Request, @Param('id') id: string) { return this.structure.listBuildings(r.organization, id); }
  @Post('developments/:id/buildings') createBuilding(@Req() r: Request, @Param('id') id: string, @Body() body: BuildingDto) { return this.structure.createBuilding(r.organization, id, body); }
  @Patch('buildings/:id') updateBuilding(@Req() r: Request, @Param('id') id: string, @Body() body: Partial<BuildingDto>) { return this.structure.updateBuilding(r.organization, id, body); }

  @Post('buildings/:id/generate') generate(@Req() r: Request, @Param('id') id: string, @Body() body: GenerateUnitsDto) { return this.structure.generateUnits(r.organization, id, body); }
  @Post('buildings/:id/floors') createFloor(@Req() r: Request, @Param('id') id: string, @Body() body: FloorDto) { return this.structure.createFloor(r.organization, id, body); }

  @Get('buildings/:id/units') units(@Req() r: Request, @Param('id') id: string) { return this.structure.listUnits(r.organization, id); }
  @Post('buildings/:id/units') createUnit(@Req() r: Request, @Param('id') id: string, @Body() body: UnitDto) { return this.structure.createUnit(r.organization, id, body); }
  @Patch('units/:id') updateUnit(@Req() r: Request, @Param('id') id: string, @Body() body: Partial<UnitDto>) { const { status: _ignored, ...rest } = body; return this.structure.updateUnit(r.organization, id, rest); }
  @Put('units/:id/status') unitStatus(@Req() r: Request, @Param('id') id: string, @Body() body: UnitStatusDto) { return this.structure.changeUnitStatus(r.organization, id, body.status, body.reason); }
  @Get('units/:id/status-history') unitHistory(@Req() r: Request, @Param('id') id: string) { return this.structure.unitHistory(r.organization, id); }
  @Post('units/:id/floor-plans') linkFloorPlan(@Req() r: Request, @Param('id') id: string, @Body() body: LinkFloorPlanDto) { return this.structure.linkFloorPlan(r.organization, id, body.floorPlanId, body.primary); }

  @Get('developments/:id/floor-plans') floorPlans(@Req() r: Request, @Param('id') id: string) { return this.structure.listFloorPlans(r.organization, id); }
  @Get('floor-plans/:id/layout') floorPlanLayout(@Req() r: Request, @Param('id') id: string) { return this.structure.floorPlanLayout(r.organization, id); }
  @Get('floor-plans/:id/assets/:assetId')
  async floorPlanAsset(@Req() r: Request, @Param('id') id: string, @Param('assetId') assetId: string, @Res() response: { setHeader(k: string, v: string): void }) {
    const file = await this.structure.floorPlanAsset(r.organization, id, assetId);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Cache-Control', 'private, max-age=3600');
    createReadStream(file.path).pipe(response as unknown as NodeJS.WritableStream);
  }
  @Put('floor-plans/:id/layout') saveFloorPlanLayout(@Req() r: Request, @Param('id') id: string, @Body() body: FloorPlanLayoutDto) { return this.structure.saveFloorPlanLayout(r.organization, id, body.layout ?? null); }
  @Post('developments/:id/floor-plans') createFloorPlan(@Req() r: Request, @Param('id') id: string, @Body() body: FloorPlanDto) { return this.structure.createFloorPlan(r.organization, id, body); }

  @Get('developments/:id/models') models(@Req() r: Request, @Param('id') id: string) { return this.structure.listModelVersions(r.organization, id); }
  @Put('developments/:id/viewer/active-model') activateModel(@Req() r: Request, @Param('id') id: string, @Body() body: ActivateModelDto) { return this.structure.activateModelVersion(r.organization, id, body.modelVersionId); }
  @Patch('developments/:id/viewer') viewer(@Req() r: Request, @Param('id') id: string, @Body() body: ViewerDto) { return this.structure.updateViewer(r.organization, id, body as never); }

  @Get('developments/:id/leads') leads(@Req() r: Request, @Param('id') id: string) { return this.structure.listLeads(r.organization, id); }
  @Post('developments/:id/leads') createLead(@Req() r: Request, @Param('id') id: string, @Body() body: LeadDto) { return this.structure.createLead(r.organization, id, body); }
  @Patch('leads/:id') updateLead(@Req() r: Request, @Param('id') id: string, @Body() body: LeadUpdateDto) { return this.structure.updateLead(r.organization, id, body); }
}
