import { parseInsertStatements } from './dr5hn-sql-parser';

describe('parseInsertStatements', () => {
  const COLS = ['id', 'name', 'note'] as const;

  it('parses multiple tuples from one INSERT statement', () => {
    const sql = "INSERT INTO `things` VALUES (1,'Alpha',NULL),(2,'Beta','has a note');\n";
    const rows = parseInsertStatements<Record<(typeof COLS)[number], string | null>>(
      sql,
      'things',
      [...COLS],
    );
    expect(rows).toEqual([
      { id: '1', name: 'Alpha', note: null },
      { id: '2', name: 'Beta', note: 'has a note' },
    ]);
  });

  it('handles escaped quotes inside a value without breaking field boundaries', () => {
    const sql = "INSERT INTO `things` VALUES (1,'O\\'Brien',NULL);\n";
    const rows = parseInsertStatements<Record<(typeof COLS)[number], string | null>>(
      sql,
      'things',
      [...COLS],
    );
    expect(rows).toEqual([{ id: '1', name: "O'Brien", note: null }]);
  });

  it('does not get confused by JSON-like content in a later column', () => {
    const sql = 'INSERT INTO `things` VALUES (1,\'Alpha\',\'{"hi": "value"}\');\n';
    const rows = parseInsertStatements<Record<(typeof COLS)[number], string | null>>(
      sql,
      'things',
      [...COLS],
    );
    expect(rows).toEqual([{ id: '1', name: 'Alpha', note: '{"hi": "value"}' }]);
  });

  it('returns an empty array for a table name that does not appear', () => {
    const sql = "INSERT INTO `other` VALUES (1,'Alpha',NULL);\n";
    const rows = parseInsertStatements<Record<(typeof COLS)[number], string | null>>(
      sql,
      'things',
      [...COLS],
    );
    expect(rows).toEqual([]);
  });
});
