import { Injectable, computed, signal } from '@angular/core';

export interface DashboardSummary { developments: number; buildings: number; units: number; availableUnits: number; reservedUnits: number; soldUnits: number; views: number; leads: number; aiJobs: number; storageBytes: number; }
type LoadState = 'idle' | 'loading' | 'ready' | 'error';

@Injectable({ providedIn: 'root' })
export class DashboardStore {
  readonly summary = signal<DashboardSummary | null>(null);
  readonly state = signal<LoadState>('idle');
  readonly error = signal<string | null>(null);
  readonly isEmpty = computed(() => this.state() === 'ready' && this.summary()?.developments === 0);

  async load(accessToken: string) {
    this.state.set('loading'); this.error.set(null);
    try {
      const response = await fetch('http://localhost:3000/api/v1/dashboard/summary', { headers: { authorization: `Bearer ${accessToken}` } });
      if (!response.ok) throw new Error('Não foi possível carregar os indicadores.');
      this.summary.set(await response.json() as DashboardSummary); this.state.set('ready');
    } catch (error) { this.state.set('error'); this.error.set(error instanceof Error ? error.message : 'Erro inesperado.'); }
  }
}
