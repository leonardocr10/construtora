import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OrganizationContext } from '../common/organization-context';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ headers: { authorization?: string }; organization?: OrganizationContext }>();
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) throw new UnauthorizedException('Token de acesso ausente');
    try {
      const data = await this.jwt.verifyAsync<{ sub: string; organizationId: string; role: string }>(token, { secret: process.env.JWT_ACCESS_SECRET });
      request.organization = { userId: data.sub, organizationId: data.organizationId, role: data.role };
      return true;
    } catch { throw new UnauthorizedException('Token de acesso inválido ou expirado'); }
  }
}
