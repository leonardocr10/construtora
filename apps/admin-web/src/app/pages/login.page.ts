import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService, errorMessage } from '../core/api.service';
import { val } from '../core/labels';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="login"><form class="card shadow" (submit)="submit($event)"><div class="pad">
      <div class="brand" style="color:var(--txt);padding:0 0 20px"><span class="brand-icon">◆</span><span>VistaHub<small style="color:var(--muted)">PLATAFORMA IMOBILIÁRIA</small></span></div>
      <h3>Entrar no painel</h3>
      @if (error()) { <div class="notice error">{{ error() }}</div> }
      <div class="field"><label>E-mail</label><input class="input" type="email" autocomplete="username" required [value]="email()" (input)="email.set(v($event))"></div>
      <div class="field"><label>Senha</label><input class="input" type="password" autocomplete="current-password" required minlength="8" [value]="password()" (input)="password.set(v($event))"></div>
      <div class="field"><label>ID da organização</label><input class="input" required [value]="organizationId()" (input)="organizationId.set(v($event))"><p class="small">Informado ao provisionar o administrador (npm run provision:admin).</p></div>
      <button class="btn blue" type="submit" [disabled]="busy()">{{ busy() ? 'Entrando…' : 'Entrar' }}</button>
    </div></form></div>`,
})
export class LoginPage {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  readonly v = val;
  readonly email = signal('');
  readonly password = signal('');
  readonly organizationId = signal(this.api.lastOrganizationId);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  async submit(event: Event) {
    event.preventDefault();
    this.busy.set(true); this.error.set(null);
    try { await this.api.login(this.email().trim(), this.password(), this.organizationId().trim()); await this.router.navigateByUrl('/'); }
    catch (error) { this.error.set(errorMessage(error)); }
    finally { this.busy.set(false); }
  }
}
