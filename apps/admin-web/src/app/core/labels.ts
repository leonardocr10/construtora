import { AssetKind, DevelopmentStatus, LeadStatus, UnitStatus } from './api.service';

export const developmentStatus: Record<DevelopmentStatus, { label: string; tag: string }> = {
  PUBLISHED: { label: 'Publicado', tag: '' }, PREPARING: { label: 'Em edição', tag: 'yellow' },
  DRAFT: { label: 'Rascunho', tag: 'gray' }, ARCHIVED: { label: 'Arquivado', tag: 'gray' },
};

export const unitStatus: Record<UnitStatus, { label: string; tag: string; cell: string }> = {
  AVAILABLE: { label: 'Disponível', tag: '', cell: 'green' }, RESERVED: { label: 'Reservado', tag: 'yellow', cell: 'orange' },
  SOLD: { label: 'Vendido', tag: 'red', cell: 'red' }, BLOCKED: { label: 'Bloqueado', tag: 'gray', cell: 'gray' },
  UNAVAILABLE: { label: 'Indisponível', tag: 'gray', cell: 'dark' },
};
export const unitStatuses = Object.keys(unitStatus) as UnitStatus[];

export const leadStatus: Record<LeadStatus, { label: string; tag: string }> = {
  NEW: { label: 'Novo', tag: 'blue' }, CONTACTED: { label: 'Em contato', tag: 'yellow' }, QUALIFIED: { label: 'Qualificado', tag: 'yellow' },
  NEGOTIATING: { label: 'Em negociação', tag: 'yellow' }, WON: { label: 'Convertido', tag: '' }, LOST: { label: 'Perdido', tag: 'gray' },
};
export const leadStatuses = Object.keys(leadStatus) as LeadStatus[];

export const assetKind: Record<AssetKind, string> = {
  EBOOK: 'E-book', IMPLANTATION: 'Implantação', FACADE: 'Fachada', FLOOR_PLAN: 'Planta', SALES_MIRROR: 'Espelho de vendas',
  AMENITY: 'Área comum', INTERIOR_RENDER: 'Perspectiva interna', AERIAL: 'Vista aérea', MODEL_3D: 'Modelo 3D', OTHER: 'Outro',
};
export const assetKinds = Object.keys(assetKind) as AssetKind[];

export function num(value: string | number | null | undefined) { return value === null || value === undefined || value === '' ? null : Number(value); }
export function area(value: string | number | null | undefined) { const n = num(value); return n === null ? '—' : `${n.toLocaleString('pt-BR')} m²`; }
export function bytes(value: string | number) {
  let n = Number(value); const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0; while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${units[i]}`;
}
export function date(value: string | null) { return value ? new Date(value).toLocaleDateString('pt-BR') : '—'; }
export function dateTime(value: string) { return new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
export function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join(''); }
export function slugify(value: string) { return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
/** Lê o valor de um evento de input/select sem depender de @angular/forms. */
export function val(event: Event) { return (event.target as HTMLInputElement).value; }
