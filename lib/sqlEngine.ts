export type SqlValue = string | number | boolean | null;

export interface ColumnModel {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  unique: boolean;
  defaultValue?: SqlValue;
}

export type StoredRow = Record<string, SqlValue>;

export interface TableModel {
  name: string;
  columns: ColumnModel[];
  rows: StoredRow[];
}

export interface DatabaseModel {
  name: string;
  tables: Record<string, TableModel>;
}

export interface EngineState {
  databases: Record<string, DatabaseModel>;
  currentDatabase: string | null;
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

  // 2. Logical OR
  const orIdx = findKeywordOutside(expr, 'OR');
  if (orIdx >= 0) {
    const left = evaluateExpression(expr.slice(0, orIdx), row, outerRow, engineState, groupRows);
    const right = evaluateExpression(expr.slice(orIdx + 2), row, outerRow, engineState, groupRows);
    return Boolean(left) || Boolean(right);
  }

  // 3. Logical AND
  const andIdx = findKeywordOutside(expr, 'AND');
  if (andIdx >= 0) {
    const left = evaluateExpression(expr.slice(0, andIdx), row, outerRow, engineState, groupRows);
    const right = evaluateExpression(expr.slice(andIdx + 3), row, outerRow, engineState, groupRows);
    return Boolean(left) && Boolean(right);
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

  const table = tableFor(database, tableName);
  if (!table) throw new Error(`الجدول "${tableName}" غير موجود في قاعدة البيانات.`);

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

  const sampleValidationRow = rows[0] ?? {};

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

  // 2. DROP DATABASE
  match = sql.match(/^DROP\s+DATABASE\s+([[\]\w-]+)$/i);
  if (match) {
    const name = cleanName(match[1]);
    if (!state.databases[keyOf(name)]) return errorResult(state, start, `قاعدة البيانات "${name}" غير موجودة.`);
    delete state.databases[keyOf(name)];
    if (keyOf(state.currentDatabase ?? '') === keyOf(name)) state.currentDatabase = null;
    return success(state, start, { messages: [`تم حذف قاعدة البيانات ${name}.`] });
  }

  // 3. USE DATABASE
  match = sql.match(/^USE\s+([[\]\w-]+)$/i);
  if (match) {
    const name = cleanName(match[1]);
    if (!state.databases[keyOf(name)]) return errorResult(state, start, `قاعدة البيانات "${name}" غير موجودة.`);
    state.currentDatabase = name;
    return success(state, start, { messages: [`قاعدة البيانات الحالية: ${name}.`] });
  }

  const database = databaseFor(state);
  if (!database) return errorResult(state, start, 'اختر قاعدة بيانات أولًا باستخدام USE أو أنشئ قاعدة جديدة.');

  // 4. CREATE TABLE
  match = sql.match(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([[\]\w.-]+)\s*\(([\s\S]*)\)$/i);
  if (match) {
    const name = cleanName(match[1]);
    if (tableFor(database, name)) return errorResult(state, start, `الجدول "${name}" موجود بالفعل.`);
    const definitions = splitTopLevel(match[2]);
    const columns: ColumnModel[] = [];
    let tablePrimaryKeys: string[] = [];
    for (const definition of definitions) {
      const primary = definition.match(/^PRIMARY\s+KEY\s*\((.+)\)$/i);
      if (primary) {
        tablePrimaryKeys = splitTopLevel(primary[1]).map(cleanName);
        continue;
      }
      const columnMatch = definition.match(/^([[\]\w-]+)\s+([A-Z]+(?:\s*\(\s*\d+(?:\s*,\s*\d+)?\s*\))?)([\s\S]*)$/i);
      if (!columnMatch) return errorResult(state, start, `تعريف العمود غير مفهوم: ${definition}`);
      const rest = columnMatch[3] ?? '';
      const defaultMatch = rest.match(/\bDEFAULT\s+(.+?)(?:\s+NOT\s+NULL|\s+UNIQUE|\s+PRIMARY\s+KEY|$)/i);
      columns.push({
        name: cleanName(columnMatch[1]),
        type: columnMatch[2].toUpperCase().replace(/\s+/g, ''),
        nullable: !/\bNOT\s+NULL\b/i.test(rest) && !/\bPRIMARY\s+KEY\b/i.test(rest),
        primaryKey: /\bPRIMARY\s+KEY\b/i.test(rest),
        unique: /\bUNIQUE\b/i.test(rest),
        defaultValue: defaultMatch ? parseValue(defaultMatch[1].trim()) : undefined,
      });
    }
    for (const column of columns) if (tablePrimaryKeys.some((pName) => keyOf(pName) === keyOf(column.name))) column.primaryKey = true;
    database.tables[keyOf(name)] = { name, columns, rows: [] };
    return success(state, start, { messages: [`تم إنشاء الجدول ${name}.`] });
  }

  // 5. DROP TABLE
  match = sql.match(/^DROP\s+TABLE\s+([[\]\w.-]+)$/i);
  if (match) {
    const name = cleanName(match[1]);
    if (!tableFor(database, name)) return errorResult(state, start, `الجدول "${name}" غير موجود.`);
    delete database.tables[keyOf(name)];
    return success(state, start, { messages: [`تم حذف الجدول ${name}.`] });
  }

  // 6. INSERT INTO
  match = sql.match(/^INSERT\s+INTO\s+([[\]\w.-]+)(?:\s*\(([^)]*)\))?\s+VALUES\s+([\s\S]+)$/i);
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

    for (const tuple of tuples) {
      const values = splitTopLevel(tuple).map((v) => evaluateExpression(v, {}, undefined, state));
      if (values.length !== targetColumns.length) return errorResult(state, start, 'عدد القيم لا يطابق عدد الأعمدة.');

      const row: StoredRow = {};
      for (const column of table.columns) {
        const index = targetColumns.findIndex((target) => keyOf(target) === keyOf(column.name));
        row[column.name] = index >= 0 ? values[index] : column.defaultValue ?? null;
        if (!column.nullable && row[column.name] === null) return errorResult(state, start, `العمود "${column.name}" لا يقبل NULL.`);
      }

      for (const column of table.columns.filter((item) => item.primaryKey || item.unique)) {
        const valueToCheck = row[column.name];
        const existsInTable = table.rows.some((existing) => compareValues(existing[column.name], '=', valueToCheck) === true);
        const existsInPending = pendingRows.some((pending) => compareValues(pending[column.name], '=', valueToCheck) === true);
        if (existsInTable || existsInPending) {
          return errorResult(state, start, `قيمة مكررة في العمود الفريد/المفتاح الرئيسي "${column.name}".`);
        }
      }

      pendingRows.push(row);
    }

    table.rows.push(...pendingRows);
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

    const updatedRows = table.rows.map((row) => {
      if (!where || Boolean(evaluateExpression(where, row, undefined, state))) {
        const copy = { ...row };
        for (const assignment of assignments) {
          const col = cleanName(assignment[1]);
          copy[col] = evaluateExpression(assignment[2], row, undefined, state);
        }
        return { modified: true, row: copy, original: row };
      }
      return { modified: false, row: row, original: row };
    });

    const modifiedCount = updatedRows.filter((r) => r.modified).length;
    if (modifiedCount > 0) {
      for (const column of table.columns.filter((c) => c.primaryKey || c.unique)) {
        const valuesSeen = new Set<string>();
        for (const item of updatedRows) {
          const val = item.row[column.name];
          const textVal = String(val).toLowerCase();
          if (valuesSeen.has(textVal)) {
            return errorResult(state, start, `قيمة مكررة في العمود الفريد/المفتاح الرئيسي "${column.name}".`);
          }
          valuesSeen.add(textVal);
        }
      }
    }

    table.rows = updatedRows.map((item) => item.row);
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
    table.rows = table.rows.filter((row) => where && !Boolean(evaluateExpression(where, row, undefined, state)));
    const affected = before - table.rows.length;
    return success(state, start, { affectedRows: affected, messages: [`(${affected} rows affected)`] });
  }

  return errorResult(state, start, `تعليمة غير مدعومة: ${sql.split(/\s+/).slice(0, 3).join(' ')}`);
}

export function executeScript(state: EngineState, script: string): { state: EngineState; result: ExecutionResult } {
  const start = Date.now();
  const nextState = cloneState(state);
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
      const output = executeStatement(nextState, statement);
      aggregate.affectedRows += output.affectedRows;
      aggregate.messages.push(...output.messages);
      aggregate.errors.push(...output.errors);
      if (output.columns.length) {
        aggregate.columns = output.columns;
        aggregate.rows = output.rows;
      }
      aggregate.database = output.database;
      if (output.errors.length) {
        aggregate.durationMs = Date.now() - start;
        return { state: nextState, result: aggregate };
      }
    }
  }
  aggregate.durationMs = Date.now() - start;
  return { state: nextState, result: aggregate };
}
