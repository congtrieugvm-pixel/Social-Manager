export class Operation {
  private cancelled = false;
  private closer?: () => Promise<void>;
  constructor(private valid: () => boolean) {}
  check() { if (this.cancelled || !this.valid()) throw new Error('INTERRUPTED'); }
  async own(close: () => Promise<void>) {
    this.closer = close;
    if (this.cancelled || !this.valid()) { await close(); throw new Error('INTERRUPTED'); }
  }
  async cancel() {
    this.cancelled = true;
    if (this.closer) await this.closer();
  }
}
