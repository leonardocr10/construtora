import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../common/prisma.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}
  @Get('db') async database() {
    try { return await this.prisma.ping(); }
    catch { throw new ServiceUnavailableException('MySQL indisponível'); }
  }
}
