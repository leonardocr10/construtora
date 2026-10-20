import { ForbiddenException } from '@nestjs/common';
import { OrganizationRole } from '@prisma/client';
import { OrganizationContext } from './organization-context';

const editorRoles = new Set<OrganizationRole>([OrganizationRole.SUPERADMIN, OrganizationRole.ADMIN, OrganizationRole.MANAGER, OrganizationRole.EDITOR]);
const commercialRoles = new Set<OrganizationRole>([...editorRoles, OrganizationRole.BROKER]);

export function assertCanEdit(context: OrganizationContext) {
  if (!editorRoles.has(context.role as OrganizationRole)) throw new ForbiddenException('Seu perfil não pode alterar empreendimentos');
}
export function assertCommercial(context: OrganizationContext) {
  if (!commercialRoles.has(context.role as OrganizationRole)) throw new ForbiddenException('Seu perfil não pode alterar dados comerciais');
}
