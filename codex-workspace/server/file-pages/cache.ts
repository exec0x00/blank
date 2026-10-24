/** Small disposable position hints only. No file bodies, line arrays, or durable cache writes. */
interface FilePositions { totalLines: number | null; offsets: Map<number, number> }
export class FilePositionCache {
  private readonly files = new Map<string, FilePositions>();

  private positions(version: string): FilePositions {
    let value = this.files.get(version);
    if (value) this.files.delete(version);
    else value = { totalLines: null, offsets: new Map([[0, 1]]) };
    this.files.set(version, value);
    if (this.files.size > 64) this.files.delete(this.files.keys().next().value!);
    return value;
  }

  line(version: string, offset: number): number | null { return this.positions(version).offsets.get(offset) ?? null; }
  total(version: string): number | null { return this.positions(version).totalLines; }
  remember(version: string, offset: number, line: number | null, eof = false): void {
    if (line === null) return;
    const positions = this.positions(version);
    positions.offsets.delete(offset); positions.offsets.set(offset, line);
    if (eof) positions.totalLines = line;
    if (positions.offsets.size > 128) positions.offsets.delete(positions.offsets.keys().next().value!);
  }
}
