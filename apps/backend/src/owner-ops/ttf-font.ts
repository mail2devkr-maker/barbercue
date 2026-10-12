/**
 * A deliberately small TrueType reader - just enough to embed a font in a PDF and measure text:
 * code point -> glyph id (cmap formats 4 and 12), advance widths (hmtx), em size (head) and
 * vertical metrics (hhea). It never writes fonts and accepts only well-formed sfnt TrueType files
 * (the single bundled Geist file); anything else throws.
 */
export class TtfFont {
  readonly unitsPerEm: number;
  readonly ascent: number;
  readonly descent: number;
  readonly numGlyphs: number;
  private readonly numberOfHMetrics: number;
  private readonly hmtxOffset: number;
  private readonly cmapSubtables: { format: number; offset: number }[] = [];

  constructor(readonly data: Buffer) {
    const tables = new Map<string, { offset: number; length: number }>();
    const numTables = data.readUInt16BE(4);
    for (let i = 0; i < numTables; i++) {
      const o = 12 + i * 16;
      tables.set(data.toString('latin1', o, o + 4), { offset: data.readUInt32BE(o + 8), length: data.readUInt32BE(o + 12) });
    }
    const need = (tag: string) => {
      const t = tables.get(tag);
      if (!t) throw new Error(`TrueType font is missing the "${tag}" table`);
      return t;
    };
    const head = need('head');
    this.unitsPerEm = data.readUInt16BE(head.offset + 18);
    const hhea = need('hhea');
    this.ascent = data.readInt16BE(hhea.offset + 4);
    this.descent = data.readInt16BE(hhea.offset + 6);
    this.numberOfHMetrics = data.readUInt16BE(hhea.offset + 34);
    this.numGlyphs = data.readUInt16BE(need('maxp').offset + 4);
    this.hmtxOffset = need('hmtx').offset;

    const cmap = need('cmap');
    const subCount = data.readUInt16BE(cmap.offset + 2);
    for (let i = 0; i < subCount; i++) {
      const rec = cmap.offset + 4 + i * 8;
      const platform = data.readUInt16BE(rec);
      const encoding = data.readUInt16BE(rec + 2);
      const offset = cmap.offset + data.readUInt32BE(rec + 4);
      const format = data.readUInt16BE(offset);
      const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
      if (unicode && (format === 4 || format === 12)) this.cmapSubtables.push({ format, offset });
    }
    if (this.cmapSubtables.length === 0) throw new Error('TrueType font has no Unicode cmap');
  }

  /** Glyph id for a code point, or 0 (.notdef) when the font has none. */
  glyphFor(codePoint: number): number {
    for (const sub of this.cmapSubtables) {
      const gid = sub.format === 4 ? this.lookup4(sub.offset, codePoint) : this.lookup12(sub.offset, codePoint);
      if (gid) return gid;
    }
    return 0;
  }

  /** Advance width of a glyph in font units. */
  advance(gid: number): number {
    const index = Math.min(gid, this.numberOfHMetrics - 1);
    return this.data.readUInt16BE(this.hmtxOffset + index * 4);
  }

  /** Text width in PDF points for a given font size. */
  measure(text: string, size: number): number {
    let units = 0;
    for (const ch of text) units += this.advance(this.glyphFor(ch.codePointAt(0)!));
    return (units * size) / this.unitsPerEm;
  }

  private lookup4(offset: number, cp: number): number {
    if (cp > 0xffff) return 0;
    const d = this.data;
    const segX2 = d.readUInt16BE(offset + 6);
    const endO = offset + 14;
    const startO = endO + segX2 + 2;
    const deltaO = startO + segX2;
    const rangeO = deltaO + segX2;
    for (let s = 0; s < segX2 / 2; s++) {
      const end = d.readUInt16BE(endO + s * 2);
      if (cp > end) continue;
      const start = d.readUInt16BE(startO + s * 2);
      if (cp < start) return 0;
      const rangeOffset = d.readUInt16BE(rangeO + s * 2);
      const delta = d.readInt16BE(deltaO + s * 2);
      if (rangeOffset === 0) return (cp + delta) & 0xffff;
      const glyphAt = rangeO + s * 2 + rangeOffset + (cp - start) * 2;
      const gid = d.readUInt16BE(glyphAt);
      return gid === 0 ? 0 : (gid + delta) & 0xffff;
    }
    return 0;
  }

  private lookup12(offset: number, cp: number): number {
    const d = this.data;
    const groups = d.readUInt32BE(offset + 12);
    for (let g = 0; g < groups; g++) {
      const o = offset + 16 + g * 12;
      const start = d.readUInt32BE(o);
      const end = d.readUInt32BE(o + 4);
      if (cp >= start && cp <= end) return d.readUInt32BE(o + 8) + (cp - start);
    }
    return 0;
  }
}
