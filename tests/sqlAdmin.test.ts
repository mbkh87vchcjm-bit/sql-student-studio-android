import assert from 'node:assert';
import { test } from 'node:test';
import { EMPTY_STATE, executeScript, type EngineState } from '../lib/sqlEngine';

function createAdminState(): EngineState {
  const result = executeScript(
    EMPTY_STATE,
    `CREATE DATABASE AdminDB;
GO
USE AdminDB;
GO
CREATE TABLE Ledger (
  Id INT PRIMARY KEY,
  Name NVARCHAR(20) NOT NULL,
  Balance DECIMAL(10,2) NOT NULL
);
GO
INSERT INTO Ledger (Id, Name, Balance) VALUES
  (1, 'Opening', 100.50),
  (2, 'Deposit', 250.00);`
  );

  assert.deepStrictEqual(result.result.errors, []);
  return result.state;
}

test('ALTER TABLE ADD COLUMN applies DEFAULT to existing rows', () => {
  const state = createAdminState();
  const altered = executeScript(
    state,
    "ALTER TABLE Ledger ADD Status NVARCHAR(12) NOT NULL DEFAULT 'Active';"
  );

  assert.deepStrictEqual(altered.result.errors, []);
  const selected = executeScript(altered.state, 'SELECT Id, Status FROM Ledger ORDER BY Id;');
  assert.deepStrictEqual(selected.result.errors, []);
  assert.deepStrictEqual(selected.result.rows, [['1', 'Active'], ['2', 'Active']]);
});

test('ALTER TABLE rejects NOT NULL columns without a default on non-empty tables', () => {
  const state = createAdminState();
  const altered = executeScript(state, 'ALTER TABLE Ledger ADD RequiredCode INT NOT NULL;');

  assert.ok(altered.result.errors.length > 0);
  assert.match(altered.result.errors[0], /لا يقبل NULL/);
  assert.strictEqual(altered.state.databases.admindb.tables.ledger.columns.length, 3);
});

test('ALTER COLUMN converts compatible values and rejects incompatible conversions atomically', () => {
  const state = createAdminState();
  const converted = executeScript(state, 'ALTER TABLE Ledger ALTER COLUMN Balance NVARCHAR(12) NOT NULL;');

  assert.deepStrictEqual(converted.result.errors, []);
  assert.strictEqual(converted.state.databases.admindb.tables.ledger.columns.find((column) => column.name === 'Balance')?.type, 'NVARCHAR(12)');

  const rejected = executeScript(state, "ALTER TABLE Ledger ALTER COLUMN Balance INT NOT NULL;");
  assert.ok(rejected.result.errors.length > 0);
  assert.match(rejected.result.errors[0], /عددًا صحيحًا/);
  assert.strictEqual(rejected.state.databases.admindb.tables.ledger.columns.find((column) => column.name === 'Balance')?.type, 'DECIMAL(10,2)');
});

test('ALTER TABLE DROP COLUMN removes values but protects key columns', () => {
  const state = createAdminState();
  const added = executeScript(state, 'ALTER TABLE Ledger ADD Note NVARCHAR(20) NULL;');
  assert.deepStrictEqual(added.result.errors, []);

  const dropped = executeScript(added.state, 'ALTER TABLE Ledger DROP COLUMN Note;');
  assert.deepStrictEqual(dropped.result.errors, []);
  assert.strictEqual(dropped.state.databases.admindb.tables.ledger.columns.some((column) => column.name === 'Note'), false);

  const rejected = executeScript(dropped.state, 'ALTER TABLE Ledger DROP COLUMN Id;');
  assert.ok(rejected.result.errors.length > 0);
  assert.match(rejected.result.errors[0], /PRIMARY KEY أو UNIQUE/);
});

test('TRUNCATE TABLE removes all rows while keeping the table schema', () => {
  const state = createAdminState();
  const truncated = executeScript(state, 'TRUNCATE TABLE Ledger;');

  assert.deepStrictEqual(truncated.result.errors, []);
  assert.strictEqual(truncated.result.affectedRows, 2);
  assert.strictEqual(truncated.state.databases.admindb.tables.ledger.rows.length, 0);
  assert.strictEqual(truncated.state.databases.admindb.tables.ledger.columns.length, 3);
});

test('INSERT and UPDATE enforce column data types and lengths', () => {
  const state = createAdminState();

  const badInsert = executeScript(state, "INSERT INTO Ledger (Id, Name, Balance) VALUES (3, 'NameThatIsDefinitelyTooLongForTheColumn', 10);");
  assert.ok(badInsert.result.errors.length > 0);
  assert.match(badInsert.result.errors[0], /الحد الأقصى للطول/);
  assert.strictEqual(badInsert.state.databases.admindb.tables.ledger.rows.length, 2);

  const badUpdate = executeScript(state, "UPDATE Ledger SET Balance = 'not-a-number' WHERE Id = 1;");
  assert.ok(badUpdate.result.errors.length > 0);
  assert.match(badUpdate.result.errors[0], /يجب أن تكون رقمية/);
  assert.strictEqual(badUpdate.state.databases.admindb.tables.ledger.rows[0].Balance, 100.5);
});

test('CREATE TABLE IF NOT EXISTS does not overwrite an existing table', () => {
  const state = createAdminState();
  const created = executeScript(state, 'CREATE TABLE IF NOT EXISTS Ledger (OtherId INT);');

  assert.deepStrictEqual(created.result.errors, []);
  assert.strictEqual(created.state.databases.admindb.tables.ledger.columns.length, 3);
});

test('Composite PRIMARY KEY enforces key tuples instead of individual columns', () => {
  const created = executeScript(
    EMPTY_STATE,
    `CREATE DATABASE ConstraintDB;
USE ConstraintDB;
CREATE TABLE Enrollment (
  StudentId INT,
  CourseId INT,
  Grade INT,
  CONSTRAINT PK_Enrollment PRIMARY KEY (StudentId, CourseId),
  CONSTRAINT UQ_Enrollment_CourseGrade UNIQUE (CourseId, Grade)
);
INSERT INTO Enrollment (StudentId, CourseId, Grade) VALUES
  (1, 10, 80),
  (2, 10, 90);`
  );

  assert.deepStrictEqual(created.result.errors, []);
  const table = created.state.databases.constraintdb.tables.enrollment;
  assert.deepStrictEqual(table.primaryKeyColumns, ['StudentId', 'CourseId']);
  assert.strictEqual(table.columns.find((column) => column.name === 'StudentId')?.nullable, false);
  assert.strictEqual(table.columns.find((column) => column.name === 'CourseId')?.nullable, false);

  const validReuse = executeScript(
    created.state,
    'INSERT INTO Enrollment (StudentId, CourseId, Grade) VALUES (1, 11, 85);'
  );
  assert.deepStrictEqual(validReuse.result.errors, []);
  assert.strictEqual(validReuse.state.databases.constraintdb.tables.enrollment.rows.length, 3);

  const duplicateKey = executeScript(
    validReuse.state,
    'INSERT INTO Enrollment (StudentId, CourseId, Grade) VALUES (1, 10, 75);'
  );
  assert.ok(duplicateKey.result.errors.length > 0);
  assert.match(duplicateKey.result.errors[0], /UNIQUE أو PRIMARY KEY/);

  const duplicateUniqueTuple = executeScript(
    validReuse.state,
    'INSERT INTO Enrollment (StudentId, CourseId, Grade) VALUES (3, 10, 90);'
  );
  assert.ok(duplicateUniqueTuple.result.errors.length > 0);
  assert.match(duplicateUniqueTuple.result.errors[0], /UNIQUE أو PRIMARY KEY/);

  const nullPrimaryPart = executeScript(
    validReuse.state,
    'INSERT INTO Enrollment (StudentId, CourseId, Grade) VALUES (NULL, 12, 88);'
  );
  assert.ok(nullPrimaryPart.result.errors.length > 0);
  assert.match(nullPrimaryPart.result.errors[0], /لا يقبل NULL/);
});

test('Composite and table-level UNIQUE constraints protect their columns', () => {
  const created = executeScript(
    EMPTY_STATE,
    `CREATE DATABASE UniqueDB;
USE UniqueDB;
CREATE TABLE Inventory (
  WarehouseId INT,
  ProductId INT,
  Quantity INT,
  CONSTRAINT PK_Inventory PRIMARY KEY (WarehouseId, ProductId),
  CONSTRAINT UQ_Inventory_WarehouseQuantity UNIQUE (WarehouseId, Quantity)
);`
  );
  assert.deepStrictEqual(created.result.errors, []);

  const dropped = executeScript(created.state, 'ALTER TABLE Inventory DROP COLUMN Quantity;');
  assert.ok(dropped.result.errors.length > 0);
  assert.match(dropped.result.errors[0], /PRIMARY KEY أو UNIQUE/);
});
 
test('BEGIN TRANSACTION and ROLLBACK restore the original data', () => {
  const state = createAdminState();
  const result = executeScript(
    state,
    `BEGIN TRANSACTION;
UPDATE Ledger SET Balance = 999 WHERE Id = 1;
ROLLBACK TRANSACTION;`
  );

  assert.deepStrictEqual(result.result.errors, []);
  assert.strictEqual(result.state.databases.admindb.tables.ledger.rows[0].Balance, 100.5);
  assert.ok(result.result.messages.some((message) => message.includes('ROLLBACK')));
});

test('COMMIT persists changes made inside a transaction', () => {
  const state = createAdminState();
  const result = executeScript(
    state,
    `BEGIN TRAN;
UPDATE Ledger SET Balance = 300 WHERE Id = 1;
COMMIT;`
  );

  assert.deepStrictEqual(result.result.errors, []);
  assert.strictEqual(result.state.databases.admindb.tables.ledger.rows[0].Balance, 300);
});

test('A failed statement rolls back the active transaction', () => {
  const state = createAdminState();
  const result = executeScript(
    state,
    `BEGIN TRANSACTION;
UPDATE Ledger SET Balance = 999 WHERE Id = 1;
INSERT INTO Ledger (Id, Name, Balance) VALUES (1, 'Duplicate', 10);
COMMIT;`
  );

  assert.ok(result.result.errors.length > 0);
  assert.strictEqual(result.state.databases.admindb.tables.ledger.rows[0].Balance, 100.5);
  assert.strictEqual(result.state.databases.admindb.tables.ledger.rows.length, 2);
  assert.ok(result.result.messages.some((message) => message.includes('التراجع تلقائيًا')));
});

test('An uncommitted transaction is rolled back at the end of a script', () => {
  const state = createAdminState();
  const result = executeScript(
    state,
    `BEGIN TRANSACTION;
DELETE FROM Ledger WHERE Id = 1;`
  );

  assert.ok(result.result.errors.some((message) => message.includes('دون تنفيذ COMMIT')));
  assert.strictEqual(result.state.databases.admindb.tables.ledger.rows.length, 2);
});
