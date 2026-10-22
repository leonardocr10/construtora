import type { Development, Surroundings } from './types';

const base = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api/v1';

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${base}${path}`);
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(body?.message ?? `Erro ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  development: (slug: string) => get<Development>(`/public/developments/${encodeURIComponent(slug)}`),
  surroundings: (slug: string) => get<Surroundings>(`/public/developments/${encodeURIComponent(slug)}/surroundings`),
  assetUrl: (id: string) => `${base}/public/assets/${id}`,
  modelUrl: (id: string) => `${base}/public/assets/${id}?optimized=1`,
  async lead(slug: string, body: { name: string; phone: string; email?: string; message?: string; unitId?: string; consent: boolean }) {
    const response = await fetch(`${base}/public/developments/${encodeURIComponent(slug)}/leads`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) {
      const data = await response.json().catch(() => null) as { message?: string | string[] } | null;
      throw new Error(Array.isArray(data?.message) ? data.message.join(', ') : data?.message ?? 'Não foi possível enviar');
    }
  },
};
