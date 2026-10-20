import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsIn, IsLatitude, IsLongitude, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { FileInterceptor } from '@nestjs/platform-express';
import { AssetKind } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { OrganizationContext } from '../common/organization-context';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateDevelopmentInput, DevelopmentsService } from './developments.service';

class DevelopmentDto implements CreateDevelopmentInput {
  @IsString() @MaxLength(160) name!: string;
  @IsString() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) slug!: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() zipCode?: string;
  @IsOptional() @IsLatitude() latitude?: number;
  @IsOptional() @IsLongitude() longitude?: number;
  @IsOptional() @IsDateString() deliveryDate?: string;
  @IsOptional() @IsIn(['DRAFT', 'PREPARING', 'PUBLISHED', 'ARCHIVED']) status?: 'DRAFT' | 'PREPARING' | 'PUBLISHED' | 'ARCHIVED';
}
class AssetUploadDto {
  @IsIn(['EBOOK', 'IMPLANTATION', 'FACADE', 'FLOOR_PLAN', 'SALES_MIRROR', 'AMENITY', 'INTERIOR_RENDER', 'AERIAL', 'MODEL_3D', 'OTHER']) kind!: AssetKind;
  @IsOptional() @IsString() buildingId?: string;
  @IsOptional() @IsString() floorId?: string;
  @IsOptional() @IsString() unitId?: string;
  @IsOptional() @IsString() floorPlanId?: string;
  @IsOptional() @IsString() @MaxLength(120) label?: string;
}
interface UploadedAsset { originalname: string; mimetype: string; size: number; buffer: Buffer; }
function verifiedMime(file: UploadedAsset): string | null {
  const b = file.buffer;
  if (b.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (b.subarray(0, 4).toString('ascii') === 'glTF') return 'model/gltf-binary';
  return null;
}

@ApiTags('developments') @ApiBearerAuth()
@Controller('developments') @UseGuards(JwtAuthGuard)
export class DevelopmentsController {
  constructor(private readonly developments: DevelopmentsService) {}
  @Get() list(@Req() request: { organization: OrganizationContext }) { return this.developments.list(request.organization); }
  @Get(':id') get(@Req() request: { organization: OrganizationContext }, @Param('id') id: string) { return this.developments.get(request.organization, id); }
  @Post() create(@Req() request: { organization: OrganizationContext }, @Body() body: DevelopmentDto) { return this.developments.create(request.organization, body); }
  @Patch(':id') update(@Req() request: { organization: OrganizationContext }, @Param('id') id: string, @Body() body: Partial<DevelopmentDto>) { return this.developments.update(request.organization, id, body); }
  @Get(':id/assets') assets(@Req() request: { organization: OrganizationContext }, @Param('id') id: string) { return this.developments.listAssets(request.organization, id); }
  @Post(':id/assets') @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 200 * 1024 * 1024 } }))
  async uploadAsset(@Req() request: { organization: OrganizationContext }, @Param('id') id: string, @Body() body: AssetUploadDto, @UploadedFile() file?: UploadedAsset) {
    if (!file) throw new BadRequestException('Arquivo obrigatório');
    const mimeType = verifiedMime(file);
    if (!mimeType) throw new BadRequestException('Conteúdo do arquivo não é PDF, imagem suportada ou GLB válido');
    const storageKey = `${id}/${randomUUID()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const root = process.env.LOCAL_STORAGE_PATH ?? join(process.cwd(), 'storage');
    const target = join(root, storageKey);
    await mkdir(join(root, id), { recursive: true });
    await writeFile(target, file.buffer, { flag: 'wx' });
    try { return await this.developments.addAsset(request.organization, id, { kind: body.kind, originalName: file.originalname, storageKey, mimeType, byteSize: BigInt(file.size), checksum: createHash('sha256').update(file.buffer).digest('hex'), metadata: { uploadedMimeType: file.mimetype, storage: 'local-private' } }, { buildingId: body.buildingId, floorId: body.floorId, unitId: body.unitId, floorPlanId: body.floorPlanId, label: body.label }); }
    catch (error) { await unlink(target).catch(() => undefined); throw error; }
  }
}
