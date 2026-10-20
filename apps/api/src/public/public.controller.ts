import { Body, Controller, Get, Headers, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrganizationContext } from '../common/organization-context';
import { assertCanEdit } from '../common/roles';
import { PublicService } from './public.service';

class PublicLeadDto {
  @IsString() @MaxLength(160) name!: string;
  @IsString() @MaxLength(40) phone!: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(2000) message?: string;
  @IsOptional() @IsString() unitId?: string;
  @IsBoolean() consent!: boolean;
}
interface StreamResponse { setHeader(name: string, value: string): void; status(code: number): StreamResponse; end(): void }

// Rotas sem autenticação usadas pelo visualizador 3D público. Só expõem empreendimentos PUBLICADOS.
@ApiTags('public')
@Controller('public') @UseGuards(ThrottlerGuard)
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Get('developments/:slug')
  development(@Param('slug') slug: string, @Headers('x-forwarded-for') forwarded?: string, @Headers('user-agent') agent?: string) {
    const sessionHash = createHash('sha256').update(`${forwarded ?? ''}|${agent ?? ''}|${new Date().toISOString().slice(0, 10)}`).digest('hex').slice(0, 32);
    return this.publicService.development(slug, sessionHash);
  }

  @Get('share/:slug')
  async share(@Param('slug') slug: string, @Res() response: StreamResponse & { send(body: string): void }) {
    const html = await this.publicService.sharePage(slug);
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'public, max-age=300');
    response.send(html);
  }

  @Get('developments/:slug/surroundings')
  surroundings(@Param('slug') slug: string) { return this.publicService.surroundings(slug); }

  @Post('developments/:slug/leads') @Throttle({ default: { limit: 5, ttl: 60_000 } })
  lead(@Param('slug') slug: string, @Body() body: PublicLeadDto) { return this.publicService.createLead(slug, body); }

  @Get('assets/:id')
  async asset(@Param('id') id: string, @Res() response: StreamResponse, @Headers('if-none-match') etag?: string) {
    const file = await this.publicService.asset(id);
    const info = await stat(file.path);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Length', String(info.size));
    response.setHeader('Cache-Control', 'public, max-age=86400');
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    response.setHeader('ETag', `"${file.checksum}"`);
    if (etag === `"${file.checksum}"`) { response.status(304).end(); return; }
    createReadStream(file.path).pipe(response as unknown as NodeJS.WritableStream);
  }
}

@ApiTags('developments')
@Controller('developments') @UseGuards(JwtAuthGuard)
export class SurroundingsAdminController {
  constructor(private readonly publicService: PublicService) {}
  @Post(':id/surroundings/refresh')
  refresh(@Req() request: { organization: OrganizationContext }, @Param('id') id: string) {
    assertCanEdit(request.organization);
    return this.publicService.refreshSurroundings(request.organization.organizationId, id);
  }
}
