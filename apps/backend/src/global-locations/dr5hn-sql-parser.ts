/**
 * Minimal parser for the specific MySQL-dialect `INSERT INTO \`table\` VALUES (...),(...);`
 * statements dr5hn's SQL export produces. Not a general SQL parser -- it only needs to handle
 * this one shape: single-quoted strings with `\'`/`\\` escapes, and JSON blobs (the
 * `translations` column) which use `{}`/`[]`, never bare `()`, so top-level parenthesis
 * tracking is safe. Verified against the real v3.2-export.7 dump during the Phase 2
 * investigation (152,970 city rows, 5,308 state rows, 250 country rows all parsed cleanly).
 */

export function parseValuesBlock(sql: string): string[][] {
  const rows: string[][] = [];
  let i = 0;
  const n = sql.length;
  while (i < n) {
    while (i < n && sql[i] !== '(') i++;
    if (i >= n) break;
    i++; // skip '('
    const fields: string[] = [];
    let cur = '';
    let inStr = false;
    while (i < n) {
      const ch = sql[i];
      if (inStr) {
        if (ch === '\\') {
          cur += ch + sql[i + 1];
          i += 2;
          continue;
        }
        if (ch === "'") {
          inStr = false;
          cur += ch;
          i++;
          continue;
        }
        cur += ch;
        i++;
        continue;
      }
      if (ch === "'") {
        inStr = true;
        cur += ch;
        i++;
        continue;
      }
      if (ch === ',') {
        fields.push(cur);
        cur = '';
        i++;
        continue;
      }
      if (ch === ')') {
        fields.push(cur);
        i++;
        break;
      }
      cur += ch;
      i++;
    }
    rows.push(fields.map((f) => f.trim()));
  }
  return rows;
}

export function unquoteSqlValue(v: string): string | null {
  if (v === 'NULL') return null;
  if (v.startsWith("'") && v.endsWith("'")) {
    return v
      .slice(1, -1)
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, '\\')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '');
  }
  return v;
}

/**
 * Parses every `INSERT INTO \`tableName\` VALUES ...;` statement found in `raw` into an array
 * of column-keyed records. `columns` must list the table's columns in the exact order the
 * source dump writes them (see the dr5hn schema.sql CREATE TABLE definitions).
 */
export function parseInsertStatements<T extends Record<string, string | null>>(
  raw: string,
  tableName: string,
  columns: (keyof T & string)[],
): T[] {
  const blocks = raw
    .split(new RegExp('INSERT INTO `' + tableName + '` VALUES '))
    .slice(1);
  const out: T[] = [];
  for (const block of blocks) {
    const stmtEnd = block.indexOf(';\n');
    const rows = parseValuesBlock(
      stmtEnd >= 0 ? block.slice(0, stmtEnd) : block,
    );
    for (const r of rows) {
      if (r.length !== columns.length) continue;
      const rec = {} as T;
      columns.forEach((c, idx) => {
        (rec as Record<string, string | null>)[c] = unquoteSqlValue(r[idx]);
      });
      out.push(rec);
    }
  }
  return out;
}
