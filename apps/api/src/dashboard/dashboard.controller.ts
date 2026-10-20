import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrganizationContext } from '../common/organization-context';

@ApiTags('dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}
  @Get('summary') @UseGuards(JwtAuthGuard)
  summary(@Req() request: { organization: OrganizationContext }) {
    return this.dashboard.summary(request.organization.organizationId);
  }
}
