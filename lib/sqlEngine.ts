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
  Age INT
);
GO
INSERT INTO Students (Id, Name, Age) VALUES
  (1, 'Ali', 20),
  (2, 'Ahmed', 21),
  (3, 'Sara', 19);
GO
SELECT * FROM Students WHERE Age >= 20 ORDER BY Name;`;

function cleanName(value: string): string {
  return value.trim().replace(/^\[|\]$/g, '').replace(/^"|"$/g, '');
}

function keyOf(value: string): string {
  return cleanName(value).toLowerCase();
}

function cloneState(state: EngineState): EngineState {
  return JSON.parse(JSON.stringify(state)) as EngineState;
}

function splitTopLevelTuples(value: string): string[] {
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

function splitTopLevel(value: string, separator = ','): string[] {
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

function splitStatements(value: string): string[] {
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

function valueToText(value: SqlValue): string {
  if (value === null) return 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}

function databaseFor(state: EngineState): DatabaseModel | null {
  return state.currentDatabase ? state.databases[keyOf(state.currentDatabase)] ?? null : null;
}

function tableFor(database: DatabaseModel, name: string): TableModel | null {
  return database.tables[keyOf(name)] ?? null;
}

function findKeywordOutside(value: string, keyword: string): number {
  const target = keyword.toUpperCase();
  let depth = 0;
  let quote: "'" | '"' | null = null;
  for (let i = 0; i <= value.length - target.length; i += 1) {
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

function columnValue(row: StoredRow, name: string): SqlValue {
  const found = Object.keys(row).find((column) => keyOf(column) === keyOf(name));
  return found ? row[found] : null;
}

function hasColumn(table: TableModel, columnName: string): boolean {
  return table.columns.some((col) => keyOf(col.name) === keyOf(columnName));
}

function extractIdentifiersFromExpr(expr: string): string[] {
  const cleaned = expr
    .replace(/'[^']*'/g, '')
    .replace(/"[^"]*"/g, '')
    .replace(/\b(AND|OR|NOT|IS|NULL|BETWEEN|IN|LIKE)\b/gi, ' ')
    .replace(/(=|!=|<>|>=|<=|>|<|\(|\)|,)/g, ' ');

  const tokens = cleaned.split(/\s+/).filter(Boolean);
  const result: string[] = [];
  for (const token of tokens) {
    if (!/^-?\d+(\.\d+)?$/i.test(token) && !/^(true|false|null)$/i.test(token)) {
      result.push(cleanName(token));
    }
  }
  return result;
}

function validateColumnsInTable(table: TableModel, columnNames: string[]): string | null {
  for (const colName of columnNames) {
    if (!hasColumn(table, colName)) {
      return `العمود "${colName}" غير موجود في الجدول "${table.name}".`;
    }
  }
  return null;
}

function compareValues(left: SqlValue, operator: string, right: SqlValue): boolean {
  if (left === null || right === null) return false;
  if (operator === '=' || operator === '==') return left === right || String(left).toLowerCase() === String(right).toLowerCase();
  if (operator === '<>' || operator === '!=') return !compareValues(left, '=', right);
  if (typeof left === 'number' && typeof right === 'number') {
    if (operator === '>') return left > right;
    if (operator === '<') return left < right;
    if (operator === '>=') return left >= right;
    if (operator === '<=') return left <= right;
  }
  const leftText = String(left).toLowerCase();
  const rightText = String(right).toLowerCase();
  if (operator === '>') return leftText > rightText;
  if (operator === '<') return leftText < rightText;
  if (operator === '>=') return leftText >= rightText;
  if (operator === '<=') return leftText <= rightText;
  return false;
}

function evaluateCondition(row: StoredRow, expression: string): boolean {
  let value = expression.trim().replace(/^\((.*)\)$/s, '$1').trim();
  if (/^NOT\s+/i.test(value)) return !evaluateCondition(row, value.replace(/^NOT\s+/i, ''));
  const orIndex = findKeywordOutside(value, 'OR');
  if (orIndex >= 0) return value.split(/\s+OR\s+/i).some((part) => evaluateCondition(row, part));
  const andIndex = findKeywordOutside(value, 'AND');
  if (andIndex >= 0) return value.split(/\s+AND\s+/i).every((part) => evaluateCondition(row, part));
  const isNull = value.match(/^(.+?)\s+IS\s+(NOT\s+)?NULL$/i);
  if (isNull) return (columnValue(row, isNull[1]) === null) !== Boolean(isNull[2]);
  const between = value.match(/^(.+?)\s+BETWEEN\s+(.+?)\s+AND\s+(.+)$/i);
  if (between) {
    const current = columnValue(row, between[1]);
    return compareValues(current, '>=', parseValue(between[2])) && compareValues(current, '<=', parseValue(between[3]));
  }
  const inList = value.match(/^(.+?)\s+IN\s*\((.*)\)$/i);
  if (inList) {
    const current = columnValue(row, inList[1]);
    return splitTopLevel(inList[2]).some((candidate) => compareValues(current, '=', parseValue(candidate)));
  }
  const like = value.match(/^(.+?)\s+LIKE\s+(.+)$/i);
  if (like) {
    const current = columnValue(row, like[1]);
    if (current === null) return false;
    const pattern = String(parseValue(like[2])).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
    return new RegExp(`^${pattern}$`, 'i').test(String(current));
  }
  const comparison = value.match(/^(.+?)\s*(<>|!=|>=|<=|=|>|<)\s*(.+)$/s);
  if (!comparison) return Boolean(columnValue(row, value));
  return compareValues(columnValue(row, comparison[1]), comparison[2], parseValue(comparison[3]));
}

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

function executeStatement(state: EngineState, statement: string): ExecutionResult {
  const start = Date.now();
  const sql = statement.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '').trim();

  let match = sql.match(/^CREATE\s+DATABASE\s+([[\]\w-]+)$/i);
  if (match) {
    const name = cleanName(match[1]);
    if (state.databases[keyOf(name)]) return errorResult(state, start, `قاعدة البيانات "${name}" موجودة بالفعل.`);
    state.databases[keyOf(name)] = { name, tables: {} };
    return success(state, start, { messages: [`تم إنشاء قاعدة البيانات ${name}.`] });
  }

  match = sql.match(/^DROP\s+DATABASE\s+([[\]\w-]+)$/i);
  if (match) {
    const name = cleanName(match[1]);
    if (!state.databases[keyOf(name)]) return errorResult(state, start, `قاعدة البيانات "${name}" غير موجودة.`);
    delete state.databases[keyOf(name)];
    if (keyOf(state.currentDatabase ?? '') === keyOf(name)) state.currentDatabase = null;
    return success(state, start, { messages: [`تم حذف قاعدة البيانات ${name}.`] });
  }

  match = sql.match(/^USE\s+([[\]\w-]+)$/i);
  if (match) {
    const name = cleanName(match[1]);
    if (!state.databases[keyOf(name)]) return errorResult(state, start, `قاعدة البيانات "${name}" غير موجودة.`);
    state.currentDatabase = name;
    return success(state, start, { messages: [`قاعدة البيانات الحالية: ${name}.`] });
  }

  const database = databaseFor(state);
  if (!database) return errorResult(state, start, 'اختر قاعدة بيانات أولًا باستخدام USE أو أنشئ قاعدة جديدة.');

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
    for (const column of columns) if (tablePrimaryKeys.some((name) => keyOf(name) === keyOf(column.name))) column.primaryKey = true;
    database.tables[keyOf(name)] = { name, columns, rows: [] };
    return success(state, start, { messages: [`تم إنشاء الجدول ${name}.`] });
  }

  match = sql.match(/^DROP\s+TABLE\s+([[\]\w.-]+)$/i);
  if (match) {
    const name = cleanName(match[1]);
    if (!tableFor(database, name)) return errorResult(state, start, `الجدول "${name}" غير موجود.`);
    delete database.tables[keyOf(name)];
    return success(state, start, { messages: [`تم حذف الجدول ${name}.`] });
  }

  match = sql.match(/^INSERT\s+INTO\s+([[\]\w.-]+)(?:\s*\(([^)]*)\))?\s+VALUES\s+([\s\S]+)$/i);
  if (match) {
    const tableName = cleanName(match[1]);
    const table = tableFor(database, tableName);
    if (!table) return errorResult(state, start, `الجدول "${tableName}" غير موجود.`);

    const targetColumns = match[2] ? splitTopLevel(match[2]).map(cleanName) : table.columns.map((column) => column.name);

    // Validate target columns exist in table
    const colErr = validateColumnsInTable(table, targetColumns);
    if (colErr) return errorResult(state, start, colErr);

    const tuples = splitTopLevelTuples(match[3]);
    if (!tuples.length) return errorResult(state, start, 'لم يتم العثور على VALUES صالحة.');

    // Atomic preparation: validate all tuples first before appending any row
    const pendingRows: StoredRow[] = [];

    for (const tuple of tuples) {
      const values = splitTopLevel(tuple).map(parseValue);
      if (values.length !== targetColumns.length) return errorResult(state, start, 'عدد القيم لا يطابق عدد الأعمدة.');

      const row: StoredRow = {};
      for (const column of table.columns) {
        const index = targetColumns.findIndex((target) => keyOf(target) === keyOf(column.name));
        row[column.name] = index >= 0 ? values[index] : column.defaultValue ?? null;
        if (!column.nullable && row[column.name] === null) return errorResult(state, start, `العمود "${column.name}" لا يقبل NULL.`);
      }

      // Check PK / Unique against existing table rows and pendingRows
      for (const column of table.columns.filter((item) => item.primaryKey || item.unique)) {
        const valueToCheck = row[column.name];
        const existsInTable = table.rows.some((existing) => compareValues(columnValue(existing, column.name), '=', valueToCheck));
        const existsInPending = pendingRows.some((pending) => compareValues(columnValue(pending, column.name), '=', valueToCheck));
        if (existsInTable || existsInPending) {
          return errorResult(state, start, `قيمة مكررة في العمود الفريد/المفتاح الرئيسي "${column.name}".`);
        }
      }

      pendingRows.push(row);
    }

    // Atomic commit
    table.rows.push(...pendingRows);
    const inserted = pendingRows.length;
    return success(state, start, { affectedRows: inserted, messages: [`(${inserted} rows affected)`] });
  }

  match = sql.match(/^SELECT\s+([\s\S]+?)\s+FROM\s+([[\]\w.-]+)\s*([\s\S]*)$/i);
  if (match) {
    const tableName = cleanName(match[2]);
    const table = tableFor(database, tableName);
    if (!table) return errorResult(state, start, `الجدول "${tableName}" غير موجود.`);

    const selectPart = match[1].trim();
    const rest = match[3].trim();
    const whereIndex = findKeywordOutside(` ${rest}`, 'WHERE');
    const orderIndex = findKeywordOutside(` ${rest}`, 'ORDER BY');
    const whereStart = whereIndex >= 0 ? whereIndex - 1 : -1;
    const orderStart = orderIndex >= 0 ? orderIndex - 1 : -1;
    const where = whereStart >= 0 ? rest.slice(whereStart + 5, orderStart >= 0 ? orderStart : rest.length).trim() : '';
    const order = orderStart >= 0 ? rest.slice(orderStart + 8).trim() : '';

    const isDistinct = /^DISTINCT\b/i.test(selectPart);
    const withoutDistinct = selectPart.replace(/^DISTINCT\s+/i, '').trim();
    const topMatch = withoutDistinct.match(/^TOP\s+(\d+)\s+([\s\S]+)$/i);
    const limit = topMatch ? Number.parseInt(topMatch[1], 10) : null;
    const projection = (topMatch ? topMatch[2] : withoutDistinct).trim();

    const selectedColumns = projection === '*' ? table.columns.map((column) => column.name) : splitTopLevel(projection).map(cleanName);

    // Validate projected columns
    if (projection !== '*') {
      const colErr = validateColumnsInTable(table, selectedColumns);
      if (colErr) return errorResult(state, start, colErr);
    }

    // Validate columns in WHERE clause
    if (where) {
      const whereCols = extractIdentifiersFromExpr(where);
      const whereColErr = validateColumnsInTable(table, whereCols);
      if (whereColErr) return errorResult(state, start, whereColErr);
    }

    // Validate columns in ORDER BY clause
    if (order) {
      const orderMatch = order.match(/^([[\]\w-]+)(?:\s+(ASC|DESC))?/i);
      if (orderMatch) {
        const orderCol = cleanName(orderMatch[1]);
        const orderColErr = validateColumnsInTable(table, [orderCol]);
        if (orderColErr) return errorResult(state, start, orderColErr);
      }
    }

    let rows = table.rows.filter((row) => !where || evaluateCondition(row, where));

    if (order) {
      const orderMatch = order.match(/^([[\]\w-]+)(?:\s+(ASC|DESC))?/i);
      if (orderMatch) {
        const direction = orderMatch[2]?.toUpperCase() === 'DESC' ? -1 : 1;
        const sortCol = cleanName(orderMatch[1]);
        rows = [...rows].sort((a, b) => {
          const left = columnValue(a, sortCol);
          const right = columnValue(b, sortCol);
          return (left === right ? 0 : String(left ?? '').localeCompare(String(right ?? ''), undefined, { numeric: true })) * direction;
        });
      }
    }

    if (isDistinct) {
      const seen = new Set<string>();
      rows = rows.filter((row) => {
        const signature = selectedColumns.map((column) => valueToText(columnValue(row, column))).join('|');
        if (seen.has(signature)) return false;
        seen.add(signature);
        return true;
      });
    }

    if (limit !== null) rows = rows.slice(0, limit);

    return success(state, start, {
      columns: selectedColumns,
      rows: rows.map((row) => selectedColumns.map((column) => valueToText(columnValue(row, column)))),
      messages: [`${rows.length} row(s) returned.`],
    });
  }

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

    // Validate assigned columns
    const setCols = assignments.map((a) => cleanName(a[1]));
    const setColErr = validateColumnsInTable(table, setCols);
    if (setColErr) return errorResult(state, start, setColErr);

    // Validate WHERE columns
    if (where) {
      const whereCols = extractIdentifiersFromExpr(where);
      const whereColErr = validateColumnsInTable(table, whereCols);
      if (whereColErr) return errorResult(state, start, whereColErr);
    }

    // Prepare updated row copies for atomic validation
    const updatedRows = table.rows.map((row) => {
      if (!where || evaluateCondition(row, where)) {
        const copy = { ...row };
        for (const assignment of assignments) {
          const col = cleanName(assignment[1]);
          copy[col] = parseValue(assignment[2]);
        }
        return { modified: true, row: copy, original: row };
      }
      return { modified: false, row: row, original: row };
    });

    // Validate constraints on updated rows
    const modifiedCount = updatedRows.filter((r) => r.modified).length;
    if (modifiedCount > 0) {
      for (const column of table.columns.filter((c) => c.primaryKey || c.unique)) {
        const valuesSeen = new Set<string>();
        for (const item of updatedRows) {
          const val = columnValue(item.row, column.name);
          const textVal = String(val).toLowerCase();
          if (valuesSeen.has(textVal)) {
            return errorResult(state, start, `قيمة مكررة في العمود الفريد/المفتاح الرئيسي "${column.name}".`);
          }
          valuesSeen.add(textVal);
        }
      }
    }

    // Atomic commit
    table.rows = updatedRows.map((item) => item.row);
    return success(state, start, { affectedRows: modifiedCount, messages: [`(${modifiedCount} rows affected)`] });
  }

  match = sql.match(/^DELETE\s+FROM\s+([[\]\w.-]+)(?:\s+WHERE\s+([\s\S]+))?$/i);
  if (match) {
    const tableName = cleanName(match[1]);
    const table = tableFor(database, tableName);
    if (!table) return errorResult(state, start, `الجدول "${tableName}" غير موجود.`);

    const where = match[2] ? match[2].trim() : '';
    if (where) {
      const whereCols = extractIdentifiersFromExpr(where);
      const whereColErr = validateColumnsInTable(table, whereCols);
      if (whereColErr) return errorResult(state, start, whereColErr);
    }

    const before = table.rows.length;
    table.rows = table.rows.filter((row) => where && !evaluateCondition(row, where));
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
