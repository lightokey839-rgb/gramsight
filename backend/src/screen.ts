// One card at a time across both flows. What is on screen decides where input goes.
// Priority: an in-progress Flow A step (confirm / sending / sent / error) > Flow B (payment, verdict)
//           > Flow A address requests > idle home card.
import type { CardView, FlowAController } from './flowA/controller.ts'
import type { FlowBController } from './flowB/controller.ts'

export interface ScreenLike {
  view(): CardView
  command(text: string): Promise<CardView>
  tap(cardId: string): Promise<CardView>
  cancel(): CardView
  next(): CardView
}

const A_BUSY = new Set<CardView['kind']>(['confirm', 'sending', 'sent', 'error'])

export class Screen implements ScreenLike {
  constructor(
    readonly a: FlowAController,
    readonly b?: FlowBController,
  ) {}

  private owner(): 'a' | 'b' {
    const va = this.a.view()
    if (A_BUSY.has(va.kind)) return 'a'
    return this.b?.view() ? 'b' : 'a'
  }

  view(): CardView {
    return this.owner() === 'b' ? this.b!.view()! : this.a.view()
  }

  async command(text: string): Promise<CardView> {
    if (this.owner() === 'b') await this.b!.command(text)
    else await this.a.command(text)
    return this.view()
  }

  async tap(cardId: string): Promise<CardView> {
    if (this.owner() === 'b') await this.b!.tap(cardId)
    else await this.a.tap(cardId)
    return this.view()
  }

  cancel(): CardView {
    if (this.owner() === 'b') this.b!.cancel()
    else this.a.cancel()
    return this.view()
  }

  next(): CardView {
    if (this.owner() === 'b') this.b!.next()
    else this.a.next()
    return this.view()
  }
}
