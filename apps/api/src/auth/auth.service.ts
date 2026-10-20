import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService) {}

  async login(email: string, password: string, organizationId: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.active || !(await argon2.verify(user.passwordHash, password))) throw new UnauthorizedException('Credenciais inválidas');
    const membership = await this.prisma.organizationUser.findUnique({ where: { organizationId_userId: { organizationId, userId: user.id } } });
    if (!membership || !membership.active) throw new UnauthorizedException('Acesso à organização não autorizado');
    const payload = { sub: user.id, organizationId, role: membership.role };
    return {
      accessToken: await this.jwt.signAsync(payload, { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '15m' }),
      refreshToken: await this.jwt.signAsync(payload, { secret: process.env.JWT_REFRESH_SECRET, expiresIn: '7d' }),
      user: { id: user.id, name: user.name, email: user.email, role: membership.role },
    };
  }
}
