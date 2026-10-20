import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

export const API_URL = 'http://localhost:3000/api/v1';

export type DevelopmentStatus = 'DRAFT' | 'PREPARING' | 'PUBLISHED' | 'ARCHIVED';
export type UnitStatus = 'AVAILABLE' | 'RESERVED' | 'SOLD' | 'BLOCKED' | 'UNAVAILABLE';
export type LeadStatus = 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'NEGOTIATING' | 'WON' | 'LOST';
export type AssetKind = 'EBOOK' | 'IMPLANTATION' | 'FACADE' | 'FLOOR_PLAN' | 'SALES_MIRROR' | 'AMENITY' | 'INTERIOR_RENDER' | 'AERIAL' | 'MODEL_3D' | 'OTHER';

export interface SessionUser { id: string; name: string; email: string; role: string; }
export interface DashboardSummary { developments: number; buildings: number; units: number; availableUnits: number; reservedUnits: number; soldUnits: number; views: number; leads: number; aiJobs: number; storageBytes: number | string; }
export interface Development {
  id: string; name: string; slug: string; code: string | null; description: string | null; city: string | null; state: string | null;
  address: string | null; zipCode: string | null; deliveryDate: string | null; status: DevelopmentStatus; updatedAt: string;
  _count?: { buildings: number; assets?: number };
}
export interface Floor { id: string; buildingId: string; name: string; number: number; sortOrder: number; }
export interface Building { id: string; developmentId: string; name: string; code: string; sortOrder: number; floors: Floor[]; _count: { units: number }; }
export interface FloorPlan { id: string; name: string; code: string | null; area: string | number | null; bedrooms: number | null; suites: number | null; bathrooms: number | null; parkingSpaces: number | null; description: string | null; assets: { id: string; kind: AssetKind; originalName: string }[]; _count: { units: number }; }
export interface Unit {
  id: string; buildingId: string; floorId: string | null; number: string; final: string | null; status: UnitStatus;
  privateArea: string | number | null; totalArea: string | number | null; price: string | number | null;
  floor: Floor | null; unitType: { id: string; name: string } | null;
  floorPlans: { floorPlanId: string; primary: boolean; floorPlan: FloorPlan }[];
}
export interface StatusHistory { id: string; previousStatus: UnitStatus | null; status: UnitStatus; reason: string | null; createdAt: string; changedBy: { id: string; name: string } | null; }
export interface Asset { id: string; kind: AssetKind; originalName: string; mimeType: string; byteSize: string; createdAt: string; buildingId: string | null; floorId: string | null; unitId: string | null; floorPlanId: string | null; }
export interface ModelVersion { id: string; version: number; label: string | null; status: string; createdAt: string; active: boolean; asset: { id: string; originalName: string; byteSize: string; checksum: string }; }
export interface Lead { id: string; developmentId: string; name: string; phone: string; email: string | null; message: string | null; source: string | null; status: LeadStatus; notes: string | null; createdAt: string; unit: { id: string; number: string } | null; assignedTo: { id: string; name: string } | null; }

export class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }

const TOKEN_KEY = 'vistahub.access-token';
const USER_KEY = 'vistahub.user';
const ORG_KEY = 'vistahub.organization-id';

/** Cliente HTTP do painel: autenticação por bearer token e acesso aos recursos da API NestJS. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly router = inject(Router);
  readonly token = signal<string | null>(sessionStorage.getItem(TOKEN_KEY));
  readonly user = signal<SessionUser | null>(JSON.parse(sessionStorage.getItem(USER_KEY) ?? 'null'));
  readonly authenticated = computed(() => !!this.token());
  get lastOrganizationId() { return localStorage.getItem(ORG_KEY) ?? ''; }

  async login(email: string, password: string, organizationId: string) {
    const result = await this.request<{ accessToken: string; user: SessionUser }>('POST', '/auth/login', { email, password, organizationId }, false);
    sessionStorage.setItem(TOKEN_KEY, result.accessToken);
    sessionStorage.setItem(USER_KEY, JSON.stringify(result.user));
    localStorage.setItem(ORG_KEY, organizationId);
    this.token.set(result.accessToken); this.user.set(result.user);
  }

  logout() {
    sessionStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(USER_KEY);
    this.token.set(null); this.user.set(null);
    void this.router.navigateByUrl('/login');
  }

  get<T>(path: string) { return this.request<T>('GET', path); }
  post<T>(path: string, body: unknown) { return this.request<T>('POST', path, body); }
  patch<T>(path: string, body: unknown) { return this.request<T>('PATCH', path, body); }
  put<T>(path: string, body: unknown) { return this.request<T>('PUT', path, body); }
  upload<T>(path: string, form: FormData) { return this.request<T>('POST', path, form); }

  private async request<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
    const headers: Record<string, string> = {};
    if (auth && this.token()) headers['authorization'] = `Bearer ${this.token()}`;
    if (body !== undefined && !(body instanceof FormData)) headers['content-type'] = 'application/json';
    let response: Response;
    try {
      response = await fetch(API_URL + path, { method, headers, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) });
    } catch { throw new ApiError('Não foi possível conectar à API. Verifique se o servidor está em execução.', 0); }
    if (response.status === 401 && auth) { this.logout(); throw new ApiError('Sessão expirada. Entre novamente.', 401); }
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const message = Array.isArray(data?.message) ? data.message.join('; ') : data?.message ?? `Erro ${response.status}`;
      throw new ApiError(message, response.status);
    }
    return data as T;
  }
}

export function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Erro inesperado.'; }
