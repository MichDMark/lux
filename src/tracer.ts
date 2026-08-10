export class Tracer {
  public constructor(private readonly enabled: boolean) {}

  public section(title: string): void {
    if (!this.enabled) return;
    console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
  }

  public log(label: string, message: string): void {
    if (!this.enabled) return;
    console.log(`\n[${label}] ${message}`);
  }

  public object(label: string, value: unknown): void {
    if (!this.enabled) return;
    this.log(label, "");
    console.dir(value, { depth: null });
  }
}
