import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
@Component({ imports: [RouterLink], changeDetection: ChangeDetectionStrategy.OnPush, template: `<section class="content"><h1>{{ label() }}</h1><div class="notice"><b>Módulo preparado para a próxima fase.</b><span>Esta rota já existe no painel, mas o fluxo funcional ainda será entregue conforme o registro de implementação.</span><a routerLink="/" class="button">Voltar ao painel</a></div></section>` })
export class PlaceholderPageComponent { feature = input(''); label = () => ({ empreendimentos: 'Empreendimentos', usuarios: 'Usuários e permissões', organizacao: 'Organização', plano: 'Plano e uso' }[this.feature()] ?? 'Módulo'); }
