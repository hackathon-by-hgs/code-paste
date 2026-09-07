import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { splitSqlStatements } from './database.service';

describe('splitSqlStatements', () => {
  it('splits ordinary statements', () => {
    expect(splitSqlStatements('CREATE TABLE a (id int); CREATE TABLE b (id int);')).toEqual([
      'CREATE TABLE a (id int)',
      'CREATE TABLE b (id int)',
    ]);
  });

  it('ignores trailing whitespace and a missing final semicolon', () => {
    expect(splitSqlStatements('SELECT 1;\n\n  SELECT 2  ')).toEqual(['SELECT 1', 'SELECT 2']);
  });

  it('does not split on a semicolon inside a single-quoted string', () => {
    // A CHECK constraint containing punctuation must survive intact, or the migration silently
    // becomes two invalid statements.
    const sql = "CREATE TABLE t (s text CHECK (s IN ('a;b', 'c')));";
    expect(splitSqlStatements(sql)).toEqual(["CREATE TABLE t (s text CHECK (s IN ('a;b', 'c')))"]);
  });

  it('handles an escaped quote inside a string', () => {
    const sql = "INSERT INTO t VALUES ('it''s; fine'); SELECT 1;";
    expect(splitSqlStatements(sql)).toEqual(["INSERT INTO t VALUES ('it''s; fine')", 'SELECT 1']);
  });

  it('does not split inside a dollar-quoted body', () => {
    const sql = 'CREATE FUNCTION f() RETURNS int AS $$ BEGIN; RETURN 1; END; $$ LANGUAGE plpgsql; SELECT 1;';
    const out = splitSqlStatements(sql);
    expect(out).toHaveLength(2);
    expect(out[0]).toContain('BEGIN; RETURN 1; END;');
    expect(out[1]).toBe('SELECT 1');
  });

  it('does not split on a semicolon inside a line comment', () => {
    const sql = 'SELECT 1; -- a comment; with a semicolon\nSELECT 2;';
    expect(splitSqlStatements(sql)).toEqual(['SELECT 1', '-- a comment; with a semicolon\nSELECT 2']);
  });

  it('returns nothing for an empty or comment-only file', () => {
    expect(splitSqlStatements('')).toEqual([]);
    expect(splitSqlStatements('   \n\n  ')).toEqual([]);
  });

  it('splits the real initial migration into individual statements', () => {
    // Guards the actual file: every statement must be separable, because both drivers send these
    // over the extended query protocol, which permits one command per prepared statement.
    const sql = readFileSync(join(__dirname, 'migrations', '0001_init.sql'), 'utf8');

    const statements = splitSqlStatements(sql);
    expect(statements.length).toBeGreaterThan(10);
    for (const statement of statements) {
      expect(statement).not.toContain(';');
    }
  });
});
