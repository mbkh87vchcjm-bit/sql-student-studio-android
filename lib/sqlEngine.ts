export type SqlValue = string | number | boolean | null;

export interface IdentityModel {
  seed: number;
  increment: number;
  nextValue: number;
}

export interface ColumnModel {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  unique: boolean;
  defaultValue?: SqlValue;
  /** Optional name for a SQL Server DEFAULT constraint. */
  defaultConstraintName?: string;
  /** Optional IDENTITY metadata, persisted with this table. */
  identity?: IdentityModel;
}

export type StoredRow = Record<string, SqlValue>;

export interface ForeignKeyModel {
  name: string;
  column: string;
  referencedTable: string;
  referencedColumn: string;
}

export interface CheckConstraintModel {
  name: string;
  expression: string;
}

export interface IndexModel {
  name: string;
  columns: string[];
  unique: boolean;
}

export interface TableModel {
  name: string;
  /** Optional schema name; legacy objects without it belong to dbo. */
  schema?: string;
  columns: ColumnModel[];
  rows: StoredRow[];
  /** Optional for backward compatibility with previously saved workspaces. */
  primaryKeyColumns?: string[];
  /** Table-level UNIQUE constraints; each item contains the constrained columns. */
  uniqueConstraints?: string[][];
  /** Optional so databases saved by older app versions remain readable. */
  foreignKeys?: ForeignKeyModel[];
  /** Optional SQL CHECK constraints stored as expressions. */
  checkConstraints?: CheckConstraintModel[];
  /** Index definitions for teaching schema/index administration. */
  indexes?: IndexModel[];
}

export interface ViewModel {
  name: string;
  /** Optional schema name; legacy views without it belong to dbo. */
  schema?: string;
  /** The SELECT definition is re-evaluated whenever the view is queried. */
  definition: string;
  /** Cached output column names for INFORMATION_SCHEMA metadata. */
  columns?: string[];
}

export interface SchemaModel {
  name: string;
  /** Schema ownership is intentionally not modeled in this educational engine. */
}

export interface DatabaseModel {
  name: string;
  tables: Record<string, TableModel>;
  /** Additional empty schemas; dbo exists implicitly for backward compatibility. */
  schemas?: Record<string, SchemaModel>;
  /** Optional for backward compatibility with saved databases from older versions. */
  views?: Record<string, ViewModel>;
}

export interface EngineState {
  databases: Record<string, DatabaseModel>;
  currentDatabase: string | null;
  /** The one table currently enabled for explicit identity values. */
  identityInsertTable?: string | null;
}

export interface ExecutionResult {
  columns: string[];
  rows: string[][];
  affectedRows: number;
  messages: string[];
  errors: string[];
  durationMs: number;
  database: string | null;
}

export const EMPTY_STATE: EngineState = {
  databases: {},
  currentDatabase: null,
};

export const STARTER_SCRIPT = `CREATE DATABASE University;
GO
USE University;
GO
CREATE TABLE Students (
  Id INT PRIMARY KEY,
  Name NVARCHAR(100) NOT NULL,
  Age INT,
  Grade INT,
  DepartmentID INT
);
GO
INSERT INTO Students (Id, Name, Age, Grade, DepartmentID) VALUES
  (1, 'Ali', 20, 85, 1),
  (2, 'Ahmed', 21, 92, 1),
  (3, 'Sara', 19, 58, 2);
GO
SELECT Name, UPPER(Name) AS UpperName, Grade FROM Students WHERE Age >= 20 ORDER BY Name;`;

export function cleanName(value: string): string {
  return value.trim().replace(/^\[|\]$/g, '').replace(/^"|"$/g, '');
}

export function keyOf(value: string): string {
  return cleanName(value).toLowerCase();
}

export function cloneState(state: EngineState): EngineState {
  return JSON.parse(JSON.stringify(state)) as EngineState;
}

function valueToText(value: SqlValue): string {
  if (value === null) return 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}

function parseValue(raw: string): SqlValue {
  const value = raw.trim();
  if (/^null$/i.test(value)) return null;
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === 'true';
  if (/^N?'.*'$/s.test(value) || /^".*"$/s.test(value)) {
    const quoteStart = value[0] === 'N' ? 1 : 0;
    return value.slice(quoteStart + 1, -1).replace(/''/g, "'");
  }
  if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return Number.parseFloat(value);
  return cleanName(value);
}

function databaseFor(state: EngineState): DatabaseModel | null {
  return state.currentDatabase ? state.databases[keyOf(state.currentDatabase)] ?? null : null;
}

function tableFor(database: DatabaseModel, name: string): TableModel | null {
  return database.tables[keyOf(name)] ?? null;
}

/** Synchronous query execution makes this transient guard safe across nested SELECT calls. */
const activeViewResolutions = new Set<string>();

/* ==========================================================================
   TOKENIZER & PARSER HELPERS
   ========================================================================== */

export function splitTopLevelTuples(value: string): string[] {
  const tuples: string[] = [];
  let start = -1;
  let depth = 0;
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (quote) {
      if (char === quote && value[i + 1] === quote) i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
    } else if (char === '(') {
      if (depth === 0) start = i + 1;
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        tuples.push(value.slice(start, i));
        start = -1;
      }
    }
  }
  return tuples;
}

export function splitTopLevel(value: string, separator = ','): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (quote) {
      if (char === quote && value[i + 1] === quote) i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
    } else if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
    } else if (char === separator && depth === 0) {
      parts.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = value.slice(start).trim();
  if (last) parts.push(last);
  return parts;
}

export function splitStatements(value: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let quote: "'" | '"' | null = null;
  let lineComment = false;
  let blockComment = false;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    const next = value[i + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (char === quote && next === quote) i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    else if (char === '-' && next === '-') {
      lineComment = true;
      i += 1;
    } else if (char === '/' && next === '*') {
      blockComment = true;
      i += 1;
    } else if (char === ';') {
      if (value.slice(start, i).trim()) statements.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = value.slice(start).trim();
  if (last) statements.push(last);
  return statements;
}

export function splitBatches(sql: string): string[] {
  const lines = sql.replace(/\r\n/g, '\n').split('\n');
  const batches: string[] = [];
  let current: string[] = [];
  let quote: "'" | '"' | null = null;
  let blockComment = false;

  for (const line of lines) {
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      const next = line[i + 1];
      if (blockComment) {
        if (char === '*' && next === '/') {
          blockComment = false;
          i += 1;
        }
        continue;
      }
      if (quote) {
        if (char === quote && next === quote) i += 1;
        else if (char === quote) quote = null;
        continue;
      }
      if (char === "'" || char === '"') quote = char;
      else if (char === '/' && next === '*') {
        blockComment = true;
        i += 1;
      }
    }

    const goMatch = line.match(/^\s*GO(?:\s+(\d+))?\s*$/i);
    if (!quote && !blockComment && goMatch) {
      const count = goMatch[1] ? Math.max(1, parseInt(goMatch[1], 10)) : 1;
      const batchContent = current.join('\n').trim();
      if (batchContent) {
        for (let k = 0; k < count; k += 1) {
          batches.push(batchContent);
        }
      }
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.join('\n').trim()) batches.push(current.join('\n'));
  return batches;
}

export function findKeywordOutside(value: string, keyword: string, startIndex = 0): number {
  const target = keyword.toUpperCase();
  let depth = 0;
  let quote: "'" | '"' | null = null;
  for (let i = startIndex; i <= value.length - target.length; i += 1) {
    const char = value[i];
    const next = value[i + 1];
    if (quote) {
      if (char === quote && next === quote) i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (depth === 0 && value.slice(i, i + target.length).toUpperCase() === target) {
      const before = i === 0 ? ' ' : value[i - 1];
      const after = value[i + target.length] ?? ' ';
      if (/\s|\(|\)/.test(before) && /\s|\(|\)/.test(after)) return i;
    }
  }
  return -1;
}

function findLogicalAndOutside(value: string): number {
  let depth = 0;
  let quote: "'" | '"' | null = null;
  let pendingBetween = 0;

  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    const next = value[i + 1];
    if (quote) {
      if (char === quote && next === quote) i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === '(') {
      depth += 1;
      continue;
    }
    if (char === ')') {
      depth -= 1;
      continue;
    }
    if (depth !== 0 || !/[A-Za-z_]/.test(char)) continue;

    const tokenMatch = value.slice(i).match(/^[A-Za-z_]+/);
    if (!tokenMatch) continue;
    const token = tokenMatch[0].toUpperCase();
    if (token === 'BETWEEN') {
      pendingBetween += 1;
    } else if (token === 'AND') {
      if (pendingBetween > 0) {
        pendingBetween -= 1;
      } else {
        return i;
      }
    }
    i += tokenMatch[0].length - 1;
  }

  return -1;
}

function findOperatorOutside(value: string, operators: string[]): { operator: string; index: number } | null {
  let depth = 0;
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    const next = value[i + 1];
    if (quote) {
      if (char === quote && next === quote) i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === '(') {
      depth += 1;
      continue;
    }
    if (char === ')') {
      depth -= 1;
      continue;
    }
    if (depth === 0) {
      for (const op of operators) {
        if (value.slice(i, i + op.length) === op) {
          return { operator: op, index: i };
        }
      }
    }
  }
  return null;
}

/* ==========================================================================
   DATE & NUMERIC UTILITIES
   ========================================================================== */

function parseSqlDate(val: SqlValue): Date | null {
  if (val === null || val === undefined) return null;
  const str = String(val).trim();
  const d = new Date(str.includes(' ') && !str.includes('T') ? str.replace(' ', 'T') : str);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDate(d: Date, includeTime = true): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  if (!includeTime) return `${yyyy}-${mm}-${dd}`;
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

/* ==========================================================================
   EXPRESSION EVALUATOR & BUILT-IN FUNCTIONS
   ========================================================================== */

function columnValueFromRow(row: StoredRow, colName: string, outerRow?: StoredRow): SqlValue {
  const targetKey = keyOf(colName);
  const rowKeys = Object.keys(row);

  if (/^-?\d+(\.\d+)?$/.test(colName) || /^(true|false|null)$/i.test(colName)) {
    return parseValue(colName);
  }

  // 1. Qualified colName, e.g. "s.Name" or "Students.Name"
  if (targetKey.includes('.')) {
    const exactMatch = rowKeys.find((k) => keyOf(k) === targetKey);
    if (exactMatch !== undefined) return row[exactMatch];

    const parts = targetKey.split('.');
    const fieldName = parts[parts.length - 1];
    const endingMatches = rowKeys.filter((k) => keyOf(k) === targetKey || keyOf(k).endsWith(`.${fieldName}`));
    if (endingMatches.length === 1) return row[endingMatches[0]];
    if (endingMatches.length > 1) {
      const aliasMatch = endingMatches.find((k) => keyOf(k).startsWith(`${parts[0]}.`));
      if (aliasMatch !== undefined) return row[aliasMatch];
    }
  } else {
    // 2. Unqualified column name, e.g. "Name"
    // Find all distinct source table IDs represented in row for this field
    const sourceTableIds = new Set<string>();
    const sourceKeys: string[] = [];

    for (const k of rowKeys) {
      if (keyOf(k) === targetKey) {
        sourceKeys.push(k);
      }
      if (k.includes('::')) {
        const [sourceId, field] = k.split('::');
        if (keyOf(field) === targetKey) {
          sourceTableIds.add(sourceId);
          sourceKeys.push(k);
        }
      }
    }

    if (sourceTableIds.size > 1) {
      throw new Error(`Ambiguous column '${colName}'. Use a table name or alias, for example s.${colName}.`);
    }

    if (sourceKeys.length > 0) {
      return row[sourceKeys[0]];
    }

    const exactMatch = rowKeys.find((k) => keyOf(k) === targetKey);
    if (exactMatch !== undefined) return row[exactMatch];
  }

  // 3. Fallback to outer row (for correlated subqueries)
  if (outerRow) {
    return columnValueFromRow(outerRow, colName);
  }

  throw new Error(`العمود "${colName}" غير موجود.`);
}

function compareValues(left: SqlValue, operator: string, right: SqlValue): boolean | null {
  // Three-Valued Logic: Comparisons with NULL return UNKNOWN (null)
  if (left === null || right === null) return null;

  const op = operator.trim().toUpperCase();
  if (op === '=' || op === '==') {
    if (typeof left === 'number' && typeof right === 'number') return left === right;
    return String(left).toLowerCase() === String(right).toLowerCase();
  }
  if (op === '<>' || op === '!=') {
    const eq = compareValues(left, '=', right);
    return eq === null ? null : !eq;
  }

  if (typeof left === 'number' && typeof right === 'number') {
    if (op === '>') return left > right;
    if (op === '<') return left < right;
    if (op === '>=') return left >= right;
    if (op === '<=') return left <= right;
  }
  const leftText = String(left).toLowerCase();
  const rightText = String(right).toLowerCase();
  if (op === '>') return leftText > rightText;
  if (op === '<') return leftText < rightText;
  if (op === '>=') return leftText >= rightText;
  if (op === '<=') return leftText <= rightText;
  return false;
}

export function evaluateExpression(
  exprText: string,
  row: StoredRow,
  outerRow?: StoredRow,
  engineState?: EngineState,
  groupRows?: StoredRow[]
): SqlValue {
  let expr = exprText.trim();
  if (!expr) return null;

  // Outer parenthetical unwrap ONLY IF it's not a scalar subquery (SELECT ...)
  while (expr.startsWith('(') && expr.endsWith(')')) {
    const inner = expr.slice(1, -1).trim();
    if (/^SELECT\b/i.test(inner)) {
      break; // Preserve (SELECT ...) for subquery evaluation
    }
    let depth = 0;
    let validUnwrap = true;
    for (let i = 0; i < expr.length; i += 1) {
      if (expr[i] === '(') depth += 1;
      else if (expr[i] === ')') depth -= 1;
      if (depth === 0 && i < expr.length - 1) {
        validUnwrap = false;
        break;
      }
    }
    if (validUnwrap) {
      expr = inner;
    } else {
      break;
    }
  }

  // 1. Scalar Subquery `(SELECT ...)`
  if (/^\(\s*SELECT\b/i.test(expr) && engineState) {
    const subSql = expr.slice(1, -1).trim();
    const subRes = executeSelectInternal(subSql, engineState, row);
    if (subRes.error) throw new Error(subRes.error);
    if (subRes.rows.length > 1 || (subRes.columns.length > 1 && subRes.rows.length > 0)) {
      throw new Error('Subquery returned more than one value where a single value was expected.');
    }
    if (subRes.rows.length === 0) return null;
    return parseValue(subRes.rows[0][0]);
  }

  // 2. Logical OR (SQL three-valued logic)
  const orIdx = findKeywordOutside(expr, 'OR');
  if (orIdx >= 0) {
    const left = evaluateExpression(expr.slice(0, orIdx), row, outerRow, engineState, groupRows);
    const right = evaluateExpression(expr.slice(orIdx + 2), row, outerRow, engineState, groupRows);
    const leftTruth = left === null ? null : Boolean(left);
    const rightTruth = right === null ? null : Boolean(right);
    if (leftTruth === true || rightTruth === true) return true;
    if (leftTruth === null || rightTruth === null) return null;
    return false;
  }

  // 3. Logical AND (SQL three-valued logic)
  const andIdx = findLogicalAndOutside(expr);
  if (andIdx >= 0) {
    const left = evaluateExpression(expr.slice(0, andIdx), row, outerRow, engineState, groupRows);
    const right = evaluateExpression(expr.slice(andIdx + 3), row, outerRow, engineState, groupRows);
    const leftTruth = left === null ? null : Boolean(left);
    const rightTruth = right === null ? null : Boolean(right);
    if (leftTruth === false || rightTruth === false) return false;
    if (leftTruth === null || rightTruth === null) return null;
    return true;
  }

  // 4. Logical NOT
  if (/^NOT\s+/i.test(expr)) {
    const res = evaluateExpression(expr.replace(/^NOT\s+/i, ''), row, outerRow, engineState, groupRows);
    return res === null ? null : !Boolean(res);
  }

  // 5. CASE WHEN THEN ... ELSE ... END
  if (/^CASE\b/i.test(expr) && /\bEND$/i.test(expr)) {
    return evaluateCaseExpression(expr, row, outerRow, engineState, groupRows);
  }

  // 6. IS NULL / IS NOT NULL outside parentheses
  const isNullMatch = expr.match(/^(.+?)\s+IS\s+(NOT\s+)?NULL$/i);
  if (isNullMatch && findOperatorOutside(expr, ['IS NULL', 'IS NOT NULL'])) {
    const val = evaluateExpression(isNullMatch[1], row, outerRow, engineState, groupRows);
    return isNullMatch[2] ? val !== null : val === null;
  }

  // 7. BETWEEN / NOT BETWEEN
  const betweenMatch = expr.match(/^(.+?)\s+(NOT\s+)?BETWEEN\s+(.+?)\s+AND\s+(.+)$/i);
  if (betweenMatch && findKeywordOutside(expr, 'BETWEEN') >= 0) {
    const val = evaluateExpression(betweenMatch[1], row, outerRow, engineState, groupRows);
    const low = evaluateExpression(betweenMatch[3], row, outerRow, engineState, groupRows);
    const high = evaluateExpression(betweenMatch[4], row, outerRow, engineState, groupRows);
    const ge = compareValues(val, '>=', low);
    const le = compareValues(val, '<=', high);
    if (ge === null || le === null) return null;
    const isBetween = ge && le;
    return betweenMatch[2] ? !isBetween : isBetween;
  }

  // 8. IN / NOT IN with Subquery or list outside parentheses
  const inMatch = expr.match(/^(.+?)\s+(NOT\s+)?IN\s*\(([\s\S]+)\)$/i);
  if (inMatch && findKeywordOutside(expr, 'IN') >= 0) {
    const val = evaluateExpression(inMatch[1], row, outerRow, engineState, groupRows);
    if (val === null) return null;

    const inBody = inMatch[3].trim();
    let candidates: SqlValue[] = [];
    if (/^SELECT\b/i.test(inBody) && engineState) {
      const subRes = executeSelectInternal(inBody, engineState, row);
      if (subRes.error) throw new Error(subRes.error);
      candidates = subRes.rows.map((r) => parseValue(r[0]));
    } else {
      candidates = splitTopLevel(inBody).map((item) => evaluateExpression(item, row, outerRow, engineState, groupRows));
    }

    const hasNullCandidate = candidates.some((c) => c === null);
    const matched = candidates.some((c) => compareValues(val, '=', c) === true);

    if (inMatch[2]) {
      if (matched) return false;
      if (hasNullCandidate) return null;
      return true;
    }

    if (matched) return true;
    if (hasNullCandidate) return null;
    return false;
  }

  // 9. EXISTS / NOT EXISTS Subquery
  const existsMatch = expr.match(/^(NOT\s+)?EXISTS\s*\(([\s\S]+)\)$/i);
  if (existsMatch && engineState) {
    const subBody = existsMatch[2].trim();
    const subRes = executeSelectInternal(subBody, engineState, row);
    if (subRes.error) throw new Error(subRes.error);
    const exists = subRes.rows.length > 0;
    return existsMatch[1] ? !exists : exists;
  }

  // 10. LIKE / NOT LIKE
  const notLikeMatch = expr.match(/^(.+?)\s+NOT\s+LIKE\s+(.+)$/i);
  if (notLikeMatch && findKeywordOutside(expr, 'LIKE') >= 0) {
    const val = evaluateExpression(notLikeMatch[1], row, outerRow, engineState, groupRows);
    const patternVal = evaluateExpression(notLikeMatch[2], row, outerRow, engineState, groupRows);
    if (val === null || patternVal === null) return null;
    const pattern = String(patternVal).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
    return !new RegExp(`^${pattern}$`, 'i').test(String(val));
  }

  const likeMatch = expr.match(/^(.+?)\s+LIKE\s+(.+)$/i);
  if (likeMatch && findKeywordOutside(expr, 'LIKE') >= 0) {
    const val = evaluateExpression(likeMatch[1], row, outerRow, engineState, groupRows);
    const patternVal = evaluateExpression(likeMatch[2], row, outerRow, engineState, groupRows);
    if (val === null || patternVal === null) return null;
    const pattern = String(patternVal).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
    return new RegExp(`^${pattern}$`, 'i').test(String(val));
  }

  // 11. Function Calls
  const fnMatch = expr.match(/^([A-Z0-9_]+)\s*\(([\s\S]*)\)$/i);
  if (fnMatch) {
    const fnName = fnMatch[1].toUpperCase();
    const argsRaw = fnMatch[2].trim();
    return evaluateBuiltInFunction(fnName, argsRaw, row, outerRow, engineState, groupRows);
  }

  // 12. Comparison operators
  const compOp = findOperatorOutside(expr, ['<>', '!=', '>=', '<=', '=', '>', '<']);
  if (compOp) {
    const leftVal = evaluateExpression(expr.slice(0, compOp.index), row, outerRow, engineState, groupRows);
    const rightVal = evaluateExpression(expr.slice(compOp.index + compOp.operator.length), row, outerRow, engineState, groupRows);
    return compareValues(leftVal, compOp.operator, rightVal);
  }

  // 13. Literal check
  if (/^null$/i.test(expr)) return null;
  if (/^(true|false)$/i.test(expr)) return expr.toLowerCase() === 'true';
  if (/^N?'.*'$/s.test(expr) || /^".*"$/s.test(expr)) {
    const quoteStart = expr[0] === 'N' ? 1 : 0;
    return expr.slice(quoteStart + 1, -1).replace(/''/g, "'");
  }
  if (/^-?\d+$/.test(expr)) return Number.parseInt(expr, 10);
  if (/^-?\d+\.\d+$/.test(expr)) return Number.parseFloat(expr);

  // 14. Column reference lookup
  return columnValueFromRow(row, cleanName(expr), outerRow);
}

function evaluateCaseExpression(
  expr: string,
  row: StoredRow,
  outerRow?: StoredRow,
  engineState?: EngineState,
  groupRows?: StoredRow[]
): SqlValue {
  const body = expr.slice(4, -3).trim();
  let elseVal: SqlValue = null;

  const elseIdx = findKeywordOutside(body, 'ELSE');
  let whenBody = body;
  if (elseIdx >= 0) {
    whenBody = body.slice(0, elseIdx).trim();
    elseVal = evaluateExpression(body.slice(elseIdx + 4).trim(), row, outerRow, engineState, groupRows);
  }

  const whenParts: { condition: string; result: string }[] = [];
  const matches = Array.from(whenBody.matchAll(/\bWHEN\b([\s\S]+?)\bTHEN\b([\s\S]+?)(?=\bWHEN\b|$)/gi));
  for (const m of matches) {
    whenParts.push({ condition: m[1].trim(), result: m[2].trim() });
  }

  for (const item of whenParts) {
    const condRes = evaluateExpression(item.condition, row, outerRow, engineState, groupRows);
    if (Boolean(condRes)) {
      return evaluateExpression(item.result, row, outerRow, engineState, groupRows);
    }
  }

  return elseVal;
}

function evaluateBuiltInFunction(
  fnName: string,
  argsRaw: string,
  row: StoredRow,
  outerRow?: StoredRow,
  engineState?: EngineState,
  groupRows?: StoredRow[]
): SqlValue {
  const evaluateArgList = () => splitTopLevel(argsRaw).map((a) => evaluateExpression(a, row, outerRow, engineState, groupRows));

  switch (fnName) {
    /* --- Aggregate Functions --- */
    case 'COUNT': {
      const rowsToAggregate = groupRows ?? [row];
      if (argsRaw === '*' || argsRaw === '1') return rowsToAggregate.length;
      return rowsToAggregate.filter((r) => {
        try {
          return evaluateExpression(argsRaw, r, outerRow, engineState) !== null;
        } catch {
          return false;
        }
      }).length;
    }
    case 'SUM': {
      const rowsToAggregate = groupRows ?? [row];
      let sum = 0;
      let hasNonNull = false;
      for (const r of rowsToAggregate) {
        const v = evaluateExpression(argsRaw, r, outerRow, engineState);
        if (v !== null && !Number.isNaN(Number(v))) {
          sum += Number(v);
          hasNonNull = true;
        }
      }
      return hasNonNull ? sum : null;
    }
    case 'AVG': {
      const rowsToAggregate = groupRows ?? [row];
      let sum = 0;
      let count = 0;
      for (const r of rowsToAggregate) {
        const v = evaluateExpression(argsRaw, r, outerRow, engineState);
        if (v !== null && !Number.isNaN(Number(v))) {
          sum += Number(v);
          count += 1;
        }
      }
      return count > 0 ? sum / count : null;
    }
    case 'MAX': {
      const rowsToAggregate = groupRows ?? [row];
      let max: SqlValue = null;
      for (const r of rowsToAggregate) {
        const v = evaluateExpression(argsRaw, r, outerRow, engineState);
        if (v !== null) {
          if (max === null || compareValues(v, '>', max) === true) max = v;
        }
      }
      return max;
    }
    case 'MIN': {
      const rowsToAggregate = groupRows ?? [row];
      let min: SqlValue = null;
      for (const r of rowsToAggregate) {
        const v = evaluateExpression(argsRaw, r, outerRow, engineState);
        if (v !== null) {
          if (min === null || compareValues(v, '<', min) === true) min = v;
        }
      }
      return min;
    }

    /* --- String Functions --- */
    case 'UPPER': {
      const args = evaluateArgList();
      return args[0] !== null ? String(args[0]).toUpperCase() : null;
    }
    case 'LOWER': {
      const args = evaluateArgList();
      return args[0] !== null ? String(args[0]).toLowerCase() : null;
    }
    case 'LEFT': {
      const args = evaluateArgList();
      if (args.length < 2 || args[0] === undefined || args[1] === undefined) throw new Error('LEFT function requires 2 arguments.');
      if (args[0] === null || args[1] === null) return null;
      const len = Math.max(0, Number(args[1]));
      return String(args[0]).substring(0, len);
    }
    case 'RIGHT': {
      const args = evaluateArgList();
      if (args.length < 2 || args[0] === undefined || args[1] === undefined) throw new Error('RIGHT function requires 2 arguments.');
      if (args[0] === null || args[1] === null) return null;
      const str = String(args[0]);
      const len = Math.max(0, Number(args[1]));
      return len === 0 ? '' : str.slice(-len);
    }
    case 'CONCAT': {
      const args = evaluateArgList();
      return args.map((a) => (a === null ? '' : String(a))).join('');
    }
    case 'REPLACE': {
      const args = evaluateArgList();
      if (args.length < 3) throw new Error('REPLACE function requires 3 arguments.');
      if (args[0] === null || args[1] === null || args[2] === null) return null;
      return String(args[0]).replaceAll(String(args[1]), String(args[2]));
    }
    case 'SUBSTRING': {
      const args = evaluateArgList();
      if (args.length < 3) throw new Error('SUBSTRING function requires 3 arguments.');
      if (args[0] === null || args[1] === null || args[2] === null) return null;
      const str = String(args[0]);
      const start = Math.max(1, Number(args[1])) - 1;
      const len = Math.max(0, Number(args[2]));
      return str.substring(start, start + len);
    }
    case 'CHARINDEX': {
      const args = evaluateArgList();
      if (args.length < 2) throw new Error('CHARINDEX function requires at least 2 arguments.');
      if (args[0] === null || args[1] === null) return null;
      const sub = String(args[0]).toLowerCase();
      const str = String(args[1]).toLowerCase();
      const startPos = args[2] !== undefined && args[2] !== null ? Math.max(1, Number(args[2])) - 1 : 0;
      const idx = str.indexOf(sub, startPos);
      return idx >= 0 ? idx + 1 : 0;
    }
    case 'LEN': {
      const args = evaluateArgList();
      if (args[0] === null) return null;
      return String(args[0]).replace(/\s+$/, '').length;
    }
    case 'LTRIM': {
      const args = evaluateArgList();
      return args[0] !== null ? String(args[0]).replace(/^\s+/, '') : null;
    }
    case 'RTRIM': {
      const args = evaluateArgList();
      return args[0] !== null ? String(args[0]).replace(/\s+$/, '') : null;
    }
    case 'TRIM': {
      const args = evaluateArgList();
      return args[0] !== null ? String(args[0]).trim() : null;
    }
    case 'REVERSE': {
      const args = evaluateArgList();
      return args[0] !== null ? String(args[0]).split('').reverse().join('') : null;
    }
    case 'SPACE': {
      const args = evaluateArgList();
      if (args[0] === null) return null;
      return ' '.repeat(Math.max(0, Number(args[0])));
    }
    case 'REPLICATE': {
      const args = evaluateArgList();
      if (args[0] === null || args[1] === null) return null;
      return String(args[0]).repeat(Math.max(0, Number(args[1])));
    }
    case 'STUFF': {
      const args = evaluateArgList();
      if (args.length < 4) throw new Error('STUFF function requires 4 arguments.');
      if (args[0] === null || args[1] === null || args[2] === null || args[3] === null) return null;
      const str = String(args[0]);
      const start = Number(args[1]) - 1;
      const len = Number(args[2]);
      const replacement = String(args[3]);
      if (start < 0 || start > str.length) return null;
      return str.slice(0, start) + replacement + str.slice(start + len);
    }

    /* --- Numeric Functions --- */
    case 'ABS': {
      const args = evaluateArgList();
      return args[0] !== null ? Math.abs(Number(args[0])) : null;
    }
    case 'ROUND': {
      const args = evaluateArgList();
      if (args[0] === null) return null;
      const decimals = args[1] !== undefined && args[1] !== null ? Number(args[1]) : 0;
      const factor = Math.pow(10, decimals);
      return Math.round(Number(args[0]) * factor) / factor;
    }
    case 'CEILING': {
      const args = evaluateArgList();
      return args[0] !== null ? Math.ceil(Number(args[0])) : null;
    }
    case 'FLOOR': {
      const args = evaluateArgList();
      return args[0] !== null ? Math.floor(Number(args[0])) : null;
    }
    case 'POWER': {
      const args = evaluateArgList();
      if (args.length < 2) throw new Error('POWER function requires 2 arguments.');
      if (args[0] === null || args[1] === null) return null;
      return Math.pow(Number(args[0]), Number(args[1]));
    }
    case 'SQRT': {
      const args = evaluateArgList();
      return args[0] !== null ? Math.sqrt(Number(args[0])) : null;
    }
    case 'SIGN': {
      const args = evaluateArgList();
      return args[0] !== null ? Math.sign(Number(args[0])) : null;
    }

    /* --- Date Functions --- */
    case 'GETDATE':
    case 'SYSDATETIME': {
      return formatDate(new Date(), true);
    }
    case 'YEAR': {
      const args = evaluateArgList();
      const d = parseSqlDate(args[0]);
      return d ? d.getFullYear() : null;
    }
    case 'MONTH': {
      const args = evaluateArgList();
      const d = parseSqlDate(args[0]);
      return d ? d.getMonth() + 1 : null;
    }
    case 'DAY': {
      const args = evaluateArgList();
      const d = parseSqlDate(args[0]);
      return d ? d.getDate() : null;
    }
    case 'DATEPART': {
      const rawArgs = splitTopLevel(argsRaw);
      if (rawArgs.length < 2) throw new Error('DATEPART requires 2 arguments.');
      const part = cleanName(rawArgs[0]).toLowerCase();
      const d = parseSqlDate(evaluateExpression(rawArgs[1], row, outerRow, engineState, groupRows));
      if (!d) return null;
      if (['year', 'yy', 'yyyy'].includes(part)) return d.getFullYear();
      if (['month', 'mm', 'm'].includes(part)) return d.getMonth() + 1;
      if (['day', 'dd', 'd'].includes(part)) return d.getDate();
      if (['hour', 'hh'].includes(part)) return d.getHours();
      if (['minute', 'mi', 'n'].includes(part)) return d.getMinutes();
      if (['second', 'ss', 's'].includes(part)) return d.getSeconds();
      return null;
    }
    case 'DATEADD': {
      const rawArgs = splitTopLevel(argsRaw);
      if (rawArgs.length < 3) throw new Error('DATEADD requires 3 arguments.');
      const part = cleanName(rawArgs[0]).toLowerCase();
      const number = Number(evaluateExpression(rawArgs[1], row, outerRow, engineState, groupRows));
      const d = parseSqlDate(evaluateExpression(rawArgs[2], row, outerRow, engineState, groupRows));
      if (!d) return null;
      const res = new Date(d.getTime());
      if (['year', 'yy', 'yyyy'].includes(part)) res.setFullYear(res.getFullYear() + number);
      else if (['month', 'mm', 'm'].includes(part)) res.setMonth(res.getMonth() + number);
      else if (['day', 'dd', 'd'].includes(part)) res.setDate(res.getDate() + number);
      else if (['hour', 'hh'].includes(part)) res.setHours(res.getHours() + number);
      else if (['minute', 'mi', 'n'].includes(part)) res.setMinutes(res.getMinutes() + number);
      else if (['second', 'ss', 's'].includes(part)) res.setSeconds(res.getSeconds() + number);
      return formatDate(res, true);
    }
    case 'DATEDIFF': {
      const rawArgs = splitTopLevel(argsRaw);
      if (rawArgs.length < 3) throw new Error('DATEDIFF requires 3 arguments.');
      const part = cleanName(rawArgs[0]).toLowerCase();
      const d1 = parseSqlDate(evaluateExpression(rawArgs[1], row, outerRow, engineState, groupRows));
      const d2 = parseSqlDate(evaluateExpression(rawArgs[2], row, outerRow, engineState, groupRows));
      if (!d1 || !d2) return null;
      const diffMs = d2.getTime() - d1.getTime();
      if (['year', 'yy', 'yyyy'].includes(part)) return d2.getFullYear() - d1.getFullYear();
      if (['month', 'mm', 'm'].includes(part)) return (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth());
      if (['day', 'dd', 'd'].includes(part)) return Math.floor(diffMs / (1000 * 60 * 60 * 24));
      if (['hour', 'hh'].includes(part)) return Math.floor(diffMs / (1000 * 60 * 60));
      if (['minute', 'mi', 'n'].includes(part)) return Math.floor(diffMs / (1000 * 60));
      if (['second', 'ss', 's'].includes(part)) return Math.floor(diffMs / 1000);
      return null;
    }
    case 'EOMONTH': {
      const args = evaluateArgList();
      const d = parseSqlDate(args[0]);
      if (!d) return null;
      const addMonths = args[1] !== undefined && args[1] !== null ? Number(args[1]) : 0;
      const res = new Date(d.getFullYear(), d.getMonth() + 1 + addMonths, 0);
      return formatDate(res, false);
    }

    /* --- NULL & Conditional Functions --- */
    case 'ISNULL': {
      const args = evaluateArgList();
      return args[0] !== null ? args[0] : args[1];
    }
    case 'COALESCE': {
      const args = evaluateArgList();
      for (const arg of args) if (arg !== null) return arg;
      return null;
    }
    case 'NULLIF': {
      const args = evaluateArgList();
      return compareValues(args[0], '=', args[1]) === true ? null : args[0];
    }
    case 'IIF': {
      const rawArgs = splitTopLevel(argsRaw);
      const cond = evaluateExpression(rawArgs[0], row, outerRow, engineState, groupRows);
      return Boolean(cond)
        ? evaluateExpression(rawArgs[1], row, outerRow, engineState, groupRows)
        : evaluateExpression(rawArgs[2], row, outerRow, engineState, groupRows);
    }

    default:
      throw new Error(`الدالة "${fnName}" غير مدعومة في المحرك التعليمي.`);
  }
}

/* ==========================================================================
   JOIN & SOURCE TABLE RESOLUTION
   ========================================================================== */

interface VirtualCatalogData {
  columns: string[];
  rows: StoredRow[];
}

/**
 * Educational subset of SQL Server INFORMATION_SCHEMA.
 * All user objects currently live in the simulated dbo schema.
 */
function informationSchemaData(sourceName: string, database: DatabaseModel): VirtualCatalogData | null {
  const objectName = keyOf(sourceName);
  const tables = Object.values(database.tables);
  const views = Object.values(database.views ?? {});
  const allObjectNames = [
    ...tables.map((table) => ({ name: table.name, type: 'BASE TABLE' })),
    ...views.map((view) => ({ name: view.name, type: 'VIEW' })),
  ];

  if (objectName === 'information_schema.tables') {
    const columns = ['TABLE_CATALOG', 'TABLE_SCHEMA', 'TABLE_NAME', 'TABLE_TYPE'];
    return {
      columns,
      rows: allObjectNames.map((item) => ({
        TABLE_CATALOG: database.name,
        TABLE_SCHEMA: 'dbo',
        TABLE_NAME: item.name,
        TABLE_TYPE: item.type,
      })),
    };
  }

  if (objectName === 'information_schema.columns') {
    const columns = [
      'TABLE_CATALOG',
      'TABLE_SCHEMA',
      'TABLE_NAME',
      'COLUMN_NAME',
      'ORDINAL_POSITION',
      'COLUMN_DEFAULT',
      'IS_NULLABLE',
      'DATA_TYPE',
      'CHARACTER_MAXIMUM_LENGTH',
      'NUMERIC_PRECISION',
      'NUMERIC_SCALE',
    ];
    const rows: StoredRow[] = [];

    for (const table of tables) {
      table.columns.forEach((column, index) => {
        const normalizedType = column.type.toUpperCase();
        const baseType = normalizedType.match(/^[A-Z]+/)?.[0] ?? normalizedType;
        const args = normalizedType.match(/\(([^)]+)\)/)?.[1];
        const typeArgs = args ? args.split(',').map((part) => part.trim()) : [];
        let characterLength: SqlValue = null;
        let numericPrecision: SqlValue = null;
        let numericScale: SqlValue = null;

        if (['CHAR', 'VARCHAR', 'NCHAR', 'NVARCHAR', 'BINARY', 'VARBINARY'].includes(baseType) && typeArgs.length) {
          characterLength = typeArgs[0].toUpperCase() === 'MAX' ? -1 : Number.parseInt(typeArgs[0], 10);
        }
        if (['DECIMAL', 'NUMERIC'].includes(baseType)) {
          numericPrecision = typeArgs[0] ? Number.parseInt(typeArgs[0], 10) : 18;
          numericScale = typeArgs[1] ? Number.parseInt(typeArgs[1], 10) : 0;
        } else if (baseType === 'TINYINT') {
          numericPrecision = 3;
          numericScale = 0;
        } else if (baseType === 'SMALLINT') {
          numericPrecision = 5;
          numericScale = 0;
        } else if (baseType === 'INT') {
          numericPrecision = 10;
          numericScale = 0;
        } else if (baseType === 'BIGINT') {
          numericPrecision = 19;
          numericScale = 0;
        }

        rows.push({
          TABLE_CATALOG: database.name,
          TABLE_SCHEMA: 'dbo',
          TABLE_NAME: table.name,
          COLUMN_NAME: column.name,
          ORDINAL_POSITION: index + 1,
          COLUMN_DEFAULT: column.defaultValue === undefined ? null : valueToText(column.defaultValue),
          IS_NULLABLE: column.nullable ? 'YES' : 'NO',
          DATA_TYPE: baseType,
          CHARACTER_MAXIMUM_LENGTH: characterLength,
          NUMERIC_PRECISION: numericPrecision,
          NUMERIC_SCALE: numericScale,
        });
      });
    }

    for (const view of views) {
      (view.columns ?? []).forEach((columnName, index) => {
        rows.push({
          TABLE_CATALOG: database.name,
          TABLE_SCHEMA: 'dbo',
          TABLE_NAME: view.name,
          COLUMN_NAME: columnName,
          ORDINAL_POSITION: index + 1,
          COLUMN_DEFAULT: null,
          IS_NULLABLE: 'YES',
          DATA_TYPE: null,
          CHARACTER_MAXIMUM_LENGTH: null,
          NUMERIC_PRECISION: null,
          NUMERIC_SCALE: null,
        });
      });
    }

    return { columns, rows };
  }

  if (objectName === 'information_schema.table_constraints') {
    const columns = [
      'CONSTRAINT_CATALOG',
      'CONSTRAINT_SCHEMA',
      'CONSTRAINT_NAME',
      'TABLE_CATALOG',
      'TABLE_SCHEMA',
      'TABLE_NAME',
      'CONSTRAINT_TYPE',
      'IS_DEFERRABLE',
      'INITIALLY_DEFERRED',
    ];
    const rows: StoredRow[] = [];
    const addConstraint = (tableName: string, constraintName: string, constraintType: string) => {
      rows.push({
        CONSTRAINT_CATALOG: database.name,
        CONSTRAINT_SCHEMA: 'dbo',
        CONSTRAINT_NAME: constraintName,
        TABLE_CATALOG: database.name,
        TABLE_SCHEMA: 'dbo',
        TABLE_NAME: tableName,
        CONSTRAINT_TYPE: constraintType,
        IS_DEFERRABLE: 'NO',
        INITIALLY_DEFERRED: 'NO',
      });
    };

    for (const table of tables) {
      const primaryKeys = table.primaryKeyColumns?.length
        ? table.primaryKeyColumns
        : table.columns.filter((column) => column.primaryKey).map((column) => column.name);
      if (primaryKeys.length) addConstraint(table.name, 'PK_' + table.name, 'PRIMARY KEY');

      (table.uniqueConstraints ?? []).forEach((constraint, index) => {
        addConstraint(table.name, 'UQ_' + table.name + '_' + (index + 1), 'UNIQUE');
      });
      for (const column of table.columns.filter((item) => item.unique)) {
        addConstraint(table.name, 'UQ_' + table.name + '_' + column.name, 'UNIQUE');
      }
      for (const foreignKey of table.foreignKeys ?? []) {
        addConstraint(table.name, foreignKey.name, 'FOREIGN KEY');
      }
      for (const check of table.checkConstraints ?? []) {
        addConstraint(table.name, check.name, 'CHECK');
      }
      for (const column of table.columns.filter((item) => item.defaultConstraintName)) {
        addConstraint(table.name, column.defaultConstraintName!, 'DEFAULT');
      }
    }

    return { columns, rows };
  }

  if (objectName === 'information_schema.key_column_usage') {
    const columns = [
      'CONSTRAINT_CATALOG',
      'CONSTRAINT_SCHEMA',
      'CONSTRAINT_NAME',
      'TABLE_CATALOG',
      'TABLE_SCHEMA',
      'TABLE_NAME',
      'COLUMN_NAME',
      'ORDINAL_POSITION',
      'POSITION_IN_UNIQUE_CONSTRAINT',
    ];
    const rows: StoredRow[] = [];
    const addKeyColumn = (
      table: TableModel,
      constraintName: string,
      columnName: string,
      ordinalPosition: number,
      positionInUniqueConstraint: SqlValue = null
    ) => {
      rows.push({
        CONSTRAINT_CATALOG: database.name,
        CONSTRAINT_SCHEMA: 'dbo',
        CONSTRAINT_NAME: constraintName,
        TABLE_CATALOG: database.name,
        TABLE_SCHEMA: 'dbo',
        TABLE_NAME: table.name,
        COLUMN_NAME: columnName,
        ORDINAL_POSITION: ordinalPosition,
        POSITION_IN_UNIQUE_CONSTRAINT: positionInUniqueConstraint,
      });
    };

    for (const table of tables) {
      const primaryKeyColumns = table.primaryKeyColumns?.length
        ? table.primaryKeyColumns
        : table.columns.filter((column) => column.primaryKey).map((column) => column.name);
      primaryKeyColumns.forEach((columnName, index) => {
        addKeyColumn(table, 'PK_' + table.name, columnName, index + 1);
      });

      (table.uniqueConstraints ?? []).forEach((uniqueColumns, constraintIndex) => {
        uniqueColumns.forEach((columnName, index) => {
          addKeyColumn(table, 'UQ_' + table.name + '_' + (constraintIndex + 1), columnName, index + 1);
        });
      });

      for (const column of table.columns.filter((item) => item.unique)) {
        addKeyColumn(table, 'UQ_' + table.name + '_' + column.name, column.name, 1);
      }

      for (const foreignKey of table.foreignKeys ?? []) {
        addKeyColumn(table, foreignKey.name, foreignKey.column, 1, 1);
      }
    }

    return { columns, rows };
  }

  if (objectName === 'information_schema.referential_constraints') {
    const columns = [
      'CONSTRAINT_CATALOG',
      'CONSTRAINT_SCHEMA',
      'CONSTRAINT_NAME',
      'UNIQUE_CONSTRAINT_CATALOG',
      'UNIQUE_CONSTRAINT_SCHEMA',
      'UNIQUE_CONSTRAINT_NAME',
      'MATCH_OPTION',
      'UPDATE_RULE',
      'DELETE_RULE',
    ];
    const rows: StoredRow[] = [];

    const referencedKeyName = (foreignKey: ForeignKeyModel): string | null => {
      const referencedTable = tables.find(
        (table) => keyOf(table.name) === keyOf(foreignKey.referencedTable)
      );
      if (!referencedTable) return null;

      const primaryKeyColumns = referencedTable.primaryKeyColumns?.length
        ? referencedTable.primaryKeyColumns
        : referencedTable.columns.filter((column) => column.primaryKey).map((column) => column.name);
      if (primaryKeyColumns.length === 1 && keyOf(primaryKeyColumns[0]) === keyOf(foreignKey.referencedColumn)) {
        return 'PK_' + referencedTable.name;
      }

      const uniqueConstraintIndex = (referencedTable.uniqueConstraints ?? []).findIndex(
        (uniqueColumns) => uniqueColumns.length === 1
          && keyOf(uniqueColumns[0]) === keyOf(foreignKey.referencedColumn)
      );
      if (uniqueConstraintIndex >= 0) {
        return 'UQ_' + referencedTable.name + '_' + (uniqueConstraintIndex + 1);
      }

      const uniqueColumn = referencedTable.columns.find(
        (column) => column.unique && keyOf(column.name) === keyOf(foreignKey.referencedColumn)
      );
      return uniqueColumn ? 'UQ_' + referencedTable.name + '_' + uniqueColumn.name : null;
    };

    for (const table of tables) {
      for (const foreignKey of table.foreignKeys ?? []) {
        rows.push({
          CONSTRAINT_CATALOG: database.name,
          CONSTRAINT_SCHEMA: 'dbo',
          CONSTRAINT_NAME: foreignKey.name,
          UNIQUE_CONSTRAINT_CATALOG: database.name,
          UNIQUE_CONSTRAINT_SCHEMA: 'dbo',
          UNIQUE_CONSTRAINT_NAME: referencedKeyName(foreignKey),
          MATCH_OPTION: 'SIMPLE',
          UPDATE_RULE: 'NO ACTION',
          DELETE_RULE: 'NO ACTION',
        });
      }
    }

    return { columns, rows };
  }

  if (objectName === 'information_schema.views') {
    const columns = [
      'TABLE_CATALOG',
      'TABLE_SCHEMA',
      'TABLE_NAME',
      'VIEW_DEFINITION',
      'CHECK_OPTION',
      'IS_UPDATABLE',
    ];
    return {
      columns,
      rows: views.map((view) => ({
        TABLE_CATALOG: database.name,
        TABLE_SCHEMA: 'dbo',
        TABLE_NAME: view.name,
        VIEW_DEFINITION: view.definition,
        CHECK_OPTION: 'NONE',
        IS_UPDATABLE: 'NO',
      })),
    };
  }

  return null;
}

/**
 * Simplified SQL Server-style sys catalog. Object IDs are stable simulator IDs,
 * not native SQL Server object IDs; all objects use the simulated dbo schema.
 */
function systemCatalogData(
  sourceName: string,
  database: DatabaseModel,
  engineState?: EngineState
): VirtualCatalogData | null {
  const source = keyOf(sourceName);

  if (source === 'sys.databases') {
    const databaseNames = Object.values(engineState?.databases ?? {})
      .sort((left, right) => keyOf(left.name).localeCompare(keyOf(right.name)));
    return {
      columns: [
        'name',
        'database_id',
        'create_date',
        'collation_name',
        'state',
        'state_desc',
        'user_access',
        'user_access_desc',
        'is_read_only',
      ],
      rows: databaseNames.map((item, index) => ({
        name: item.name,
        // Synthetic IDs are for education only; they are not SQL Server database IDs.
        database_id: index + 5,
        create_date: null,
        collation_name: null,
        state: 0,
        state_desc: 'ONLINE',
        user_access: 0,
        user_access_desc: 'MULTI_USER',
        is_read_only: 0,
      })),
    };
  }

  const tables = Object.values(database.tables);
  const views = Object.values(database.views ?? {});
  const objects = [
    ...tables.map((item) => ({ name: item.name, type: 'U', typeDesc: 'USER_TABLE' })),
    ...views.map((item) => ({ name: item.name, type: 'V', typeDesc: 'VIEW' })),
  ].sort((a, b) => keyOf(a.name).localeCompare(keyOf(b.name)));
  const objectIds = new Map(objects.map((item, index) => [keyOf(item.name), 1000 + index]));
  const idFor = (name: string) => objectIds.get(keyOf(name)) ?? null;
  const objectColumns = ['object_id', 'name', 'schema_id', 'type', 'type_desc', 'is_ms_shipped'];

  if (source === 'sys.schemas') {
    const schemaNames = [
      'dbo',
      ...Object.values(database.schemas ?? {})
        .map((schema) => schema.name)
        .filter((name) => keyOf(name) !== 'dbo')
        .sort((left, right) => keyOf(left).localeCompare(keyOf(right))),
    ];
    return {
      columns: ['schema_id', 'name'],
      rows: schemaNames.map((name, index) => ({ schema_id: index + 1, name })),
    };
  }

  if (source === 'sys.objects' || source === 'sys.tables' || source === 'sys.views') {
    const selected = objects.filter((item) =>
      source === 'sys.objects' || (source === 'sys.tables' ? item.type === 'U' : item.type === 'V')
    );
    return {
      columns: objectColumns,
      rows: selected.map((item) => ({
        object_id: idFor(item.name),
        name: item.name,
        schema_id: 1,
        type: item.type,
        type_desc: item.typeDesc,
        is_ms_shipped: 0,
      })),
    };
  }

  if (source === 'sys.columns') {
    const columns = ['object_id', 'column_id', 'name', 'system_type_id', 'max_length', 'precision', 'scale', 'is_nullable', 'is_identity'];
    const typeIds: Record<string, number> = {
      BIGINT: 127, BIT: 104, CHAR: 175, DATE: 40, DATETIME: 61, DATETIME2: 42,
      DECIMAL: 106, FLOAT: 62, INT: 56, NCHAR: 239, NUMERIC: 108,
      NVARCHAR: 231, REAL: 59, SMALLINT: 52, TIME: 41, TINYINT: 48, VARCHAR: 167,
    };
    const fixedLengths: Record<string, number> = {
      BIGINT: 8, BIT: 1, DATE: 3, DATETIME: 8, DATETIME2: 8, FLOAT: 8,
      INT: 4, REAL: 4, SMALLINT: 2, TIME: 5, TINYINT: 1,
    };
    const rows: StoredRow[] = [];

    for (const table of tables) {
      table.columns.forEach((column, index) => {
        const normalized = column.type.toUpperCase();
        const baseType = normalized.match(/^[A-Z]+/)?.[0] ?? normalized;
        const args = normalized.match(/\(([^)]+)\)/)?.[1]?.split(',').map((part) => part.trim()) ?? [];
        let maxLength: SqlValue = fixedLengths[baseType] ?? null;
        let precision: SqlValue = null;
        let scale: SqlValue = null;
        if (['CHAR', 'VARCHAR', 'NCHAR', 'NVARCHAR'].includes(baseType) && args.length) {
          const length = args[0].toUpperCase() === 'MAX' ? -1 : Number.parseInt(args[0], 10);
          maxLength = length < 0 ? -1 : length * (baseType === 'NCHAR' || baseType === 'NVARCHAR' ? 2 : 1);
        }
        if (baseType === 'DECIMAL' || baseType === 'NUMERIC') {
          precision = args[0] ? Number.parseInt(args[0], 10) : 18;
          scale = args[1] ? Number.parseInt(args[1], 10) : 0;
          maxLength = Number(precision) <= 9 ? 5 : Number(precision) <= 19 ? 9 : Number(precision) <= 28 ? 13 : 17;
        }
        rows.push({
          object_id: idFor(table.name),
          column_id: index + 1,
          name: column.name,
          system_type_id: typeIds[baseType] ?? null,
          max_length: maxLength,
          precision,
          scale,
          is_nullable: column.nullable ? 1 : 0,
          is_identity: column.identity ? 1 : 0,
        });
      });
    }

    for (const view of views) {
      (view.columns ?? []).forEach((name, index) => rows.push({
        object_id: idFor(view.name),
        column_id: index + 1,
        name,
        system_type_id: null,
        max_length: null,
        precision: null,
        scale: null,
        is_nullable: 1,
        is_identity: 0,
      }));
    }
    return { columns, rows };
  }

  if (source === 'sys.indexes') {
    const columns = ['object_id', 'index_id', 'name', 'type', 'type_desc', 'is_unique', 'is_primary_key'];
    const rows: StoredRow[] = [];
    for (const table of tables) {
      let indexId = 1;
      const primaryKeys = table.primaryKeyColumns?.length
        ? table.primaryKeyColumns
        : table.columns.filter((column) => column.primaryKey).map((column) => column.name);
      if (primaryKeys.length) rows.push({
        object_id: idFor(table.name), index_id: indexId++, name: 'PK_' + table.name,
        type: 1, type_desc: 'CLUSTERED', is_unique: 1, is_primary_key: 1,
      });
      (table.uniqueConstraints ?? []).forEach((constraint, index) => rows.push({
        object_id: idFor(table.name), index_id: indexId++, name: 'UQ_' + table.name + '_' + (index + 1),
        type: 2, type_desc: 'NONCLUSTERED', is_unique: 1, is_primary_key: 0,
      }));
      for (const column of table.columns.filter((item) => item.unique)) rows.push({
        object_id: idFor(table.name), index_id: indexId++, name: 'UQ_' + table.name + '_' + column.name,
        type: 2, type_desc: 'NONCLUSTERED', is_unique: 1, is_primary_key: 0,
      });
      for (const index of table.indexes ?? []) rows.push({
        object_id: idFor(table.name), index_id: indexId++, name: index.name,
        type: 2, type_desc: 'NONCLUSTERED', is_unique: index.unique ? 1 : 0, is_primary_key: 0,
      });
    }
    return { columns, rows };
  }

  if (source === 'sys.index_columns') {
    const columns = ['object_id', 'index_id', 'index_column_id', 'column_id', 'key_ordinal', 'is_descending_key', 'is_included_column'];
    const rows: StoredRow[] = [];
    for (const table of tables) {
      let indexId = 1;
      const addIndexColumns = (indexedColumns: string[]) => {
        indexedColumns.forEach((columnName, index) => {
          const columnId = table.columns.findIndex((column) => keyOf(column.name) === keyOf(columnName));
          if (columnId < 0) return;
          rows.push({
            object_id: idFor(table.name),
            index_id: indexId,
            index_column_id: index + 1,
            column_id: columnId + 1,
            key_ordinal: index + 1,
            is_descending_key: 0,
            is_included_column: 0,
          });
        });
        indexId++;
      };
      const primaryKeys = table.primaryKeyColumns?.length
        ? table.primaryKeyColumns
        : table.columns.filter((column) => column.primaryKey).map((column) => column.name);
      if (primaryKeys.length) addIndexColumns(primaryKeys);
      for (const constraint of table.uniqueConstraints ?? []) addIndexColumns(constraint);
      for (const column of table.columns.filter((item) => item.unique)) addIndexColumns([column.name]);
      for (const index of table.indexes ?? []) addIndexColumns(index.columns);
    }
    return { columns, rows };
  }

  if (source === 'sys.key_constraints') {
    const columns = ['name', 'object_id', 'parent_object_id', 'type', 'type_desc', 'unique_index_id'];
    const rows: StoredRow[] = [];
    for (const table of tables) {
      let indexId = 1;
      const primaryKeys = table.primaryKeyColumns?.length
        ? table.primaryKeyColumns
        : table.columns.filter((column) => column.primaryKey).map((column) => column.name);
      if (primaryKeys.length) {
        rows.push({
          name: 'PK_' + table.name,
          object_id: idFor(table.name),
          parent_object_id: idFor(table.name),
          type: 'PK',
          type_desc: 'PRIMARY_KEY_CONSTRAINT',
          unique_index_id: indexId++,
        });
      }
      for (const column of table.columns.filter((item) => item.unique)) rows.push({
        name: 'UQ_' + table.name + '_' + column.name,
        object_id: idFor(table.name),
        parent_object_id: idFor(table.name),
        type: 'UQ',
        type_desc: 'UNIQUE_CONSTRAINT',
        unique_index_id: indexId++,
      });
      (table.uniqueConstraints ?? []).forEach((constraint, index) => rows.push({
        name: 'UQ_' + table.name + '_' + (index + 1),
        object_id: idFor(table.name),
        parent_object_id: idFor(table.name),
        type: 'UQ',
        type_desc: 'UNIQUE_CONSTRAINT',
        unique_index_id: indexId++,
      }));
    }
    return { columns, rows };
  }

  if (source === 'sys.foreign_keys') {
    const columns = ['name', 'parent_object_id', 'referenced_object_id', 'is_disabled', 'is_not_trusted', 'delete_referential_action_desc', 'update_referential_action_desc'];
    const rows: StoredRow[] = [];
    for (const table of tables) for (const foreignKey of table.foreignKeys ?? []) rows.push({
      name: foreignKey.name,
      parent_object_id: idFor(table.name),
      referenced_object_id: idFor(foreignKey.referencedTable),
      is_disabled: 0,
      is_not_trusted: 0,
      delete_referential_action_desc: 'NO_ACTION',
      update_referential_action_desc: 'NO_ACTION',
    });
    return { columns, rows };
  }

  if (source === 'sys.check_constraints') {
    const columns = ['name', 'parent_object_id', 'definition', 'is_disabled', 'is_not_trusted'];
    const rows: StoredRow[] = [];
    for (const table of tables) for (const constraint of table.checkConstraints ?? []) rows.push({
      name: constraint.name,
      parent_object_id: idFor(table.name),
      definition: constraint.expression,
      is_disabled: 0,
      is_not_trusted: 0,
    });
    return { columns, rows };
  }

  if (source === 'sys.identity_columns') {
    const columns = ['object_id', 'column_id', 'name', 'seed_value', 'increment_value', 'last_value', 'is_not_for_replication'];
    const rows: StoredRow[] = [];
    for (const table of tables) table.columns.forEach((column, index) => {
      if (!column.identity) return;
      const values = table.rows.map((row) => row[column.name]).filter((value): value is number => typeof value === 'number');
      const lastValue = values.length
        ? (column.identity.increment > 0 ? Math.max(...values) : Math.min(...values))
        : null;
      rows.push({
        object_id: idFor(table.name), column_id: index + 1, name: column.name,
        seed_value: column.identity.seed, increment_value: column.identity.increment,
        last_value: lastValue, is_not_for_replication: 0,
      });
    });
    return { columns, rows };
  }

  if (source === 'sys.default_constraints') {
    const columns = ['name', 'parent_object_id', 'parent_column_id', 'definition'];
    const rows: StoredRow[] = [];
    for (const table of tables) table.columns.forEach((column, index) => {
      if (column.defaultValue === undefined) return;
      const value = column.defaultValue;
      const definition = value === null ? 'NULL'
        : typeof value === 'string' ? "'" + value.replace(/'/g, "''") + "'"
        : String(value);
      rows.push({
        name: column.defaultConstraintName ?? ('DF_' + table.name + '_' + column.name),
        parent_object_id: idFor(table.name),
        parent_column_id: index + 1,
        definition,
      });
    });
    return { columns, rows };
  }

  return null;
}

interface ParsedTableSource {
  alias: string;
  tableName: string;
  sourceId: string; // Unique table source identifier
  columns: string[];
  rows: StoredRow[];
}

function parseTableSource(
  sourceStr: string,
  database: DatabaseModel,
  engineState: EngineState,
  outerRow?: StoredRow,
  sourceIndex = 0
): ParsedTableSource {
  const trimmed = sourceStr.trim();

  // Derived subquery table: (SELECT ...) [AS] Alias
  if (trimmed.startsWith('(')) {
    const endParen = trimmed.lastIndexOf(')');
    const subSql = trimmed.slice(1, endParen).trim();
    const rest = trimmed.slice(endParen + 1).trim().replace(/^AS\s+/i, '');
    const alias = cleanName(rest || `SubQuery${sourceIndex}`);
    const sourceId = `subquery_${sourceIndex}_${alias}`;

    const subRes = executeSelectInternal(subSql, engineState, outerRow);
    if (subRes.error) throw new Error(subRes.error);

    const rows: StoredRow[] = subRes.rows.map((row) => {
      const obj: StoredRow = {};
      subRes.columns.forEach((col, idx) => {
        const val = parseValue(row[idx]);
        obj[`${alias}.${col}`] = val;
        obj[`${sourceId}::${col}`] = val;
        obj[col] = val;
      });
      return obj;
    });

    return { alias, tableName: alias, sourceId, columns: subRes.columns, rows };
  }

  // Base Table: TableName [AS] Alias
  const parts = trimmed.split(/\s+(?:AS\s+)?/i);
  const tableName = cleanName(parts[0]);
  const alias = cleanName(parts[1] || parts[0]);
  const sourceId = `tbl_${sourceIndex}_${alias}`;

  const catalogData = informationSchemaData(tableName, database) ?? systemCatalogData(tableName, database, engineState);
  if (catalogData) {
    const rows: StoredRow[] = catalogData.rows.map((record) => {
      const obj: StoredRow = {};
      for (const columnName of catalogData.columns) {
        const value = record[columnName] ?? null;
        obj[tableName + '.' + columnName] = value;
        obj[alias + '.' + columnName] = value;
        obj[sourceId + '::' + columnName] = value;
        obj[columnName] = value;
      }
      return obj;
    });
    return { alias, tableName, sourceId, columns: catalogData.columns, rows };
  }

  const table = tableFor(database, tableName);
  if (!table) {
    const view = database.views?.[keyOf(tableName)];
    if (!view) throw new Error(`الجدول أو العرض "${tableName}" غير موجود في قاعدة البيانات.`);

    const viewKey = keyOf(`${database.name}.${view.name}`);
    if (activeViewResolutions.has(viewKey)) {
      throw new Error(`تم اكتشاف اعتماد دائري بين العروض أثناء قراءة "${view.name}".`);
    }

    let viewResult: SelectInternalResult | null = null;
    activeViewResolutions.add(viewKey);
    try {
      viewResult = executeQueryWithSetOperators(view.definition, engineState);
    } finally {
      activeViewResolutions.delete(viewKey);
    }
    if (!viewResult) throw new Error(`تعذر تنفيذ تعريف العرض "${view.name}".`);
    if (viewResult.error) throw new Error(`تعذر تنفيذ العرض "${view.name}": ${viewResult.error}`);

    const colNames = viewResult.columns;
    const rows: StoredRow[] = viewResult.rows.map((resultRow) => {
      const obj: StoredRow = {};
      colNames.forEach((columnName, index) => {
        const value = parseValue(resultRow[index] ?? 'NULL');
        obj[`${tableName}.${columnName}`] = value;
        obj[`${alias}.${columnName}`] = value;
        obj[`${sourceId}::${columnName}`] = value;
        obj[columnName] = value;
      });
      return obj;
    });

    return { alias, tableName, sourceId, columns: colNames, rows };
  }

  const colNames = table.columns.map((c) => c.name);

  const rows: StoredRow[] = table.rows.map((r) => {
    const obj: StoredRow = {};
    for (const col of table.columns) {
      const val = r[col.name] ?? null;
      obj[`${tableName}.${col.name}`] = val;
      obj[`${alias}.${col.name}`] = val;
      obj[`${sourceId}::${col.name}`] = val;
      obj[col.name] = val;
    }
    return obj;
  });

  return { alias, tableName, sourceId, columns: colNames, rows };
}

interface ProcessedFrom {
  rows: StoredRow[];
  sources: ParsedTableSource[];
}

function processFromAndJoins(
  fromClause: string,
  database: DatabaseModel,
  engineState: EngineState,
  outerRow?: StoredRow
): ProcessedFrom {
  const joinRegex = /\b(INNER|LEFT(?:\s+OUTER)?|RIGHT(?:\s+OUTER)?|FULL(?:\s+OUTER)?|CROSS)\s+JOIN\b|\bJOIN\b/gi;

  const joinMatches: { type: string; index: number }[] = [];
  let match: RegExpExecArray | null;

  while ((match = joinRegex.exec(fromClause)) !== null) {
    let joinType = match[1] ? match[1].toUpperCase() : 'INNER';
    if (joinType.includes('LEFT')) joinType = 'LEFT';
    else if (joinType.includes('RIGHT')) joinType = 'RIGHT';
    else if (joinType.includes('FULL')) joinType = 'FULL';
    joinMatches.push({ type: joinType, index: match.index });
  }

  if (joinMatches.length === 0) {
    const singleSource = parseTableSource(fromClause, database, engineState, outerRow, 0);
    return { rows: singleSource.rows, sources: [singleSource] };
  }

  const firstSourceStr = fromClause.slice(0, joinMatches[0].index);
  const firstParsed = parseTableSource(firstSourceStr, database, engineState, outerRow, 0);
  let currentRows = firstParsed.rows;
  const sources: ParsedTableSource[] = [firstParsed];

  for (let i = 0; i < joinMatches.length; i += 1) {
    const currentJoin = joinMatches[i];
    const nextIndex = i + 1 < joinMatches.length ? joinMatches[i + 1].index : fromClause.length;
    const joinSegment = fromClause.slice(currentJoin.index, nextIndex);

    const onIndex = findKeywordOutside(joinSegment, 'ON');
    let rightSourceStr = '';
    let onCondition = '';

    if (onIndex >= 0) {
      rightSourceStr = joinSegment.slice(0, onIndex).replace(/^.*?JOIN\s+/i, '');
      onCondition = joinSegment.slice(onIndex + 2).trim();
    } else {
      rightSourceStr = joinSegment.replace(/^.*?JOIN\s+/i, '');
    }

    const rightSource = parseTableSource(rightSourceStr, database, engineState, outerRow, i + 1);
    sources.push(rightSource);

    const joinedRows: StoredRow[] = [];

    const rightNullRow: StoredRow = {};
    for (const c of rightSource.columns) {
      rightNullRow[`${rightSource.tableName}.${c}`] = null;
      rightNullRow[`${rightSource.alias}.${c}`] = null;
      rightNullRow[`${rightSource.sourceId}::${c}`] = null;
      rightNullRow[c] = null;
    }

    const matchedRightIndices = new Set<number>();

    for (const leftRow of currentRows) {
      let matchedAnyRight = false;

      rightSource.rows.forEach((rightRow, rIdx) => {
        const combinedRow: StoredRow = { ...leftRow, ...rightRow };

        const isMatch = onCondition ? Boolean(evaluateExpression(onCondition, combinedRow, outerRow, engineState)) : true;

        if (isMatch) {
          matchedAnyRight = true;
          matchedRightIndices.add(rIdx);
          joinedRows.push(combinedRow);
        }
      });

      if (!matchedAnyRight && (currentJoin.type === 'LEFT' || currentJoin.type === 'FULL')) {
        joinedRows.push({ ...leftRow, ...rightNullRow });
      }
    }

    if (currentJoin.type === 'RIGHT' || currentJoin.type === 'FULL') {
      const leftNullRow: StoredRow = {};
      for (const s of sources.slice(0, -1)) {
        for (const c of s.columns) {
          leftNullRow[`${s.tableName}.${c}`] = null;
          leftNullRow[`${s.alias}.${c}`] = null;
          leftNullRow[`${s.sourceId}::${c}`] = null;
          leftNullRow[c] = null;
        }
      }

      rightSource.rows.forEach((rightRow, rIdx) => {
        if (!matchedRightIndices.has(rIdx)) {
          joinedRows.push({ ...leftNullRow, ...rightRow });
        }
      });
    }

    currentRows = joinedRows;
  }

  return { rows: currentRows, sources };
}

/* ==========================================================================
   SELECT QUERY EXECUTION ENGINE
   ========================================================================== */

interface SelectInternalResult {
  columns: string[];
  rows: string[][];
  error?: string;
}

function executeSelectInternal(sql: string, engineState: EngineState, outerRow?: StoredRow): SelectInternalResult {
  const database = databaseFor(engineState);

  // Allow SELECT without FROM clause (e.g., SELECT ABS(-15), GETDATE())
  const fromIdx = findKeywordOutside(sql, 'FROM');
  let projectionPart = '';
  let rest = '';

  if (fromIdx < 0) {
    if (/^SELECT\b/i.test(sql)) {
      projectionPart = sql.replace(/^SELECT\s+/i, '').trim();
    } else {
      return { columns: [], rows: [], error: `صيغة SELECT غير صالحة: ${sql}` };
    }
  } else {
    projectionPart = sql.slice(6, fromIdx).trim();
    rest = sql.slice(fromIdx + 4).trim();
  }

  const whereIdx = findKeywordOutside(rest, 'WHERE');
  const groupIdx = findKeywordOutside(rest, 'GROUP BY');
  const havingIdx = findKeywordOutside(rest, 'HAVING');
  const orderIdx = findKeywordOutside(rest, 'ORDER BY');

  const indices = [
    { name: 'WHERE', idx: whereIdx },
    { name: 'GROUP BY', idx: groupIdx },
    { name: 'HAVING', idx: havingIdx },
    { name: 'ORDER BY', idx: orderIdx },
  ]
    .filter((i) => i.idx >= 0)
    .sort((a, b) => a.idx - b.idx);

  const getClauseBody = (name: string, keywordLen: number) => {
    const item = indices.find((i) => i.name === name);
    if (!item) return '';
    const start = item.idx + keywordLen;
    const nextItem = indices.find((i) => i.idx > item.idx);
    const end = nextItem ? nextItem.idx : rest.length;
    return rest.slice(start, end).trim();
  };

  const fromClause = fromIdx >= 0 ? (indices.length > 0 ? rest.slice(0, indices[0].idx).trim() : rest.trim()) : '';
  const whereClause = getClauseBody('WHERE', 5);
  const groupByClause = getClauseBody('GROUP BY', 8);
  const havingClause = getClauseBody('HAVING', 6);
  const orderByClause = getClauseBody('ORDER BY', 8);

  const isDistinct = /^DISTINCT\b/i.test(projectionPart);
  if (isDistinct) projectionPart = projectionPart.replace(/^DISTINCT\s+/i, '').trim();

  const topMatch = projectionPart.match(/^TOP\s+(\d+)\s+([\s\S]+)$/i);
  const topLimit = topMatch ? Number.parseInt(topMatch[1], 10) : null;
  if (topMatch) projectionPart = topMatch[2].trim();

  // 1. Process FROM and JOINs
  let rows: StoredRow[] = [];
  let sources: ParsedTableSource[] = [];

  if (fromClause) {
    if (!database) return { columns: [], rows: [], error: 'اختر قاعدة بيانات أولًا باستخدام USE أو أنشئ قاعدة جديدة.' };
    try {
      const res = processFromAndJoins(fromClause, database, engineState, outerRow);
      rows = res.rows;
      sources = res.sources;
    } catch (err: unknown) {
      return { columns: [], rows: [], error: err instanceof Error ? err.message : String(err) };
    }
  } else {
    rows = [{}];
    sources = [];
  }

  const sampleValidationRow: StoredRow = rows[0] ? { ...rows[0] } : {};
  if (rows.length === 0 && sources.length > 0) {
    // Validate SELECT expressions against schema metadata even when a source table is empty.
    const columnCounts = new Map<string, number>();
    for (const source of sources) {
      for (const columnName of source.columns) {
        const columnKey = keyOf(columnName);
        columnCounts.set(columnKey, (columnCounts.get(columnKey) ?? 0) + 1);
        sampleValidationRow[`${source.tableName}.${columnName}`] = null;
        sampleValidationRow[`${source.alias}.${columnName}`] = null;
        sampleValidationRow[`${source.sourceId}::${columnName}`] = null;
      }
    }
    for (const source of sources) {
      for (const columnName of source.columns) {
        if (columnCounts.get(keyOf(columnName)) === 1) {
          sampleValidationRow[columnName] = null;
        }
      }
    }
  }

  // 2. WHERE Filtering
  if (whereClause) {
    try {
      evaluateExpression(whereClause, sampleValidationRow, outerRow, engineState);
      rows = rows.filter((r) => Boolean(evaluateExpression(whereClause, r, outerRow, engineState)));
    } catch (err: unknown) {
      return { columns: [], rows: [], error: err instanceof Error ? err.message : String(err) };
    }
  }

  // 3. Projection Items Parsing & Wildcard (`*`, `s.*`) Expansion
  const projItems: { expr: string; alias: string }[] = [];

  for (const item of splitTopLevel(projectionPart)) {
    const trimmed = item.trim();
    if (trimmed === '*') {
      if (sources.length > 0) {
        for (const s of sources) {
          for (const c of s.columns) {
            projItems.push({ expr: `${s.alias}.${c}`, alias: c });
          }
        }
      }
    } else {
      const tableWildcardMatch = trimmed.match(/^([[\]\w.-]+)\.\*$/i);
      if (tableWildcardMatch) {
        const sourceAlias = cleanName(tableWildcardMatch[1]);
        const matchedSource = sources.find((s) => keyOf(s.alias) === keyOf(sourceAlias) || keyOf(s.tableName) === keyOf(sourceAlias));
        if (!matchedSource) {
          return { columns: [], rows: [], error: `الجدول أو Alias "${sourceAlias}" غير موجود في الاستعلام.` };
        }
        for (const c of matchedSource.columns) {
          projItems.push({ expr: `${matchedSource.alias}.${c}`, alias: c });
        }
      } else {
        const asMatch = trimmed.match(/^([\s\S]+?)\s+AS\s+([[\]\w.-]+)$/i) || trimmed.match(/^([\s\S]+?)\s+([[\]\w.-]+)$/i);
        let exprStr = trimmed;
        let alias = trimmed;

        if (asMatch && !/\b(END|THEN|ELSE)\b/i.test(asMatch[2])) {
          exprStr = asMatch[1].trim();
          alias = cleanName(asMatch[2]);
        } else {
          const simpleNameMatch = trimmed.match(/^([[\]\w.-]+)$/);
          if (simpleNameMatch) alias = cleanName(simpleNameMatch[1]);
        }
        projItems.push({ expr: exprStr, alias });
      }
    }
  }

  for (const item of projItems) {
    try {
      evaluateExpression(item.expr, sampleValidationRow, outerRow, engineState, []);
    } catch (err: unknown) {
      return { columns: [], rows: [], error: err instanceof Error ? err.message : String(err) };
    }
  }

  const hasAggregates = projItems.some((p) => /\b(COUNT|SUM|AVG|MAX|MIN)\b/i.test(p.expr)) || /\b(COUNT|SUM|AVG|MAX|MIN)\b/i.test(havingClause);

  let groupedData: { key: string; groupRows: StoredRow[]; sampleRow: StoredRow }[] = [];

  if (groupByClause) {
    const groupExprs = splitTopLevel(groupByClause);
    const groupsMap = new Map<string, { groupRows: StoredRow[]; sampleRow: StoredRow }>();

    for (const r of rows) {
      const groupKey = groupExprs.map((ge) => valueToText(evaluateExpression(ge, r, outerRow, engineState))).join('|');
      if (!groupsMap.has(groupKey)) {
        groupsMap.set(groupKey, { groupRows: [], sampleRow: r });
      }
      groupsMap.get(groupKey)!.groupRows.push(r);
    }

    groupedData = Array.from(groupsMap.entries()).map(([key, value]) => ({ key, ...value }));
  } else if (hasAggregates) {
    groupedData = [{ key: 'GLOBAL', groupRows: rows, sampleRow: rows[0] ?? {} }];
  } else {
    groupedData = rows.map((r) => ({ key: '', groupRows: [r], sampleRow: r }));
  }

  // 4. HAVING Filtering
  if (havingClause) {
    if (!groupByClause && !hasAggregates) {
      return { columns: [], rows: [], error: 'استخدام HAVING يتطلب GROUP BY أو دالة تجميعية (Aggregate Function).' };
    }
    try {
      groupedData = groupedData.filter((g) =>
        Boolean(evaluateExpression(havingClause, g.sampleRow, outerRow, engineState, g.groupRows))
      );
    } catch (err: unknown) {
      return { columns: [], rows: [], error: err instanceof Error ? err.message : String(err) };
    }
  }

  // 5. Projection
  const outputColumns: string[] = projItems.map((p) => p.alias);
  let resultGrid: string[][] = [];

  try {
    resultGrid = groupedData.map((g) =>
      projItems.map((p) => valueToText(evaluateExpression(p.expr, g.sampleRow, outerRow, engineState, g.groupRows)))
    );
  } catch (err: unknown) {
    return { columns: [], rows: [], error: err instanceof Error ? err.message : String(err) };
  }

  // 6. DISTINCT
  if (isDistinct) {
    const seen = new Set<string>();
    resultGrid = resultGrid.filter((rowGrid) => {
      const sig = rowGrid.join('||');
      if (seen.has(sig)) return false;
      seen.add(sig);
      return true;
    });
  }

  // 7. ORDER BY
  if (orderByClause) {
    const orderSpecs = splitTopLevel(orderByClause).map((item) => {
      const orderMatch = item.match(/^([\s\S]+?)(?:\s+(ASC|DESC))?$/i);
      const expr = orderMatch ? orderMatch[1].trim() : item.trim();
      const dir = orderMatch && orderMatch[2]?.toUpperCase() === 'DESC' ? -1 : 1;
      return { expr, dir };
    });

    resultGrid.sort((a, b) => {
      for (const spec of orderSpecs) {
        const colIdx = outputColumns.findIndex((col) => keyOf(col) === keyOf(spec.expr));
        let valA: SqlValue = colIdx >= 0 ? parseValue(a[colIdx]) : null;
        let valB: SqlValue = colIdx >= 0 ? parseValue(b[colIdx]) : null;

        if (colIdx < 0 && rows.length > 0) {
          const sampleRowA = groupedData[resultGrid.indexOf(a)]?.sampleRow ?? {};
          const sampleRowB = groupedData[resultGrid.indexOf(b)]?.sampleRow ?? {};
          valA = evaluateExpression(spec.expr, sampleRowA, outerRow, engineState);
          valB = evaluateExpression(spec.expr, sampleRowB, outerRow, engineState);
        }

        if (valA === valB) continue;
        const comp = compareValues(valA, '>', valB) === true ? 1 : -1;
        return comp * spec.dir;
      }
      return 0;
    });
  }

  // 8. TOP Limit
  if (topLimit !== null && topLimit >= 0) {
    resultGrid = resultGrid.slice(0, topLimit);
  }

  return { columns: outputColumns, rows: resultGrid };
}

/* ==========================================================================
   SET OPERATORS (UNION, UNION ALL, INTERSECT, EXCEPT)
   ========================================================================== */

function executeQueryWithSetOperators(sql: string, engineState: EngineState): SelectInternalResult {
  const setRegex = /\b(UNION\s+ALL|UNION|INTERSECT|EXCEPT)\b/gi;
  const matches: { operator: string; index: number }[] = [];
  let m: RegExpExecArray | null;

  let searchPos = 0;
  while ((m = setRegex.exec(sql)) !== null) {
    const foundIdx = findKeywordOutside(sql, m[1], searchPos);
    if (foundIdx === m.index) {
      matches.push({ operator: m[1].toUpperCase().replace(/\s+/, ' '), index: m.index });
      searchPos = m.index + m[0].length;
    }
  }

  if (matches.length === 0) {
    return executeSelectInternal(sql, engineState);
  }

  const queries: string[] = [];
  let prevIdx = 0;
  for (const item of matches) {
    queries.push(sql.slice(prevIdx, item.index).trim());
    prevIdx = item.index + item.operator.length;
  }
  queries.push(sql.slice(prevIdx).trim());

  let accumulated = executeSelectInternal(queries[0], engineState);
  if (accumulated.error) return accumulated;

  for (let i = 0; i < matches.length; i += 1) {
    const op = matches[i].operator;
    const nextRes = executeSelectInternal(queries[i + 1], engineState);
    if (nextRes.error) return nextRes;

    if (accumulated.columns.length !== nextRes.columns.length) {
      return { columns: [], rows: [], error: `عدد الأعمدة غير متطابق في عملية ${op} (${accumulated.columns.length} مقابل ${nextRes.columns.length}).` };
    }

    if (op === 'UNION ALL') {
      accumulated.rows = [...accumulated.rows, ...nextRes.rows];
    } else if (op === 'UNION') {
      const combined = [...accumulated.rows, ...nextRes.rows];
      const seen = new Set<string>();
      accumulated.rows = combined.filter((r) => {
        const sig = r.join('||');
        if (seen.has(sig)) return false;
        seen.add(sig);
        return true;
      });
    } else if (op === 'INTERSECT') {
      const rightSet = new Set(nextRes.rows.map((r) => r.join('||')));
      const seen = new Set<string>();
      accumulated.rows = accumulated.rows.filter((r) => {
        const sig = r.join('||');
        if (rightSet.has(sig) && !seen.has(sig)) {
          seen.add(sig);
          return true;
        }
        return false;
      });
    } else if (op === 'EXCEPT') {
      const rightSet = new Set(nextRes.rows.map((r) => r.join('||')));
      const seen = new Set<string>();
      accumulated.rows = accumulated.rows.filter((r) => {
        const sig = r.join('||');
        if (!rightSet.has(sig) && !seen.has(sig)) {
          seen.add(sig);
          return true;
        }
        return false;
      });
    }
  }

  return accumulated;
}

/* ==========================================================================
   STATEMENT EXECUTION ENGINE
   ========================================================================== */

function success(state: EngineState, start: number, partial?: Partial<ExecutionResult>): ExecutionResult {
  return {
    columns: partial?.columns ?? [],
    rows: partial?.rows ?? [],
    affectedRows: partial?.affectedRows ?? 0,
    messages: partial?.messages ?? [],
    errors: partial?.errors ?? [],
    durationMs: Date.now() - start,
    database: state.currentDatabase,
  };
}

function errorResult(state: EngineState, start: number, message: string): ExecutionResult {
  return success(state, start, { errors: [message] });
}

function validateColumnsInTable(table: TableModel, columnNames: string[]): string | null {
  for (const colName of columnNames) {
    const found = table.columns.some((col) => keyOf(col.name) === keyOf(colName));
    if (!found) {
      return `العمود "${colName}" غير موجود في الجدول "${table.name}".`;
    }
  }
  return null;
}


function coerceColumnValue(value: SqlValue, column: ColumnModel): SqlValue {
  if (value === null) {
    if (!column.nullable) throw new Error('العمود "' + column.name + '" لا يقبل NULL.');
    return null;
  }

  const compactType = column.type.toUpperCase().replace(/\s+/g, '');
  const baseType = compactType.match(/^[A-Z]+/)?.[0] ?? compactType;

  if (['CHAR', 'NCHAR', 'VARCHAR', 'NVARCHAR', 'TEXT', 'NTEXT'].includes(baseType)) {
    const textValue = String(value);
    const lengthMatch = compactType.match(/\((\d+)\)/);
    if (lengthMatch && textValue.length > Number(lengthMatch[1])) {
      throw new Error('قيمة العمود "' + column.name + '" تتجاوز الحد الأقصى للطول ' + lengthMatch[1] + '.');
    }
    return textValue;
  }

  if (['TINYINT', 'SMALLINT', 'INT', 'BIGINT'].includes(baseType)) {
    const numericValue = typeof value === 'number' ? value : Number(value);
    if (!Number.isSafeInteger(numericValue)) {
      throw new Error('قيمة العمود "' + column.name + '" يجب أن تكون عددًا صحيحًا من النوع ' + baseType + '.');
    }
    const ranges: Record<string, [number, number]> = {
      TINYINT: [0, 255],
      SMALLINT: [-32768, 32767],
      INT: [-2147483648, 2147483647],
      BIGINT: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    };
    const range = ranges[baseType];
    if (numericValue < range[0] || numericValue > range[1]) {
      throw new Error('قيمة العمود "' + column.name + '" خارج نطاق النوع ' + baseType + '.');
    }
    return numericValue;
  }

  if (['DECIMAL', 'NUMERIC', 'FLOAT', 'REAL', 'MONEY', 'SMALLMONEY'].includes(baseType)) {
    const numericValue = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numericValue)) {
      throw new Error('قيمة العمود "' + column.name + '" يجب أن تكون رقمية من النوع ' + baseType + '.');
    }
    return numericValue;
  }

  if (baseType === 'BIT') {
    if (typeof value === 'boolean') return value ? 1 : 0;
    const numericValue = Number(value);
    if (numericValue !== 0 && numericValue !== 1) {
      throw new Error('النوع BIT يقبل القيمتين 0 أو 1 فقط في العمود "' + column.name + '".');
    }
    return numericValue;
  }

  if (['DATE', 'DATETIME', 'DATETIME2', 'SMALLDATETIME', 'DATETIMEOFFSET'].includes(baseType)) {
    if (!parseSqlDate(value)) {
      throw new Error('قيمة التاريخ في العمود "' + column.name + '" غير صالحة.');
    }
    return String(value);
  }

  if (baseType === 'TIME') {
    const timeValue = String(value);
    if (!/^\d{1,2}:\d{2}(:\d{2}(?:\.\d+)?)?$/.test(timeValue)) {
      throw new Error('قيمة الوقت في العمود "' + column.name + '" غير صالحة.');
    }
    return timeValue;
  }

  return value;
}

function validateTableRows(table: TableModel, rows: StoredRow[]): string | null {
  const primaryKeyColumns = table.primaryKeyColumns?.length
    ? table.primaryKeyColumns
    : table.columns.filter((column) => column.primaryKey).map((column) => column.name);

  for (const column of table.columns) {
    for (const row of rows) {
      const value = row[column.name] ?? null;
      if (!column.nullable && value === null) {
        return 'العمود "' + column.name + '" لا يقبل NULL.';
      }
    }
  }

  const uniqueRules = [
    ...table.columns.filter((column) => column.unique).map((column) => [column.name]),
    ...(table.uniqueConstraints ?? []),
    ...(table.indexes ?? []).filter((index) => index.unique).map((index) => index.columns),
    ...(primaryKeyColumns.length ? [primaryKeyColumns] : []),
  ];
  const checkedRules = new Set<string>();

  for (const columns of uniqueRules) {
    const normalizedColumns = columns.map(keyOf);
    const ruleId = normalizedColumns.join("|");
    if (checkedRules.has(ruleId)) continue;
    checkedRules.add(ruleId);

    const values = new Set<string>();
    for (const row of rows) {
      const keyValues = columns.map((columnName) => {
        const column = table.columns.find((item) => keyOf(item.name) === keyOf(columnName));
        const value = column ? row[column.name] ?? null : null;
        if (typeof value === "string") return "string:" + value.toLocaleLowerCase();
        if (value === null) return "null:";
        return typeof value + ":" + String(value);
      });
      const key = JSON.stringify(keyValues);
      if (values.has(key)) {
        return 'قيمة مكررة في قيد UNIQUE أو PRIMARY KEY (' + columns.join(", ") + ').';
      }
      values.add(key);
    }
  }

  return null;
}
function sameSqlValue(left: SqlValue, right: SqlValue): boolean {
  if (left === null || right === null) return left === right;
  if (typeof left === "string" && typeof right === "string") {
    return left.toLocaleLowerCase() === right.toLocaleLowerCase();
  }
  return left === right;
}

function areForeignKeyTypesCompatible(sourceType: string, targetType: string): boolean {
  const normalize = (type: string) => type.toUpperCase().replace(/\s+/g, '').replace(/\(.*/, '');
  const source = normalize(sourceType);
  const target = normalize(targetType);
  if (source === target) return true;

  const compatibleFamilies = [
    ['CHAR', 'NCHAR', 'VARCHAR', 'NVARCHAR'],
    ['TINYINT', 'SMALLINT', 'INT', 'BIGINT', 'DECIMAL', 'NUMERIC', 'FLOAT', 'REAL', 'MONEY', 'SMALLMONEY'],
    ['DATE', 'DATETIME', 'DATETIME2', 'SMALLDATETIME', 'DATETIMEOFFSET'],
  ];
  return compatibleFamilies.some((family) => family.includes(source) && family.includes(target));
}

function validateForeignKeyDefinition(
  database: DatabaseModel,
  sourceTable: TableModel,
  foreignKey: ForeignKeyModel
): string | null {
  const sourceColumn = sourceTable.columns.find((column) => keyOf(column.name) === keyOf(foreignKey.column));
  if (!sourceColumn) {
    return 'عمود المفتاح الخارجي "' + foreignKey.column + '" غير موجود في الجدول "' + sourceTable.name + '".';
  }

  const referencedTable = keyOf(foreignKey.referencedTable) === keyOf(sourceTable.name)
    ? sourceTable
    : tableFor(database, foreignKey.referencedTable);
  if (!referencedTable) {
    return 'الجدول المشار إليه "' + foreignKey.referencedTable + '" غير موجود في قاعدة البيانات الحالية.';
  }

  const referencedColumn = referencedTable.columns.find((column) => keyOf(column.name) === keyOf(foreignKey.referencedColumn));
  if (!referencedColumn) {
    return 'العمود المشار إليه "' + foreignKey.referencedColumn + '" غير موجود في الجدول "' + referencedTable.name + '".';
  }
  if (!areForeignKeyTypesCompatible(sourceColumn.type, referencedColumn.type)) {
    return 'نوع عمود المفتاح الخارجي "' + sourceColumn.type + '" غير متوافق مع نوع العمود المرجعي "' + referencedColumn.type + '".';
  }

  const primaryKeyColumns = referencedTable.primaryKeyColumns?.length
    ? referencedTable.primaryKeyColumns
    : referencedTable.columns.filter((column) => column.primaryKey).map((column) => column.name);
  const isSingleColumnPrimaryKey = primaryKeyColumns.length === 1
    && keyOf(primaryKeyColumns[0]) === keyOf(referencedColumn.name);
  const isSingleColumnUnique = referencedColumn.unique
    || (referencedTable.uniqueConstraints ?? []).some((columns) =>
      columns.length === 1 && keyOf(columns[0]) === keyOf(referencedColumn.name)
    );

  if (!isSingleColumnPrimaryKey && !isSingleColumnUnique) {
    return 'يجب أن يشير المفتاح الخارجي إلى عمود يحمل PRIMARY KEY أو UNIQUE منفردًا.';
  }

  return null;
}

function validateForeignKeyRows(database: DatabaseModel, table: TableModel, rows: StoredRow[]): string | null {
  for (const foreignKey of table.foreignKeys ?? []) {
    const definitionError = validateForeignKeyDefinition(database, table, foreignKey);
    if (definitionError) return definitionError;

    const parentTable = keyOf(foreignKey.referencedTable) === keyOf(table.name)
      ? table
      : tableFor(database, foreignKey.referencedTable);
    if (!parentTable) return 'الجدول المشار إليه "' + foreignKey.referencedTable + '" غير موجود.';

    const sourceColumn = table.columns.find((column) => keyOf(column.name) === keyOf(foreignKey.column));
    const parentColumn = parentTable.columns.find((column) => keyOf(column.name) === keyOf(foreignKey.referencedColumn));
    if (!sourceColumn || !parentColumn) return 'تعريف المفتاح الخارجي "' + foreignKey.name + '" غير مكتمل.';

    for (const row of rows) {
      const value = row[sourceColumn.name] ?? null;
      if (value === null) continue;
      const referencedRows = keyOf(parentTable.name) === keyOf(table.name)
        ? rows
        : parentTable.rows;
      const exists = referencedRows.some((parentRow) =>
        sameSqlValue(parentRow[parentColumn.name] ?? null, value)
      );
      if (!exists) {
        return 'القيمة في العمود "' + sourceColumn.name + '" لا تطابق أي قيمة في الجدول "' + parentTable.name + '"؛ القيد "' + foreignKey.name + '" يمنع الإدخال أو التعديل.';
      }
    }
  }

  return null;
}

function validateReferencedRows(database: DatabaseModel, parentTable: TableModel, candidateRows: StoredRow[]): string | null {
  for (const childTable of Object.values(database.tables)) {
    for (const foreignKey of childTable.foreignKeys ?? []) {
      if (keyOf(foreignKey.referencedTable) !== keyOf(parentTable.name)) continue;

      const parentColumn = parentTable.columns.find((column) => keyOf(column.name) === keyOf(foreignKey.referencedColumn));
      const childColumn = childTable.columns.find((column) => keyOf(column.name) === keyOf(foreignKey.column));
      if (!parentColumn || !childColumn) continue;

      const childRows = keyOf(childTable.name) === keyOf(parentTable.name)
        ? candidateRows
        : childTable.rows;
      for (const childRow of childRows) {
        const childValue = childRow[childColumn.name] ?? null;
        if (childValue === null) continue;
        const stillExists = candidateRows.some((parentRow) =>
          sameSqlValue(parentRow[parentColumn.name] ?? null, childValue)
        );
        if (!stillExists) {
          return 'لا يمكن حذف أو تعديل القيمة المشار إليها في الجدول "' + parentTable.name + '"؛ توجد سجلات مرتبطة بالقيد الخارجي "' + foreignKey.name + '".';
        }
      }
    }
  }

  return null;
}

function checkExpressionReferencesColumn(expression: string, columnName: string): boolean {
  const escaped = columnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp('(^|[^A-Za-z0-9_])\\[?' + escaped + '\\]?(?=$|[^A-Za-z0-9_])', 'i');
  return pattern.test(expression);
}

function validateCheckConstraints(
  table: TableModel,
  rows: StoredRow[],
  engineState: EngineState
): string | null {
  for (const constraint of table.checkConstraints ?? []) {
    for (const row of rows) {
      try {
        const value = evaluateExpression(constraint.expression, row, undefined, engineState);
        // SQL CHECK accepts TRUE and UNKNOWN (NULL); only FALSE violates it.
        if (value === false || value === 0) {
          return 'فشل قيد CHECK "' + constraint.name + '"؛ التعبير "' + constraint.expression + '" غير محقق.';
        }
      } catch (error) {
        return 'تعذر تقييم قيد CHECK "' + constraint.name + '": ' + (error instanceof Error ? error.message : String(error));
      }
    }
  }
  return null;
}

function executeStatement(state: EngineState, statement: string): ExecutionResult {
  const start = Date.now();
  const sql = statement.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '').trim();

  // 1. CREATE DATABASE
  let match = sql.match(/^CREATE\s+DATABASE\s+([[\]\w-]+)$/i);
  if (match) {
    const name = cleanName(match[1]);
    if (state.databases[keyOf(name)]) return errorResult(state, start, `قاعدة البيانات "${name}" موجودة بالفعل.`);
    state.databases[keyOf(name)] = { name, tables: {} };
    return success(state, start, { messages: [`تم إنشاء قاعدة البيانات ${name}.`] });
  }

  // 2. DROP DATABASE [IF EXISTS]
  match = sql.match(/^DROP\s+DATABASE\s+(IF\s+EXISTS\s+)?([[\]\w-]+)$/i);
  if (match) {
    const ifExists = Boolean(match[1]);
    const name = cleanName(match[2]);
    const databaseKey = keyOf(name);
    const targetDatabase = state.databases[databaseKey];

    if (!targetDatabase) {
      return ifExists
        ? success(state, start, { messages: ['قاعدة البيانات "' + name + '" غير موجودة؛ لم يحدث أي تغيير.'] })
        : errorResult(state, start, 'قاعدة البيانات "' + name + '" غير موجودة.');
    }

    // SQL Server does not allow dropping the database used by the current session.
    if (keyOf(state.currentDatabase ?? '') === databaseKey) {
      return errorResult(state, start, 'لا يمكن حذف قاعدة البيانات الحالية "' + targetDatabase.name + '". نفّذ USE على قاعدة بيانات أخرى أولاً.');
    }

    delete state.databases[databaseKey];
    return success(state, start, { messages: ['تم حذف قاعدة البيانات ' + targetDatabase.name + '.'] });
  }

  // 3. USE DATABASE
  match = sql.match(/^USE\s+([[\]\w-]+)$/i);
  if (match) {
    const name = cleanName(match[1]);
    const targetDatabase = state.databases[keyOf(name)];
    if (!targetDatabase) return errorResult(state, start, 'قاعدة البيانات "' + name + '" غير موجودة.');
    state.currentDatabase = targetDatabase.name;
    return success(state, start, { messages: ['قاعدة البيانات الحالية: ' + targetDatabase.name + '.'] });
  }

  const database = databaseFor(state);
  if (!database) return errorResult(state, start, 'اختر قاعدة بيانات أولًا باستخدام USE أو أنشئ قاعدة جديدة.');

  // CREATE SCHEMA: this stage registers empty schemas; object placement/transfer is a later capability.
  match = sql.match(/^CREATE\s+SCHEMA\s+([[\]\w-]+)$/i);
  if (match) {
    const schemaName = cleanName(match[1]);
    const schemaKey = keyOf(schemaName);
    if (schemaKey === 'dbo' || database.schemas?.[schemaKey]) {
      return errorResult(state, start, 'المخطط "' + schemaName + '" موجود بالفعل.');
    }
    database.schemas ??= {};
    database.schemas[schemaKey] = { name: schemaName };
    return success(state, start, { messages: ['تم إنشاء المخطط الفارغ "' + schemaName + '".'] });
  }

  // DROP SCHEMA [IF EXISTS]: dbo is a permanent default schema.
  match = sql.match(/^DROP\s+SCHEMA\s+(IF\s+EXISTS\s+)?([[\]\w-]+)$/i);
  if (match) {
    const ifExists = Boolean(match[1]);
    const schemaName = cleanName(match[2]);
    const schemaKey = keyOf(schemaName);
    const schema = schemaKey === 'dbo' ? { name: 'dbo' } : database.schemas?.[schemaKey];
    if (!schema) {
      return ifExists
        ? success(state, start, { messages: ['المخطط "' + schemaName + '" غير موجود؛ لم يحدث أي تغيير.'] })
        : errorResult(state, start, 'المخطط "' + schemaName + '" غير موجود.');
    }
    if (schemaKey === 'dbo') {
      return errorResult(state, start, 'لا يمكن حذف المخطط الافتراضي dbo.');
    }
    const ownsTable = Object.values(database.tables).some((table) => keyOf(table.schema ?? 'dbo') === schemaKey);
    const ownsView = Object.values(database.views ?? {}).some((view) => keyOf(view.schema ?? 'dbo') === schemaKey);
    if (ownsTable || ownsView) {
      return errorResult(state, start, 'لا يمكن حذف المخطط "' + schemaName + '" لأنه يحتوي على كائنات.');
    }
    delete database.schemas![schemaKey];
    if (Object.keys(database.schemas!).length === 0) delete database.schemas;
    return success(state, start, { messages: ['تم حذف المخطط "' + schema.name + '".'] });
  }

  if (/^ALTER\s+SCHEMA\b/i.test(sql)) {
    return errorResult(state, start, 'ALTER SCHEMA TRANSFER غير مدعوم بعد؛ نقل الجداول والعروض بين المخططات لم يُنفذ في هذا الإصدار.');
  }

  // Educational, read-only subset of SQL Server system procedures.
  // The simulator returns one tabular result set rather than SQL Server's multiple result sets.

  const readProcedureTarget = (rawArgument: string | undefined): string | null => {
    if (!rawArgument) return null;
    const withoutNamedArgument = rawArgument.trim().replace(/^@(objname|table_name)\s*=\s*/i, '');
    const parsed = parseValue(withoutNamedArgument);
    const rawName = typeof parsed === 'string' ? parsed : withoutNamedArgument;
    const parts = cleanName(rawName).split('.');
    return cleanName(parts[parts.length - 1]);
  };

  match = sql.match(/^EXEC(?:UTE)?\s+sp_help(?:\s+([\s\S]+))?$/i);
  if (match) {
    const targetName = readProcedureTarget(match[1]);
    const objects = [
      ...Object.values(database.tables).map((table) => ({ name: table.name, type: 'TABLE' as const, table })),
      ...Object.values(database.views ?? {}).map((view) => ({ name: view.name, type: 'VIEW' as const, view })),
    ];

    if (!targetName) {
      const columns = ['ObjectName', 'ObjectType', 'ColumnCount', 'RowCount'];
      const rows = objects
        .sort((left, right) => keyOf(left.name).localeCompare(keyOf(right.name)))
        .map((item) => ({
          ObjectName: item.name,
          ObjectType: item.type,
          ColumnCount: item.type === 'TABLE' ? item.table.columns.length : (item.view.columns ?? []).length,
          RowCount: item.type === 'TABLE' ? item.table.rows.length : null,
        }));
      return success(state, start, {
        columns,
        rows: rows.map((row) => columns.map((column) => valueToText(row[column as keyof typeof row] ?? null))),
        messages: ['sp_help: ملخص تعليمي للكائنات في قاعدة البيانات الحالية.'],
      });
    }

    const table = tableFor(database, targetName);
    const view = database.views?.[keyOf(targetName)];
    if (!table && !view) {
      return errorResult(state, start, 'الكائن "' + targetName + '" غير موجود في قاعدة البيانات الحالية.');
    }

    const columns = [
      'ObjectName', 'ObjectType', 'ColumnOrdinal', 'ColumnName', 'DataType',
      'Nullable', 'PrimaryKey', 'Unique', 'Identity', 'DefaultValue',
    ];
    const rows: StoredRow[] = table
      ? table.columns.map((column, index) => ({
          ObjectName: table.name,
          ObjectType: 'TABLE',
          ColumnOrdinal: index + 1,
          ColumnName: column.name,
          DataType: column.type,
          Nullable: column.nullable ? 'YES' : 'NO',
          PrimaryKey: column.primaryKey ? 'YES' : 'NO',
          Unique: column.unique ? 'YES' : 'NO',
          Identity: column.identity ? 'YES' : 'NO',
          DefaultValue: column.defaultValue === undefined ? null : valueToText(column.defaultValue),
        }))
      : (view!.columns ?? []).map((columnName, index) => ({
          ObjectName: view!.name,
          ObjectType: 'VIEW',
          ColumnOrdinal: index + 1,
          ColumnName: columnName,
          DataType: null,
          Nullable: 'UNKNOWN',
          PrimaryKey: 'NO',
          Unique: 'NO',
          Identity: 'NO',
          DefaultValue: null,
        }));
    return success(state, start, {
      columns,
      rows: rows.map((row) => columns.map((column) => valueToText(row[column] ?? null))),
      messages: ['sp_help: بيانات وصفية تعليمية مبسطة؛ ليست جميع مجموعات نتائج SQL Server الأصلية.'],
    });
  }

  match = sql.match(/^EXEC(?:UTE)?\s+sp_tables(?:\s+([\s\S]+))?$/i);
  if (match) {
    const filterName = match[1] ? readProcedureTarget(match[1]) : null;
    const objects = [
      ...Object.values(database.tables).map((table) => ({ name: table.name, type: 'TABLE' })),
      ...Object.values(database.views ?? {}).map((view) => ({ name: view.name, type: 'VIEW' })),
    ]
      .filter((item) => !filterName || keyOf(item.name) === keyOf(filterName))
      .sort((left, right) => keyOf(left.name).localeCompare(keyOf(right.name)));
    const columns = ['TABLE_QUALIFIER', 'TABLE_OWNER', 'TABLE_NAME', 'TABLE_TYPE', 'REMARKS'];
    const rows = objects.map((item) => [database.name, 'dbo', item.name, item.type, 'NULL']);
    return success(state, start, {
      columns,
      rows,
      messages: ['sp_tables: قائمة تعليمية بالجداول والعروض ضمن المخطط dbo.'],
    });
  }

  // CREATE / ALTER VIEW: persist a validated SELECT definition, not a snapshot of rows.
  match = sql.match(/^CREATE\s+VIEW\s+([\[\]\w.-]+)\s+AS\s+([\s\S]+)$/i);
  if (match) {
    const viewName = cleanName(match[1]);
    const viewKey = keyOf(viewName);
    if (tableFor(database, viewName)) return errorResult(state, start, `لا يمكن إنشاء العرض "${viewName}" لأن الاسم مستخدم لجدول.`);
    if (database.views?.[viewKey]) return errorResult(state, start, `العرض "${viewName}" موجود بالفعل.`);
    const definition = match[2].trim();
    if (!/^SELECT\b/i.test(definition)) return errorResult(state, start, 'يجب أن يكون تعريف VIEW عبارة SELECT.');
    const validation = executeQueryWithSetOperators(definition, state);
    if (validation.error) return errorResult(state, start, `تعريف VIEW غير صالح: ${validation.error}`);
    const duplicateColumns = validation.columns.filter((column, index) =>
      validation.columns.findIndex((candidate) => keyOf(candidate) === keyOf(column)) !== index
    );
    if (duplicateColumns.length) return errorResult(state, start, `أسماء أعمدة العرض يجب أن تكون فريدة؛ الاسم المكرر: "${duplicateColumns[0]}".`);
    database.views ??= {};
    database.views[viewKey] = { name: viewName, definition, columns: validation.columns };
    return success(state, start, { messages: [`تم إنشاء العرض "${viewName}" بنجاح. يعاد تنفيذ تعريفه عند كل SELECT.`] });
  }

  match = sql.match(/^ALTER\s+VIEW\s+([\[\]\w.-]+)\s+AS\s+([\s\S]+)$/i);
  if (match) {
    const viewName = cleanName(match[1]);
    const viewKey = keyOf(viewName);
    const view = database.views?.[viewKey];
    if (!view) return errorResult(state, start, `العرض "${viewName}" غير موجود.`);
    const definition = match[2].trim();
    if (!/^SELECT\b/i.test(definition)) return errorResult(state, start, 'يجب أن يكون تعريف VIEW عبارة SELECT.');

    // Validate the candidate definition while it is active so circular view dependencies are detected.
    const previousDefinition = view.definition;
    view.definition = definition;
    let validation: SelectInternalResult | null = null;
    try {
      validation = executeQueryWithSetOperators(definition, state);
    } catch (error) {
      view.definition = previousDefinition;
      return errorResult(state, start, error instanceof Error ? error.message : String(error));
    }
    if (!validation || validation.error) {
      view.definition = previousDefinition;
      return errorResult(state, start, `تعريف VIEW غير صالح: ${validation?.error ?? 'تعذر التحقق من التعريف.'}`);
    }
    const duplicateColumns = validation.columns.filter((column, index) =>
      validation!.columns.findIndex((candidate) => keyOf(candidate) === keyOf(column)) !== index
    );
    if (duplicateColumns.length) {
      view.definition = previousDefinition;
      return errorResult(state, start, `أسماء أعمدة العرض يجب أن تكون فريدة؛ الاسم المكرر: "${duplicateColumns[0]}".`);
    }
    view.columns = validation.columns;
    return success(state, start, { messages: [`تم تعديل تعريف العرض "${viewName}".`] });
  }

  match = sql.match(/^DROP\s+VIEW\s+(IF\s+EXISTS\s+)?([\[\]\w.-]+)$/i);
  if (match) {
    const viewName = cleanName(match[2]);
    const viewKey = keyOf(viewName);
    const view = database.views?.[viewKey];
    if (!view) {
      return match[1]
        ? success(state, start, { messages: [`العرض "${viewName}" غير موجود؛ لم يتغير شيء.`] })
        : errorResult(state, start, `العرض "${viewName}" غير موجود.`);
    }
    delete database.views![viewKey];
    if (Object.keys(database.views!).length === 0) delete database.views;
    return success(state, start, { messages: [`تم حذف العرض "${viewName}".`] });
  }

  // DBCC CHECKIDENT: inspect or reseed the simulated IDENTITY counter.
  match = sql.match(/^DBCC\s+CHECKIDENT\s*\(([\s\S]*)\)$/i);
  if (match) {
    const args = splitTopLevel(match[1]);
    if (args.length < 1 || args.length > 3) {
      return errorResult(state, start, "صيغة DBCC CHECKIDENT غير صحيحة. استخدم DBCC CHECKIDENT ('Table', NORESEED) أو RESEED, value.");
    }
    const rawTableName = args[0].trim();
    const parsedTableName = parseValue(rawTableName);
    const tableName = typeof parsedTableName === 'string' ? cleanName(parsedTableName) : cleanName(rawTableName);
    const table = tableFor(database, tableName);
    if (!table) return errorResult(state, start, 'الجدول "' + tableName + '" غير موجود.');
    const identityColumn = table.columns.find((column) => column.identity);
    if (!identityColumn?.identity) {
      return errorResult(state, start, 'الجدول "' + tableName + '" لا يحتوي على عمود IDENTITY.');
    }

    const mode = (args[1] ?? 'NORESEED').trim().toUpperCase();
    if (mode !== 'NORESEED' && mode !== 'RESEED') {
      return errorResult(state, start, 'الخيار المدعوم هو NORESEED أو RESEED.');
    }
    if (mode === 'NORESEED') {
      if (args.length !== 2) return errorResult(state, start, 'لا تقبل NORESEED قيمة إعادة ضبط.');
      const identityValues = table.rows
        .map((row) => row[identityColumn.name])
        .filter((value): value is number => typeof value === 'number');
      const currentValue = identityValues.length
        ? (identityColumn.identity.increment > 0
          ? Math.max(...identityValues)
          : Math.min(...identityValues))
        : null;
      return success(state, start, {
        columns: ['TableName', 'IdentityColumn', 'CurrentIdentityValue', 'NextIdentityValue'],
        rows: [[table.name, identityColumn.name, valueToText(currentValue), String(identityColumn.identity.nextValue)]],
        messages: ['تم فحص عداد IDENTITY دون تغييره.'],
      });
    }

    if (args.length !== 3 || !/^-?\d+$/.test(args[2].trim())) {
      return errorResult(state, start, 'استخدم RESEED مع قيمة صحيحة صريحة، مثل DBCC CHECKIDENT (\'' + tableName + '\', RESEED, 100).');
    }
    const reseedValue = Number(args[2].trim());
    if (!Number.isSafeInteger(reseedValue)) {
      return errorResult(state, start, 'قيمة RESEED يجب أن تكون عددًا صحيحًا آمنًا.');
    }
    let coercedReseed: SqlValue;
    try {
      coercedReseed = coerceColumnValue(reseedValue, identityColumn);
    } catch (error) {
      return errorResult(state, start, error instanceof Error ? error.message : String(error));
    }
    if (coercedReseed === null || typeof coercedReseed !== 'number') {
      return errorResult(state, start, 'قيمة RESEED غير صالحة لعمود IDENTITY.');
    }
    // SQL Server uses the reseed value itself for the first insert into an empty table;
    // for a non-empty table, the next generated value is reseed + increment.
    identityColumn.identity.nextValue = table.rows.length === 0
      ? coercedReseed
      : coercedReseed + identityColumn.identity.increment;
    return success(state, start, {
      messages: ['تمت إعادة ضبط عداد IDENTITY في الجدول "' + tableName + '". القيمة التالية: ' + identityColumn.identity.nextValue + '.'],
    });
  }

  // SET IDENTITY_INSERT table ON | OFF
  match = sql.match(/^SET\s+IDENTITY_INSERT\s+([\[\]\w.-]+)\s+(ON|OFF)$/i);
  if (match) {
    const tableName = cleanName(match[1]);
    const table = tableFor(database, tableName);
    if (!table) return errorResult(state, start, 'الجدول "' + tableName + '" غير موجود.');
    if (!table.columns.some((column) => column.identity)) {
      return errorResult(state, start, 'الجدول "' + tableName + '" لا يحتوي على عمود IDENTITY.');
    }
    const identityKey = keyOf(database.name + '.' + table.name);
    if (match[2].toUpperCase() === 'ON') {
      if (state.identityInsertTable && keyOf(state.identityInsertTable) !== identityKey) {
        return errorResult(state, start, 'لا يمكن تفعيل IDENTITY_INSERT لأكثر من جدول واحد في الجلسة نفسها.');
      }
      state.identityInsertTable = identityKey;
      return success(state, start, { messages: ['تم تفعيل IDENTITY_INSERT للجدول "' + tableName + '".'] });
    }
    if (state.identityInsertTable && keyOf(state.identityInsertTable) !== identityKey) {
      return errorResult(state, start, 'IDENTITY_INSERT مفعّل لجدول آخر؛ أوقفه أولًا.');
    }
    state.identityInsertTable = null;
    return success(state, start, { messages: ['تم إيقاف IDENTITY_INSERT للجدول "' + tableName + '".'] });
  }

  // 4. CREATE TABLE
  const createIfNotExists = /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\b/i.test(sql);
  match = sql.match(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([[\]\w.-]+)\s*\(([\s\S]*)\)$/i);
  if (match) {
    const name = cleanName(match[1]);
    if (tableFor(database, name) || database.views?.[keyOf(name)]) {
      return createIfNotExists
        ? success(state, start, { messages: [`الجدول "${name}" موجود بالفعل؛ لم يتم تغييره.`] })
        : errorResult(state, start, `الجدول "${name}" موجود بالفعل.`);
    }
    const definitions = splitTopLevel(match[2]);
    const columns: ColumnModel[] = [];
    let tablePrimaryKeys: string[] = [];
    const tableUniqueConstraints: string[][] = [];
    const tableForeignKeys: ForeignKeyModel[] = [];
    const tableCheckConstraints: CheckConstraintModel[] = [];
    for (const definition of definitions) {
      const tableCheck = definition.match(/^(?:CONSTRAINT\s+([\[\]\w-]+)\s+)?CHECK\s*\(([\s\S]*)\)$/i);
      if (tableCheck) {
        tableCheckConstraints.push({
          name: cleanName(tableCheck[1] ?? ('CK_' + name + '_' + (tableCheckConstraints.length + 1))),
          expression: tableCheck[2].trim(),
        });
        continue;
      }
      const foreignKeyMatch = definition.match(/^(?:CONSTRAINT\s+([\[\]\w-]+)\s+)?FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+([\[\]\w.-]+)\s*\(([^)]+)\)$/i);
      if (foreignKeyMatch) {
        const sourceColumns = splitTopLevel(foreignKeyMatch[2]).map(cleanName);
        const targetColumns = splitTopLevel(foreignKeyMatch[4]).map(cleanName);
        if (sourceColumns.length !== 1 || targetColumns.length !== 1) {
          return errorResult(state, start, 'يدعم هذا الإصدار التعليمي المفتاح الخارجي لعمود واحد فقط في كل قيد.');
        }
        tableForeignKeys.push({
          name: cleanName(foreignKeyMatch[1] ?? ('FK_' + name + '_' + sourceColumns[0])),
          column: sourceColumns[0],
          referencedTable: cleanName(foreignKeyMatch[3]),
          referencedColumn: targetColumns[0],
        });
        continue;
      }
      const primary = definition.match(/^(?:CONSTRAINT\s+[\[\]\w-]+\s+)?PRIMARY\s+KEY\s*\((.+)\)$/i);
      if (primary) {
        if (tablePrimaryKeys.length) return errorResult(state, start, 'لا يمكن تعريف أكثر من قيد PRIMARY KEY للجدول.');
        tablePrimaryKeys = splitTopLevel(primary[1]).map(cleanName);
        continue;
      }
      const unique = definition.match(/^(?:CONSTRAINT\s+[\[\]\w-]+\s+)?UNIQUE\s*\((.+)\)$/i);
      if (unique) {
        tableUniqueConstraints.push(splitTopLevel(unique[1]).map(cleanName));
        continue;
      }
      const columnMatch = definition.match(/^([[\]\w-]+)\s+([A-Z]+(?:\s*\(\s*\d+(?:\s*,\s*\d+)?\s*\))?)([\s\S]*)$/i);
      if (!columnMatch) return errorResult(state, start, `تعريف العمود غير مفهوم: ${definition}`);
      const rest = columnMatch[3] ?? '';
      const defaultMatch = rest.match(/\bDEFAULT\s+(.+?)(?:\s+NOT\s+NULL|\s+UNIQUE|\s+PRIMARY\s+KEY|\s+CHECK\b|$)/i);
      const namedDefaultMatch = rest.match(/\bCONSTRAINT\s+([\[\]\w-]+)\s+DEFAULT\b/i);
      const identityKeyword = /\bIDENTITY\b/i.test(rest);
      const identityMatch = rest.match(/\bIDENTITY(?:\s*\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\))?/i);
      if (identityKeyword && !identityMatch) {
        return errorResult(state, start, 'صيغة IDENTITY غير صالحة. استخدم IDENTITY أو IDENTITY(seed, increment).');
      }
      const identityType = columnMatch[2].toUpperCase().replace(/\s+/g, '').match(/^[A-Z]+/)?.[0] ?? '';
      if (identityMatch && !['TINYINT', 'SMALLINT', 'INT', 'BIGINT'].includes(identityType)) {
        return errorResult(state, start, 'يجب أن يكون نوع عمود IDENTITY عددًا صحيحًا مثل INT أو BIGINT.');
      }
      const identitySeed = identityMatch?.[1] === undefined ? 1 : Number(identityMatch[1]);
      const identityIncrement = identityMatch?.[2] === undefined ? 1 : Number(identityMatch[2]);
      if (identityMatch && (!Number.isSafeInteger(identitySeed) || !Number.isSafeInteger(identityIncrement) || identityIncrement === 0)) {
        return errorResult(state, start, 'قيم IDENTITY يجب أن تكون أعدادًا صحيحة آمنة، ولا يجوز أن يكون increment صفرًا.');
      }
      const inlineCheck = rest.match(/\bCHECK\s*\(([\s\S]*)\)\s*$/i);
      if (inlineCheck) {
        tableCheckConstraints.push({
          name: 'CK_' + name + '_' + cleanName(columnMatch[1]),
          expression: inlineCheck[1].trim(),
        });
      }
      const inlineReference = rest.match(/\bREFERENCES\s+([\[\]\w.-]+)\s*\(\s*([\[\]\w-]+)\s*\)/i);
      if (inlineReference) {
        tableForeignKeys.push({
          name: 'FK_' + name + '_' + cleanName(columnMatch[1]),
          column: cleanName(columnMatch[1]),
          referencedTable: cleanName(inlineReference[1]),
          referencedColumn: cleanName(inlineReference[2]),
        });
      }
      columns.push({
        name: cleanName(columnMatch[1]),
        type: columnMatch[2].toUpperCase().replace(/\s+/g, ''),
        nullable: !identityMatch && !/\bNOT\s+NULL\b/i.test(rest) && !/\bPRIMARY\s+KEY\b/i.test(rest),
        primaryKey: /\bPRIMARY\s+KEY\b/i.test(rest),
        unique: /\bUNIQUE\b/i.test(rest),
        defaultValue: defaultMatch ? parseValue(defaultMatch[1].trim()) : undefined,
        ...(namedDefaultMatch ? { defaultConstraintName: cleanName(namedDefaultMatch[1]) } : {}),
        ...(identityMatch ? { identity: { seed: identitySeed, increment: identityIncrement, nextValue: identitySeed } } : {}),
      });
    }
    const duplicateColumn = columns.find((column, index) => columns.some((other, otherIndex) => otherIndex !== index && keyOf(other.name) === keyOf(column.name)));
    if (duplicateColumn) return errorResult(state, start, `اسم العمود "${duplicateColumn.name}" مكرر.`);
    if (columns.filter((column) => column.identity).length > 1) {
      return errorResult(state, start, 'يسمح SQL Server بعمود IDENTITY واحد فقط في كل جدول.');
    }
    if (new Set(tablePrimaryKeys.map(keyOf)).size !== tablePrimaryKeys.length) {
      return errorResult(state, start, 'لا يجوز تكرار العمود داخل قيد PRIMARY KEY.');
    }
    if (tablePrimaryKeys.length && columns.some((column) => column.primaryKey)) {
      return errorResult(state, start, 'تم تعريف المفتاح الرئيسي أكثر من مرة.');
    }
    for (const primaryName of tablePrimaryKeys) {
      const primaryColumn = columns.find((column) => keyOf(column.name) === keyOf(primaryName));
      if (!primaryColumn) return errorResult(state, start, `عمود المفتاح الرئيسي "${primaryName}" غير موجود في تعريف الجدول.`);
      primaryColumn.primaryKey = true;
      primaryColumn.nullable = false;
    }
    for (const uniqueColumns of tableUniqueConstraints) {
      if (!uniqueColumns.length || new Set(uniqueColumns.map(keyOf)).size !== uniqueColumns.length) {
        return errorResult(state, start, 'قيد UNIQUE يحتوي على أعمدة مكررة أو غير صالحة.');
      }
      const missingColumn = uniqueColumns.find((columnName) => !columns.some((column) => keyOf(column.name) === keyOf(columnName)));
      if (missingColumn) return errorResult(state, start, `عمود UNIQUE "${missingColumn}" غير موجود في تعريف الجدول.`);
    }
    if (columns.length === 0) return errorResult(state, start, 'يجب أن يحتوي الجدول على عمود واحد على الأقل.');
    const primaryKeyColumns = tablePrimaryKeys.length
      ? tablePrimaryKeys
      : columns.filter((column) => column.primaryKey).map((column) => column.name);
    const newTable: TableModel = {
      name,
      columns,
      rows: [],
      ...(primaryKeyColumns.length ? { primaryKeyColumns } : {}),
      ...(tableUniqueConstraints.length ? { uniqueConstraints: tableUniqueConstraints } : {}),
      ...(tableForeignKeys.length ? { foreignKeys: tableForeignKeys } : {}),
      ...(tableCheckConstraints.length ? { checkConstraints: tableCheckConstraints } : {}),
    };
    const constraintNames = new Set<string>();
    const namedDefaults = columns
      .filter((column) => column.defaultConstraintName)
      .map((column) => column.defaultConstraintName as string);
    for (const constraintName of [
      ...tableCheckConstraints.map((constraint) => constraint.name),
      ...tableForeignKeys.map((foreignKey) => foreignKey.name),
      ...namedDefaults,
    ]) {
      const normalizedName = keyOf(constraintName);
      if (constraintNames.has(normalizedName)) {
        return errorResult(state, start, 'اسم القيد "' + constraintName + '" مكرر في الجدول.');
      }
      constraintNames.add(normalizedName);
    }
    const foreignKeyNames = new Set<string>();
    for (const foreignKey of tableForeignKeys) {
      const normalizedName = keyOf(foreignKey.name);
      if (foreignKeyNames.has(normalizedName)) {
        return errorResult(state, start, 'اسم قيد FOREIGN KEY "' + foreignKey.name + '" مكرر.');
      }
      foreignKeyNames.add(normalizedName);
      const foreignKeyError = validateForeignKeyDefinition(database, newTable, foreignKey);
      if (foreignKeyError) return errorResult(state, start, foreignKeyError);
    }
    database.tables[keyOf(name)] = newTable;
    return success(state, start, { messages: [`تم إنشاء الجدول ${name}.`] });
  }

  // CREATE [UNIQUE] INDEX
  match = sql.match(/^CREATE\s+(UNIQUE\s+)?INDEX\s+([\[\]\w-]+)\s+ON\s+([\[\]\w.-]+)\s*\(([^)]+)\)$/i);
  if (match) {
    const unique = Boolean(match[1]);
    const indexName = cleanName(match[2]);
    const tableName = cleanName(match[3]);
    const table = tableFor(database, tableName);
    if (!table) return errorResult(state, start, 'الجدول "' + tableName + '" غير موجود.');

    const columns = splitTopLevel(match[4]).map(cleanName);
    if (!columns.length || new Set(columns.map(keyOf)).size !== columns.length) {
      return errorResult(state, start, 'تعريف الفهرس يحتوي على أعمدة مكررة أو غير صالحة.');
    }
    const missingColumn = columns.find((name) => !table.columns.some((column) => keyOf(column.name) === keyOf(name)));
    if (missingColumn) return errorResult(state, start, 'عمود الفهرس "' + missingColumn + '" غير موجود في الجدول "' + tableName + '".');

    const indexes = table.indexes ?? [];
    if (indexes.some((index) => keyOf(index.name) === keyOf(indexName))) {
      return errorResult(state, start, 'الفهرس "' + indexName + '" موجود بالفعل في الجدول "' + tableName + '".');
    }

    const candidateTable: TableModel = {
      ...table,
      indexes: [...indexes, { name: indexName, columns, unique }],
    };
    if (unique) {
      const validationError = validateTableRows(candidateTable, table.rows);
      if (validationError) return errorResult(state, start, validationError);
    }

    table.indexes = candidateTable.indexes;
    return success(state, start, {
      messages: ['تم إنشاء ' + (unique ? 'فهرس UNIQUE' : 'فهرس') + ' "' + indexName + '" على الجدول "' + tableName + '".'],
    });
  }

  // DROP INDEX index_name ON table_name
  match = sql.match(/^DROP\s+INDEX\s+([\[\]\w-]+)\s+ON\s+([\[\]\w.-]+)$/i);
  if (match) {
    const indexName = cleanName(match[1]);
    const tableName = cleanName(match[2]);
    const table = tableFor(database, tableName);
    if (!table) return errorResult(state, start, 'الجدول "' + tableName + '" غير موجود.');
    const indexes = table.indexes ?? [];
    const index = indexes.find((item) => keyOf(item.name) === keyOf(indexName));
    if (!index) return errorResult(state, start, 'الفهرس "' + indexName + '" غير موجود في الجدول "' + tableName + '".');
    table.indexes = indexes.filter((item) => keyOf(item.name) !== keyOf(indexName));
    if (table.indexes.length === 0) delete table.indexes;
    return success(state, start, { messages: ['تم حذف الفهرس "' + indexName + '" من الجدول "' + tableName + '".'] });
  }

  // 5. DROP TABLE
  match = sql.match(/^DROP\s+TABLE\s+([[\]\w.-]+)$/i);
  if (match) {
    const name = cleanName(match[1]);
    if (!tableFor(database, name)) return errorResult(state, start, `الجدول "${name}" غير موجود.`);
    const dependency = Object.values(database.tables).find((childTable) =>
      keyOf(childTable.name) !== keyOf(name)
      && (childTable.foreignKeys ?? []).some((foreignKey) => keyOf(foreignKey.referencedTable) === keyOf(name))
    );
    if (dependency) {
      return errorResult(state, start, 'لا يمكن حذف الجدول "' + name + '" لأنه مرجع في قيد FOREIGN KEY داخل الجدول "' + dependency.name + '".');
    }
    delete database.tables[keyOf(name)];
    return success(state, start, { messages: [`تم حذف الجدول ${name}.`] });
  }

  // ALTER TABLE ADD FOREIGN KEY CONSTRAINT
  match = sql.match(/^ALTER\s+TABLE\s+([\[\]\w.-]+)\s+ADD\s+(?:CONSTRAINT\s+([\[\]\w-]+)\s+)?FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+([\[\]\w.-]+)\s*\(([^)]+)\)$/i);
  if (match) {
    const tableName = cleanName(match[1]);
    const table = tableFor(database, tableName);
    if (!table) return errorResult(state, start, 'الجدول "' + tableName + '" غير موجود.');
    const sourceColumns = splitTopLevel(match[3]).map(cleanName);
    const targetColumns = splitTopLevel(match[5]).map(cleanName);
    if (sourceColumns.length !== 1 || targetColumns.length !== 1) {
      return errorResult(state, start, 'يدعم هذا الإصدار التعليمي المفتاح الخارجي لعمود واحد فقط في كل قيد.');
    }
    const foreignKey: ForeignKeyModel = {
      name: cleanName(match[2] ?? ('FK_' + tableName + '_' + sourceColumns[0])),
      column: sourceColumns[0],
      referencedTable: cleanName(match[4]),
      referencedColumn: targetColumns[0],
    };
    if ((table.foreignKeys ?? []).some((item) => keyOf(item.name) === keyOf(foreignKey.name))) {
      return errorResult(state, start, 'قيد FOREIGN KEY "' + foreignKey.name + '" موجود بالفعل.');
    }
    const definitionError = validateForeignKeyDefinition(database, table, foreignKey);
    if (definitionError) return errorResult(state, start, definitionError);
    const candidateTable: TableModel = {
      ...table,
      foreignKeys: [...(table.foreignKeys ?? []), foreignKey],
    };
    const rowsError = validateForeignKeyRows(database, candidateTable, table.rows);
    if (rowsError) return errorResult(state, start, rowsError);
    table.foreignKeys = candidateTable.foreignKeys;
    return success(state, start, { messages: ['تمت إضافة قيد FOREIGN KEY "' + foreignKey.name + '".'] });
  }

// ALTER TABLE ADD DEFAULT CONSTRAINT
  match = sql.match(/^ALTER\s+TABLE\s+([\[\]\w.-]+)\s+ADD\s+CONSTRAINT\s+([\[\]\w-]+)\s+DEFAULT\s+(.+?)\s+FOR\s+([\[\]\w-]+)$/i);
  if (match) {
    const tableName = cleanName(match[1]);
    const table = tableFor(database, tableName);
    if (!table) return errorResult(state, start, 'الجدول "' + tableName + '" غير موجود.');
    const constraintName = cleanName(match[2]);
    const columnName = cleanName(match[4]);
    const column = table.columns.find((item) => keyOf(item.name) === keyOf(columnName));
    if (!column) return errorResult(state, start, 'العمود "' + columnName + '" غير موجود في الجدول "' + tableName + '".');
    const duplicateConstraint = table.columns.some((item) => keyOf(item.defaultConstraintName ?? '') === keyOf(constraintName))
      || (table.foreignKeys ?? []).some((item) => keyOf(item.name) === keyOf(constraintName))
      || (table.checkConstraints ?? []).some((item) => keyOf(item.name) === keyOf(constraintName));
    if (duplicateConstraint) return errorResult(state, start, 'اسم القيد "' + constraintName + '" مستخدم بالفعل في الجدول.');
    if (column.defaultValue !== undefined || column.defaultConstraintName) {
      return errorResult(state, start, 'العمود "' + columnName + '" لديه قيمة DEFAULT بالفعل.');
    }
    let defaultValue: SqlValue;
    try {
      defaultValue = coerceColumnValue(parseValue(match[3].trim()), column);
    } catch (error) {
      return errorResult(state, start, error instanceof Error ? error.message : String(error));
    }
    column.defaultValue = defaultValue;
    column.defaultConstraintName = constraintName;
    return success(state, start, { messages: ['تمت إضافة قيد DEFAULT "' + constraintName + '" للعمود "' + columnName + '".'] });
  }

    // ALTER TABLE ADD CHECK CONSTRAINT
  match = sql.match(/^ALTER\s+TABLE\s+([\[\]\w.-]+)\s+ADD\s+(?:CONSTRAINT\s+([\[\]\w-]+)\s+)?CHECK\s*\(([\s\S]*)\)$/i);
  if (match) {
    const tableName = cleanName(match[1]);
    const table = tableFor(database, tableName);
    if (!table) return errorResult(state, start, 'الجدول "' + tableName + '" غير موجود.');
    const checkConstraints = table.checkConstraints ?? [];
    const foreignKeys = table.foreignKeys ?? [];
    const checkName = cleanName(match[2] ?? ('CK_' + tableName + '_' + (checkConstraints.length + 1)));
    if (checkConstraints.some((item) => keyOf(item.name) === keyOf(checkName))
      || foreignKeys.some((item) => keyOf(item.name) === keyOf(checkName))) {
      return errorResult(state, start, 'اسم القيد "' + checkName + '" موجود بالفعل في الجدول.');
    }
    const constraint: CheckConstraintModel = { name: checkName, expression: match[3].trim() };
    const candidateTable: TableModel = {
      ...table,
      checkConstraints: [...checkConstraints, constraint],
    };
    const checkError = validateCheckConstraints(candidateTable, table.rows, state);
    if (checkError) return errorResult(state, start, checkError);
    table.checkConstraints = candidateTable.checkConstraints;
    return success(state, start, { messages: ['تمت إضافة قيد CHECK "' + checkName + '".'] });
  }

  // ALTER TABLE DROP CONSTRAINT (FOREIGN KEY)
  match = sql.match(/^ALTER\s+TABLE\s+([\[\]\w.-]+)\s+DROP\s+CONSTRAINT\s+([\[\]\w-]+)$/i);
  if (match) {
    const tableName = cleanName(match[1]);
    const table = tableFor(database, tableName);
    if (!table) return errorResult(state, start, 'الجدول "' + tableName + '" غير موجود.');
    const constraintName = cleanName(match[2]);
    const foreignKeys = table.foreignKeys ?? [];
    const foreignKeyIndex = foreignKeys.findIndex((item) => keyOf(item.name) === keyOf(constraintName));
    if (foreignKeyIndex >= 0) {
      table.foreignKeys = foreignKeys.filter((_, index) => index !== foreignKeyIndex);
      if (table.foreignKeys.length === 0) delete table.foreignKeys;
      return success(state, start, { messages: ['تم حذف قيد FOREIGN KEY "' + constraintName + '" من الجدول "' + tableName + '".'] });
    }
    const checkConstraints = table.checkConstraints ?? [];
    const checkIndex = checkConstraints.findIndex((item) => keyOf(item.name) === keyOf(constraintName));
    if (checkIndex >= 0) {
      table.checkConstraints = checkConstraints.filter((_, index) => index !== checkIndex);
      if (table.checkConstraints.length === 0) delete table.checkConstraints;
      return success(state, start, { messages: ['تم حذف قيد CHECK "' + constraintName + '" من الجدول "' + tableName + '".'] });
    }
    const defaultColumn = table.columns.find((column) => keyOf(column.defaultConstraintName ?? '') === keyOf(constraintName));
    if (defaultColumn) {
      delete defaultColumn.defaultValue;
      delete defaultColumn.defaultConstraintName;
      return success(state, start, { messages: ['تم حذف قيد DEFAULT "' + constraintName + '" من العمود "' + defaultColumn.name + '".'] });
    }
    return errorResult(state, start, 'القيد "' + constraintName + '" غير موجود في الجدول "' + tableName + '". يدعم DROP CONSTRAINT حاليًا قيود FOREIGN KEY وCHECK وDEFAULT.');
  }

  // 6. ALTER TABLE ADD COLUMN
  match = sql.match(/^ALTER\s+TABLE\s+([\[\]\w.-]+)\s+ADD\s+(?:COLUMN\s+)?([\[\]\w-]+)\s+([A-Z]+(?:\s*\(\s*\d+(?:\s*,\s*\d+)?\s*\))?)([\s\S]*)$/i);
  if (match) {
    const tableName = cleanName(match[1]);
    const table = tableFor(database, tableName);
    if (!table) return errorResult(state, start, 'الجدول "' + tableName + '" غير موجود.');
    const columnName = cleanName(match[2]);
    if (table.columns.some((column) => keyOf(column.name) === keyOf(columnName))) {
      return errorResult(state, start, 'العمود "' + columnName + '" موجود بالفعل في الجدول.');
    }
    const rest = match[4] ?? '';
    const defaultMatch = rest.match(/\bDEFAULT\s+(.+?)(?:\s+NOT\s+NULL|\s+NULL|\s+UNIQUE|\s+PRIMARY\s+KEY|\s+CHECK\b|$)/i);
    const namedDefaultMatch = rest.match(/\bCONSTRAINT\s+([\[\]\w-]+)\s+DEFAULT\b/i);
    if (namedDefaultMatch) {
      const defaultName = cleanName(namedDefaultMatch[1]);
      const alreadyUsed = table.columns.some((column) => keyOf(column.defaultConstraintName ?? '') === keyOf(defaultName))
        || (table.foreignKeys ?? []).some((foreignKey) => keyOf(foreignKey.name) === keyOf(defaultName))
        || (table.checkConstraints ?? []).some((constraint) => keyOf(constraint.name) === keyOf(defaultName));
      if (alreadyUsed) return errorResult(state, start, 'اسم القيد "' + defaultName + '" مستخدم بالفعل في الجدول.');
    }
    const newColumn: ColumnModel = {
      name: columnName,
      type: match[3].toUpperCase().replace(/\s+/g, ''),
      nullable: !/\bNOT\s+NULL\b/i.test(rest) && !/\bPRIMARY\s+KEY\b/i.test(rest),
      primaryKey: /\bPRIMARY\s+KEY\b/i.test(rest),
      unique: /\bUNIQUE\b/i.test(rest),
      defaultValue: defaultMatch ? parseValue(defaultMatch[1].trim()) : undefined,
      ...(namedDefaultMatch ? { defaultConstraintName: cleanName(namedDefaultMatch[1]) } : {}),
    };
    if (newColumn.primaryKey) newColumn.nullable = false;
    let candidateRows: StoredRow[];
    try {
      candidateRows = table.rows.map((row) => {
        const nextValue = newColumn.defaultValue === undefined ? null : newColumn.defaultValue;
        return { ...row, [newColumn.name]: coerceColumnValue(nextValue, newColumn) };
      });
    } catch (error) {
      return errorResult(state, start, error instanceof Error ? error.message : String(error));
    }
    const candidateTable: TableModel = { ...table, columns: [...table.columns, newColumn] };
    const validationError = validateTableRows(candidateTable, candidateRows);
    if (validationError) return errorResult(state, start, validationError);
    const checkError = validateCheckConstraints(candidateTable, candidateRows, state);
    if (checkError) return errorResult(state, start, checkError);
    table.columns.push(newColumn);
    table.rows = candidateRows;
    return success(state, start, { messages: ['تمت إضافة العمود "' + columnName + '" إلى الجدول "' + tableName + '".'] });
  }

  // 7. ALTER TABLE ALTER COLUMN
  match = sql.match(/^ALTER\s+TABLE\s+([\[\]\w.-]+)\s+ALTER\s+COLUMN\s+([\[\]\w-]+)\s+([A-Z]+(?:\s*\(\s*\d+(?:\s*,\s*\d+)?\s*\))?)(?:\s+(NOT\s+NULL|NULL))?$/i);
  if (match) {
    const tableName = cleanName(match[1]);
    const table = tableFor(database, tableName);
    if (!table) return errorResult(state, start, 'الجدول "' + tableName + '" غير موجود.');
    const columnName = cleanName(match[2]);
    const columnIndex = table.columns.findIndex((column) => keyOf(column.name) === keyOf(columnName));
    if (columnIndex < 0) return errorResult(state, start, 'العمود "' + columnName + '" غير موجود في الجدول.');
    const oldColumn = table.columns[columnIndex];
    const nullability = match[4]?.toUpperCase();
    if (oldColumn.identity && match[3].toUpperCase().replace(/\s+/g, '') !== oldColumn.type) {
      return errorResult(state, start, 'لا يمكن تغيير نوع عمود IDENTITY باستخدام ALTER COLUMN في هذا الإصدار التعليمي.');
    }
    if (oldColumn.primaryKey && nullability === 'NULL') {
      return errorResult(state, start, 'لا يمكن جعل عمود المفتاح الرئيسي يقبل NULL.');
    }
    const updatedColumn: ColumnModel = {
      ...oldColumn,
      type: match[3].toUpperCase().replace(/\s+/g, ''),
      nullable: nullability === 'NOT NULL' ? false : nullability === 'NULL' ? true : oldColumn.nullable,
    };
    const candidateRows: StoredRow[] = [];
    try {
      for (const row of table.rows) {
        const converted = coerceColumnValue(row[oldColumn.name] ?? null, updatedColumn);
        candidateRows.push({ ...row, [oldColumn.name]: converted });
      }
    } catch (error) {
      return errorResult(state, start, error instanceof Error ? error.message : String(error));
    }
    const candidateTable: TableModel = { ...table, columns: table.columns.map((column, index) => index === columnIndex ? updatedColumn : column) };
    const validationError = validateTableRows(candidateTable, candidateRows);
    if (validationError) return errorResult(state, start, validationError);
    const checkError = validateCheckConstraints(candidateTable, candidateRows, state);
    if (checkError) return errorResult(state, start, checkError);
    const foreignKeyError = validateForeignKeyRows(database, candidateTable, candidateRows);
    if (foreignKeyError) return errorResult(state, start, foreignKeyError);
    const referenceError = validateReferencedRows(database, table, candidateRows);
    if (referenceError) return errorResult(state, start, referenceError);
    table.columns[columnIndex] = updatedColumn;
    table.rows = candidateRows;
    return success(state, start, { messages: ['تم تعديل تعريف العمود "' + columnName + '" في الجدول "' + tableName + '".'] });
  }

  // 8. ALTER TABLE DROP COLUMN
  match = sql.match(/^ALTER\s+TABLE\s+([\[\]\w.-]+)\s+DROP\s+(?:COLUMN\s+)?([\[\]\w-]+)$/i);
  if (match) {
    const tableName = cleanName(match[1]);
    const table = tableFor(database, tableName);
    if (!table) return errorResult(state, start, 'الجدول "' + tableName + '" غير موجود.');
    const columnName = cleanName(match[2]);
    const columnIndex = table.columns.findIndex((column) => keyOf(column.name) === keyOf(columnName));
    if (columnIndex < 0) return errorResult(state, start, 'العمود "' + columnName + '" غير موجود في الجدول.');
    const column = table.columns[columnIndex];
    const belongsToUniqueConstraint = (table.uniqueConstraints ?? []).some((constraint) =>
      constraint.some((name) => keyOf(name) === keyOf(columnName))
    );
    const belongsToForeignKey = (table.foreignKeys ?? []).some((foreignKey) =>
      keyOf(foreignKey.column) === keyOf(columnName)
    ) || Object.values(database.tables).some((otherTable) =>
      (otherTable.foreignKeys ?? []).some((foreignKey) =>
        keyOf(foreignKey.referencedTable) === keyOf(table.name)
        && keyOf(foreignKey.referencedColumn) === keyOf(columnName)
      )
    );
    const belongsToCheck = (table.checkConstraints ?? []).some((constraint) =>
      checkExpressionReferencesColumn(constraint.expression, columnName)
    );
    const belongsToIndex = (table.indexes ?? []).some((index) =>
      index.columns.some((indexedColumn) => keyOf(indexedColumn) === keyOf(columnName))
    );
    if (column.primaryKey || column.unique || column.defaultConstraintName || belongsToUniqueConstraint || belongsToForeignKey || belongsToCheck || belongsToIndex) {
      return errorResult(state, start, 'لا يمكن حذف العمود "' + columnName + '" لأنه مرتبط بقيد أو فهرس. احذف العنصر المرتبط أولًا.');
    }
    table.columns.splice(columnIndex, 1);
    table.rows = table.rows.map((row) => {
      const copy = { ...row };
      delete copy[column.name];
      return copy;
    });
    return success(state, start, { messages: ['تم حذف العمود "' + columnName + '" من الجدول "' + tableName + '".'] });
  }

  // 9. TRUNCATE TABLE
  match = sql.match(/^TRUNCATE\s+TABLE\s+([\[\]\w.-]+)$/i);
  if (match) {
    const tableName = cleanName(match[1]);
    const table = tableFor(database, tableName);
    if (!table) return errorResult(state, start, 'الجدول "' + tableName + '" غير موجود.');
    const dependency = Object.values(database.tables).find((childTable) =>
      (childTable.foreignKeys ?? []).some((foreignKey) => keyOf(foreignKey.referencedTable) === keyOf(tableName))
    );
    if (dependency) {
      return errorResult(state, start, 'لا يمكن تنفيذ TRUNCATE على الجدول "' + tableName + '" لأنه مرجع في قيد FOREIGN KEY داخل الجدول "' + dependency.name + '".');
    }
    const removedRows = table.rows.length;
    table.rows = [];
    for (const column of table.columns) {
      if (column.identity) column.identity.nextValue = column.identity.seed;
    }
    return success(state, start, { affectedRows: removedRows, messages: ['تم تفريغ الجدول "' + tableName + '" بنجاح. (' + removedRows + ' صفوف محذوفة)'] });
  }

  // 10. INSERT INTO
  match = sql.match(/^INSERT\s+INTO\s+([\[\]\w.-]+)(?:\s*\(([^)]*)\))?\s+VALUES\s+([\s\S]+)$/i);
  if (match) {
    const tableName = cleanName(match[1]);
    const table = tableFor(database, tableName);
    if (!table) return errorResult(state, start, `الجدول "${tableName}" غير موجود.`);

    const targetColumns = match[2] ? splitTopLevel(match[2]).map(cleanName) : table.columns.map((column) => column.name);

    const colErr = validateColumnsInTable(table, targetColumns);
    if (colErr) return errorResult(state, start, colErr);

    const tuples = splitTopLevelTuples(match[3]);
    if (!tuples.length) return errorResult(state, start, 'لم يتم العثور على VALUES صالحة.');

    const pendingRows: StoredRow[] = [];
    const identityNextValues = new Map<ColumnModel, number>();
    const identityInsertEnabled = state.identityInsertTable === keyOf(database.name + '.' + table.name);

    for (const tuple of tuples) {
      const values = splitTopLevel(tuple).map((v) => evaluateExpression(v, {}, undefined, state));
      if (values.length !== targetColumns.length) return errorResult(state, start, 'عدد القيم لا يطابق عدد الأعمدة.');

      const row: StoredRow = {};
      for (const column of table.columns) {
        const index = targetColumns.findIndex((target) => keyOf(target) === keyOf(column.name));
        try {
          if (column.identity) {
            const currentNext = identityNextValues.get(column) ?? column.identity.nextValue;
            if (index >= 0) {
              if (!identityInsertEnabled) {
                return errorResult(state, start, 'لا يمكن إدخال قيمة صريحة في عمود IDENTITY "' + column.name + '"؛ نفّذ SET IDENTITY_INSERT ' + tableName + ' ON أولًا.');
              }
              const explicitValue = coerceColumnValue(values[index], column);
              if (explicitValue === null) {
                return errorResult(state, start, 'لا يمكن إدخال NULL في عمود IDENTITY "' + column.name + '".');
              }
              const numericValue = Number(explicitValue);
              const shouldAdvance = column.identity.increment > 0
                ? numericValue >= currentNext
                : numericValue <= currentNext;
              identityNextValues.set(
                column,
                shouldAdvance ? numericValue + column.identity.increment : currentNext
              );
              row[column.name] = explicitValue;
            } else {
              const generatedValue = coerceColumnValue(currentNext, column);
              row[column.name] = generatedValue;
              identityNextValues.set(column, currentNext + column.identity.increment);
            }
          } else {
            const inputValue = index >= 0 ? values[index] : column.defaultValue ?? null;
            row[column.name] = coerceColumnValue(inputValue, column);
          }
        } catch (error) {
          return errorResult(state, start, error instanceof Error ? error.message : String(error));
        }
      }

      pendingRows.push(row);
    }

    const candidateRows = [...table.rows, ...pendingRows];
    const validationError = validateTableRows(table, candidateRows);
    if (validationError) return errorResult(state, start, validationError);
    const foreignKeyError = validateForeignKeyRows(database, table, candidateRows);
    if (foreignKeyError) return errorResult(state, start, foreignKeyError);
    const checkError = validateCheckConstraints(table, candidateRows, state);
    if (checkError) return errorResult(state, start, checkError);
    table.rows.push(...pendingRows);
    for (const [column, nextValue] of identityNextValues) {
      if (column.identity) column.identity.nextValue = nextValue;
    }
    const inserted = pendingRows.length;
    return success(state, start, { affectedRows: inserted, messages: [`(${inserted} rows affected)`] });
  }

  // 7. SELECT STATEMENT
  if (/^SELECT\b/i.test(sql)) {
    const selectRes = executeQueryWithSetOperators(sql, state);
    if (selectRes.error) return errorResult(state, start, selectRes.error);
    return success(state, start, {
      columns: selectRes.columns,
      rows: selectRes.rows,
      messages: [`${selectRes.rows.length} row(s) returned.`],
    });
  }

  // 8. UPDATE STATEMENT
  match = sql.match(/^UPDATE\s+([[\]\w.-]+)\s+SET\s+([\s\S]+)$/i);
  if (match) {
    const tableName = cleanName(match[1]);
    const table = tableFor(database, tableName);
    if (!table) return errorResult(state, start, `الجدول "${tableName}" غير موجود.`);

    const whereIndex = findKeywordOutside(match[2], 'WHERE');
    const setPart = whereIndex >= 0 ? match[2].slice(0, whereIndex).trim() : match[2].trim();
    const where = whereIndex >= 0 ? match[2].slice(whereIndex + 5).trim() : '';

    const assignments = splitTopLevel(setPart).map((item) => item.match(/^([[\]\w-]+)\s*=\s*(.+)$/s)).filter(Boolean) as RegExpMatchArray[];
    if (!assignments.length) return errorResult(state, start, 'صيغة UPDATE غير صالحة.');

    const setCols = assignments.map((a) => cleanName(a[1]));
    const setColErr = validateColumnsInTable(table, setCols);
    if (setColErr) return errorResult(state, start, setColErr);

    let updatedRows: { modified: boolean; row: StoredRow; original: StoredRow }[];
    try {
      updatedRows = table.rows.map((row) => {
        if (!where || Boolean(evaluateExpression(where, row, undefined, state))) {
          const copy = { ...row };
          for (const assignment of assignments) {
            const col = cleanName(assignment[1]);
            const rawValue = evaluateExpression(assignment[2], row, undefined, state);
            const column = table.columns.find((item) => keyOf(item.name) === keyOf(col));
            if (!column) throw new Error('العمود "' + col + '" غير موجود في الجدول.');
            if (column.identity) throw new Error('لا يمكن تعديل قيمة عمود IDENTITY "' + column.name + '" مباشرة باستخدام UPDATE.');
            copy[col] = coerceColumnValue(rawValue, column);
          }
          return { modified: true, row: copy, original: row };
        }
        return { modified: false, row: row, original: row };
      });
    } catch (error) {
      return errorResult(state, start, error instanceof Error ? error.message : String(error));
    }

    const modifiedCount = updatedRows.filter((r) => r.modified).length;
    const candidateRows = updatedRows.map((item) => item.row);
    const validationError = validateTableRows(table, candidateRows);
    if (validationError) return errorResult(state, start, validationError);
    const foreignKeyError = validateForeignKeyRows(database, table, candidateRows);
    if (foreignKeyError) return errorResult(state, start, foreignKeyError);
    const referenceError = validateReferencedRows(database, table, candidateRows);
    if (referenceError) return errorResult(state, start, referenceError);
    const checkError = validateCheckConstraints(table, candidateRows, state);
    if (checkError) return errorResult(state, start, checkError);

    table.rows = candidateRows;
    return success(state, start, { affectedRows: modifiedCount, messages: [`(${modifiedCount} rows affected)`] });
  }

  // 9. DELETE STATEMENT
  match = sql.match(/^DELETE\s+FROM\s+([[\]\w.-]+)(?:\s+WHERE\s+([\s\S]+))?$/i);
  if (match) {
    const tableName = cleanName(match[1]);
    const table = tableFor(database, tableName);
    if (!table) return errorResult(state, start, `الجدول "${tableName}" غير موجود.`);

    const where = match[2] ? match[2].trim() : '';

    const before = table.rows.length;
    const candidateRows = table.rows.filter((row) => where && !Boolean(evaluateExpression(where, row, undefined, state)));
    const referenceError = validateReferencedRows(database, table, candidateRows);
    if (referenceError) return errorResult(state, start, referenceError);
    table.rows = candidateRows;
    const affected = before - table.rows.length;
    return success(state, start, { affectedRows: affected, messages: [`(${affected} rows affected)`] });
  }

  return errorResult(state, start, `تعليمة غير مدعومة: ${sql.split(/\s+/).slice(0, 3).join(' ')}`);
}

export function executeScript(state: EngineState, script: string): { state: EngineState; result: ExecutionResult } {
  const start = Date.now();
  let nextState = cloneState(state);
  let transactionSnapshot: EngineState | null = null;
  const aggregate: ExecutionResult = {
    columns: [],
    rows: [],
    affectedRows: 0,
    messages: [],
    errors: [],
    durationMs: 0,
    database: nextState.currentDatabase,
  };
  const batches = splitBatches(script);
  if (!batches.length) return { state: nextState, result: errorResult(nextState, start, 'اكتب أمر SQL أولًا.') };

  for (const batch of batches) {
    for (const statement of splitStatements(batch)) {
      const normalized = statement.trim();
      let output: ExecutionResult;

      if (/^BEGIN\s+TRAN(?:SACTION)?$/i.test(normalized)) {
        if (transactionSnapshot) {
          output = errorResult(nextState, Date.now(), 'المعاملات المتداخلة غير مدعومة في هذا الإصدار التعليمي.');
        } else {
          transactionSnapshot = cloneState(nextState);
          output = success(nextState, Date.now(), { messages: ['بدأت المعاملة. نفّذ COMMIT للحفظ أو ROLLBACK للتراجع.'] });
        }
      } else if (/^COMMIT(?:\s+TRAN(?:SACTION)?)?$/i.test(normalized)) {
        if (!transactionSnapshot) {
          output = errorResult(nextState, Date.now(), 'لا توجد معاملة مفتوحة لتنفيذ COMMIT.');
        } else {
          transactionSnapshot = null;
          output = success(nextState, Date.now(), { messages: ['تم اعتماد المعاملة (COMMIT).'] });
        }
      } else if (/^ROLLBACK(?:\s+TRAN(?:SACTION)?)?$/i.test(normalized)) {
        if (!transactionSnapshot) {
          output = errorResult(nextState, Date.now(), 'لا توجد معاملة مفتوحة لتنفيذ ROLLBACK.');
        } else {
          nextState = cloneState(transactionSnapshot);
          transactionSnapshot = null;
          output = success(nextState, Date.now(), { messages: ['تم التراجع عن المعاملة (ROLLBACK).'] });
        }
      } else {
        output = executeStatement(nextState, statement);
      }

      aggregate.affectedRows += output.affectedRows;
      aggregate.messages.push(...output.messages);
      aggregate.errors.push(...output.errors);
      if (output.columns.length) {
        aggregate.columns = output.columns;
        aggregate.rows = output.rows;
      }
      aggregate.database = output.database;

      if (output.errors.length) {
        if (transactionSnapshot) {
          nextState = cloneState(transactionSnapshot);
          transactionSnapshot = null;
          aggregate.messages.push('تم التراجع تلقائيًا عن المعاملة بسبب فشل أحد الأوامر.');
          aggregate.database = nextState.currentDatabase;
        }
        aggregate.durationMs = Date.now() - start;
        return { state: nextState, result: aggregate };
      }
    }
  }

  if (transactionSnapshot) {
    nextState = cloneState(transactionSnapshot);
    aggregate.errors.push('انتهى السكربت دون تنفيذ COMMIT؛ تم التراجع عن المعاملة تلقائيًا.');
    aggregate.messages.push('تم إلغاء التغييرات غير المعتمدة لتجنب حفظ بيانات غير مكتملة.');
    aggregate.database = nextState.currentDatabase;
  }

  aggregate.durationMs = Date.now() - start;
  return { state: nextState, result: aggregate };
}
