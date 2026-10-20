import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Development } from '../core/api.service';
import { date, developmentStatus, initials } from '../core/labels';

@Component({
  selector: 'vh-development-card', imports: [RouterLink], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let d = development();
    <div class="card shadow project">
      <div class="thumb ph">{{ initials(d.name) }}</div>
      <div class="pad">
        <span class="tag {{ status[d.status].tag }}">{{ status[d.status].label }}</span>
        <h3 style="margin-top:12px">{{ d.name }}</h3>
        <p>📍 {{ location() }}</p>
        <div class="grid g3" style="gap:5px;text-align:center">
          <div><b>{{ d._count?.buildings ?? 0 }}</b><div class="small">Torres</div></div>
          <div><b>{{ d.code || '—' }}</b><div class="small">Código</div></div>
          <div><b>{{ date(d.deliveryDate) }}</b><div class="small">Entrega</div></div>
        </div>
        <footer>
          <a class="btn soft" [routerLink]="['/empreendimentos', d.id, 'espelho']">◉ Visualizar</a>
          <a class="btn" [routerLink]="['/empreendimentos', d.id, 'editar']">✎ Editar</a>
        </footer>
      </div>
    </div>`,
})
export class DevelopmentCardComponent {
  readonly development = input.required<Development>();
  readonly status = developmentStatus;
  readonly initials = initials;
  readonly date = date;
  location() { const d = this.development(); return [d.city, d.state].filter(Boolean).join(' · ') || 'Localização não informada'; }
}
