import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiService, Development } from './api.service';

const SELECTED_KEY = 'vistahub.development-id';

/** Empreendimento ativo usado pelos módulos de estrutura, comercial e 3D. */
@Injectable({ providedIn: 'root' })
export class DevelopmentContext {
  private readonly api = inject(ApiService);
  readonly developments = signal<Development[]>([]);
  readonly selectedId = signal<string | null>(localStorage.getItem(SELECTED_KEY));
  readonly selected = computed(() => this.developments().find((d) => d.id === this.selectedId()) ?? null);

  async refresh() {
    const list = await this.api.get<Development[]>('/developments');
    this.developments.set(list);
    if (!list.some((d) => d.id === this.selectedId())) this.select(list[0]?.id ?? null);
    return list;
  }

  select(id: string | null) {
    this.selectedId.set(id);
    if (id) localStorage.setItem(SELECTED_KEY, id); else localStorage.removeItem(SELECTED_KEY);
  }
}
