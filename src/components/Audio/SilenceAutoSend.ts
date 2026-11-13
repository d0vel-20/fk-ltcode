// Use a real timer so the pause length does not depend on display refresh rate.
export class SilenceAutoSend {
  private timer: ReturnType<typeof setTimeout> | null = null
  private deadline: number | null = null

  constructor(
    private readonly send: () => void,
    private readonly delayMs = 3000,
    private readonly schedule: typeof setTimeout = setTimeout,
    private readonly cancel: typeof clearTimeout = clearTimeout,
    private readonly now: () => number = Date.now
  ) {}

  voiceDetected(): void {
    this.reset()
    this.deadline = this.now() + this.delayMs
    this.timer = this.schedule(() => {
      this.timer = null
      this.deadline = null
      this.send()
    }, this.delayMs)
  }

  get remainingSeconds(): number | null {
    return this.deadline === null ? null : Math.max(0, Math.ceil((this.deadline - this.now()) / 1000))
  }

  reset(): void {
    if (this.timer !== null) this.cancel(this.timer)
    this.timer = null
    this.deadline = null
  }
}
