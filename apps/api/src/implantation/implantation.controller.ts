import { Body, Controller, Get, Headers, Param, Put, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsLatitude, IsLongitude, IsNumber, IsObject, IsOptional, IsString, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrganizationContext } from '../common/organization-context';
import { AmenityPlacementInput, ImplantationInput, ImplantationService, LayoutInput, LotInput, ModelLinkInput, PlacementInput } from './implantation.service';

type Request = { organization: OrganizationContext };
type Point = [number, number];
interface StreamResponse { setHeader(name: string, value: string): void; status(code: number): StreamResponse; end(): void }

class LayoutDto implements LayoutInput {
  @IsOptional() @IsString() siteImageAssetId?: string;
  @Type(() => Number) @IsNumber() @Min(1) imageWidth!: number;
  @Type(() => Number) @IsNumber() @Min(1) imageHeight!: number;
  @Type(() => Number) @IsNumber() metersPerPixel!: number;
  /** Pixel da imagem que corresponde à latitude/longitude do empreendimento. */
  @IsArray() origin!: Point;
  /** Para onde aponta o topo da imagem, em graus (0 = norte). */
  @Type(() => Number) @IsNumber() azimuth!: number;
  /** Contorno do terreno em pixels. */
  @IsOptional() @IsArray() lot?: Point[];
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) markerRadius?: number;
}
class PlacementDto implements PlacementInput {
  @IsString() id!: string;
  /** Metros no referencial do terreno: { x, z, rotation (graus) }. */
  @IsObject() position!: { x: number; z: number; rotation?: number };
  @IsOptional() @Type(() => Number) @IsNumber() width?: number;
  @IsOptional() @Type(() => Number) @IsNumber() depth?: number;
}
class AmenityPlacementDto implements AmenityPlacementInput {
  @IsOptional() @IsString() id?: string;
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @Type(() => Number) @IsInt() @Min(0) marker?: number | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsObject() position?: { x: number; z: number } | null;
}
class LotDto implements LotInput {
  @IsOptional() @IsString() id?: string;
  @IsString() @MaxLength(120) name!: string;
  /** Vértices em pixels da implantação. */
  @IsArray() points!: Point[];
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() unitId?: string | null;
}
class ImplantationDto implements ImplantationInput {
  @IsOptional() @ValidateNested() @Type(() => LayoutDto) layout?: LayoutDto;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsLatitude() latitude?: number | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsLongitude() longitude?: number | null;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PlacementDto) buildings?: PlacementDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => AmenityPlacementDto) amenities?: AmenityPlacementDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => LotDto) lots?: LotDto[];
}
class ModelLinkDto implements ModelLinkInput { @IsString() @MaxLength(191) node!: string; @IsString() unitId!: string; }
class ModelLinksDto { @IsArray() @ValidateNested({ each: true }) @Type(() => ModelLinkDto) links!: ModelLinkDto[]; }

@ApiTags('implantation') @ApiBearerAuth()
@Controller('developments') @UseGuards(JwtAuthGuard)
export class ImplantationController {
  constructor(private readonly implantation: ImplantationService) {}

  @Get(':id/implantation') get(@Req() r: Request, @Param('id') id: string) { return this.implantation.get(r.organization, id); }
  @Put(':id/implantation') save(@Req() r: Request, @Param('id') id: string, @Body() body: ImplantationDto) { return this.implantation.save(r.organization, id, body); }

  @Get(':id/models/:versionId/links') links(@Req() r: Request, @Param('id') id: string, @Param('versionId') versionId: string) { return this.implantation.modelLinks(r.organization, id, versionId); }
  @Put(':id/models/:versionId/links') saveLinks(@Req() r: Request, @Param('id') id: string, @Param('versionId') versionId: string, @Body() body: ModelLinksDto) { return this.implantation.saveModelLinks(r.organization, id, versionId, body.links); }

  @Get(':id/assets/:assetId/file')
  async file(@Req() r: Request, @Param('id') id: string, @Param('assetId') assetId: string, @Res() response: StreamResponse, @Headers('if-none-match') etag?: string) {
    const file = await this.implantation.assetFile(r.organization, id, assetId);
    const info = await stat(file.path);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Length', String(info.size));
    response.setHeader('Cache-Control', 'private, max-age=3600');
    response.setHeader('ETag', `"${file.checksum}"`);
    if (etag === `"${file.checksum}"`) { response.status(304).end(); return; }
    createReadStream(file.path).pipe(response as unknown as NodeJS.WritableStream);
  }
}

// Rota pública do visualizador: lotes clicáveis e vínculos do GLB ativo (só empreendimentos publicados).
@ApiTags('public')
@Controller('public') @UseGuards(ThrottlerGuard)
export class PublicRegionsController {
  constructor(private readonly implantation: ImplantationService) {}
  @Get('developments/:slug/regions') regions(@Param('slug') slug: string) { return this.implantation.publicRegions(slug); }
}
