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
  assert.match(rejected.result.errors[0], /لا يمكن حذف العمود/);
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
  assert.match(dropped.result.errors[0], /لا يمكن حذف العمود/);
});

test('FOREIGN KEY enforces parent references during INSERT and UPDATE', () => {
  const created = executeScript(
    EMPTY_STATE,
    `CREATE DATABASE ForeignKeyDB;
USE ForeignKeyDB;
CREATE TABLE Departments (
  DepartmentId INT PRIMARY KEY,
  Name NVARCHAR(30) NOT NULL
);
INSERT INTO Departments (DepartmentId, Name) VALUES (1, 'IT'), (2, 'Networks');
CREATE TABLE Students (
  StudentId INT PRIMARY KEY,
  Name NVARCHAR(30) NOT NULL,
  DepartmentId INT NULL,
  CONSTRAINT FK_Students_Departments FOREIGN KEY (DepartmentId)
    REFERENCES Departments(DepartmentId)
);`
  );
  assert.deepStrictEqual(created.result.errors, []);

  const valid = executeScript(
    created.state,
    `INSERT INTO Students (StudentId, Name, DepartmentId) VALUES
      (1, 'Ali', 1),
      (2, 'Sara', NULL);`
  );
  assert.deepStrictEqual(valid.result.errors, []);
  assert.strictEqual(valid.state.databases.foreignkeydb.tables.students.rows.length, 2);

  const invalidInsert = executeScript(
    valid.state,
    "INSERT INTO Students (StudentId, Name, DepartmentId) VALUES (3, 'Mona', 99);"
  );
  assert.ok(invalidInsert.result.errors.length > 0);
  assert.match(invalidInsert.result.errors[0], /لا تطابق أي قيمة/);
  assert.strictEqual(invalidInsert.state.databases.foreignkeydb.tables.students.rows.length, 2);

  const invalidUpdate = executeScript(
    valid.state,
    'UPDATE Students SET DepartmentId = 77 WHERE StudentId = 1;'
  );
  assert.ok(invalidUpdate.result.errors.length > 0);
  assert.match(invalidUpdate.result.errors[0], /لا تطابق أي قيمة/);
  assert.strictEqual(invalidUpdate.state.databases.foreignkeydb.tables.students.rows[0].DepartmentId, 1);
});

test('FOREIGN KEY prevents deleting or truncating referenced parent rows and dropping parent tables', () => {
  const created = executeScript(
    EMPTY_STATE,
    `CREATE DATABASE ReferenceDB;
USE ReferenceDB;
CREATE TABLE Departments (Id INT PRIMARY KEY);
INSERT INTO Departments (Id) VALUES (1), (2);
CREATE TABLE Students (
  Id INT PRIMARY KEY,
  DepartmentId INT,
  FOREIGN KEY (DepartmentId) REFERENCES Departments(Id)
);
INSERT INTO Students (Id, DepartmentId) VALUES (10, 1);`
  );
  assert.deepStrictEqual(created.result.errors, []);

  const deleted = executeScript(created.state, 'DELETE FROM Departments WHERE Id = 1;');
  assert.ok(deleted.result.errors.length > 0);
  assert.match(deleted.result.errors[0], /مرتبطة بالقيد الخارجي/);
  assert.strictEqual(deleted.state.databases.referencedb.tables.departments.rows.length, 2);

  const truncated = executeScript(created.state, 'TRUNCATE TABLE Departments;');
  assert.ok(truncated.result.errors.length > 0);
  assert.match(truncated.result.errors[0], /مرجع في قيد FOREIGN KEY/);
  assert.strictEqual(truncated.state.databases.referencedb.tables.departments.rows.length, 2);

  const dropped = executeScript(created.state, 'DROP TABLE Departments;');
  assert.ok(dropped.result.errors.length > 0);
  assert.match(dropped.result.errors[0], /مرجع في قيد FOREIGN KEY/);
  assert.ok(dropped.state.databases.referencedb.tables.departments);
});

test('FOREIGN KEY definitions must reference an existing single-column primary or unique key', () => {
  const base = executeScript(
    EMPTY_STATE,
    `CREATE DATABASE ForeignDefinitionDB;
USE ForeignDefinitionDB;
CREATE TABLE Departments (
  Id INT PRIMARY KEY,
  Name NVARCHAR(30)
);`
  );
  assert.deepStrictEqual(base.result.errors, []);

  const missingTable = executeScript(
    base.state,
    'CREATE TABLE MissingChild (Id INT PRIMARY KEY, DepartmentId INT REFERENCES UnknownDepartments(Id));'
  );
  assert.ok(missingTable.result.errors.length > 0);
  assert.match(missingTable.result.errors[0], /غير موجود في قاعدة البيانات/);
  assert.strictEqual(Boolean(missingTable.state.databases.foreigndefinitiondb.tables.missingchild), false);

  const nonUniqueTarget = executeScript(
    base.state,
    'CREATE TABLE BadChild (Id INT PRIMARY KEY, DepartmentName NVARCHAR(30), FOREIGN KEY (DepartmentName) REFERENCES Departments(Name));'
  );
  assert.ok(nonUniqueTarget.result.errors.length > 0);
  assert.match(nonUniqueTarget.result.errors[0], /PRIMARY KEY أو UNIQUE/);
  assert.strictEqual(Boolean(nonUniqueTarget.state.databases.foreigndefinitiondb.tables.badchild), false);

  const incompatibleTypes = executeScript(
    base.state,
    'CREATE TABLE IncompatibleChild (Id INT PRIMARY KEY, DepartmentId NVARCHAR(20), FOREIGN KEY (DepartmentId) REFERENCES Departments(Id));'
  );
  assert.ok(incompatibleTypes.result.errors.length > 0);
  assert.match(incompatibleTypes.result.errors[0], /نوع عمود المفتاح الخارجي/);
  assert.strictEqual(Boolean(incompatibleTypes.state.databases.foreigndefinitiondb.tables.incompatiblechild), false);

  const compositeParent = executeScript(
    base.state,
    `CREATE TABLE CompositeDepartments (
      RegionId INT,
      DepartmentId INT,
      CONSTRAINT PK_CompositeDepartments PRIMARY KEY (RegionId, DepartmentId)
    );`
  );
  assert.deepStrictEqual(compositeParent.result.errors, []);
  const partialCompositeReference = executeScript(
    compositeParent.state,
    'CREATE TABLE PartialChild (Id INT PRIMARY KEY, RegionId INT, FOREIGN KEY (RegionId) REFERENCES CompositeDepartments(RegionId));'
  );
  assert.ok(partialCompositeReference.result.errors.length > 0);
  assert.match(partialCompositeReference.result.errors[0], /PRIMARY KEY أو UNIQUE/);
  assert.strictEqual(Boolean(partialCompositeReference.state.databases.foreigndefinitiondb.tables.partialchild), false);
});

test('ALTER TABLE ADD FOREIGN KEY validates existing rows before saving the constraint', () => {
  const created = executeScript(
    EMPTY_STATE,
    `CREATE DATABASE AlterForeignDB;
USE AlterForeignDB;
CREATE TABLE Departments (Id INT PRIMARY KEY);
INSERT INTO Departments (Id) VALUES (1);
CREATE TABLE Students (Id INT PRIMARY KEY, DepartmentId INT);
INSERT INTO Students (Id, DepartmentId) VALUES (10, 99);`
  );
  assert.deepStrictEqual(created.result.errors, []);

  const altered = executeScript(
    created.state,
    'ALTER TABLE Students ADD CONSTRAINT FK_Students_Departments FOREIGN KEY (DepartmentId) REFERENCES Departments(Id);'
  );
  assert.ok(altered.result.errors.length > 0);
  assert.match(altered.result.errors[0], /لا تطابق أي قيمة/);
  assert.strictEqual(altered.state.databases.alterforeigndb.tables.students.foreignKeys, undefined);

  const afterFailure = executeScript(
    altered.state,
    'INSERT INTO Students (Id, DepartmentId) VALUES (11, 100);'
  );
  assert.deepStrictEqual(afterFailure.result.errors, []);
});

test('ALTER TABLE DROP CONSTRAINT removes a foreign key and releases the parent table', () => {
  const created = executeScript(
    EMPTY_STATE,
    `CREATE DATABASE DropForeignKeyDB;
USE DropForeignKeyDB;
CREATE TABLE Departments (Id INT PRIMARY KEY);
INSERT INTO Departments (Id) VALUES (1);
CREATE TABLE Students (
  Id INT PRIMARY KEY,
  DepartmentId INT,
  CONSTRAINT FK_Students_Departments FOREIGN KEY (DepartmentId) REFERENCES Departments(Id)
);
INSERT INTO Students (Id, DepartmentId) VALUES (10, 1);`
  );
  assert.deepStrictEqual(created.result.errors, []);

  const removed = executeScript(
    created.state,
    'ALTER TABLE Students DROP CONSTRAINT FK_Students_Departments;'
  );
  assert.deepStrictEqual(removed.result.errors, []);
  assert.strictEqual(removed.state.databases.dropforeignkeydb.tables.students.foreignKeys, undefined);

  const parentDelete = executeScript(
    removed.state,
    'DELETE FROM Departments WHERE Id = 1;'
  );
  assert.deepStrictEqual(parentDelete.result.errors, []);
  assert.strictEqual(parentDelete.state.databases.dropforeignkeydb.tables.departments.rows.length, 0);

  const orphanInsert = executeScript(
    parentDelete.state,
    'INSERT INTO Students (Id, DepartmentId) VALUES (11, 99);'
  );
  assert.deepStrictEqual(orphanInsert.result.errors, []);
  assert.strictEqual(orphanInsert.state.databases.dropforeignkeydb.tables.students.rows.length, 2);
});

test('Self-referencing FOREIGN KEY accepts related rows in one INSERT and protects referenced rows', () => {
  const created = executeScript(
    EMPTY_STATE,
    `CREATE DATABASE SelfReferenceDB;
USE SelfReferenceDB;
CREATE TABLE Employees (
  Id INT PRIMARY KEY,
  Name NVARCHAR(30) NOT NULL,
  ManagerId INT NULL,
  CONSTRAINT FK_Employees_Manager FOREIGN KEY (ManagerId) REFERENCES Employees(Id)
);
INSERT INTO Employees (Id, Name, ManagerId) VALUES
  (1, 'Manager', NULL),
  (2, 'Employee', 1);`
  );
  assert.deepStrictEqual(created.result.errors, []);
  assert.strictEqual(created.state.databases.selfreferencedb.tables.employees.rows.length, 2);

  const missingManager = executeScript(
    created.state,
    "INSERT INTO Employees (Id, Name, ManagerId) VALUES (3, 'Orphan', 99);"
  );
  assert.ok(missingManager.result.errors.length > 0);
  assert.match(missingManager.result.errors[0], /لا تطابق أي قيمة/);
  assert.strictEqual(missingManager.state.databases.selfreferencedb.tables.employees.rows.length, 2);

  const deleteManager = executeScript(created.state, 'DELETE FROM Employees WHERE Id = 1;');
  assert.ok(deleteManager.result.errors.length > 0);
  assert.match(deleteManager.result.errors[0], /مرتبطة بالقيد الخارجي/);
  assert.strictEqual(deleteManager.state.databases.selfreferencedb.tables.employees.rows.length, 2);
});

test('CHECK constraints validate INSERT and UPDATE while allowing SQL UNKNOWN', () => {
  const created = executeScript(
    EMPTY_STATE,
    `CREATE DATABASE CheckDB;
USE CheckDB;
CREATE TABLE Products (
  Id INT PRIMARY KEY,
  Price DECIMAL(10,2),
  Quantity INT CHECK (Quantity >= 0),
  CONSTRAINT CK_Products_Price CHECK (Price >= 0)
);
INSERT INTO Products (Id, Price, Quantity) VALUES
  (1, 10.5, 3),
  (2, NULL, 0);`
  );
  assert.deepStrictEqual(created.result.errors, []);
  assert.strictEqual(created.state.databases.checkdb.tables.products.rows.length, 2);

  const invalidInsert = executeScript(
    created.state,
    'INSERT INTO Products (Id, Price, Quantity) VALUES (3, -1, 2);'
  );
  assert.ok(invalidInsert.result.errors.length > 0);
  assert.match(invalidInsert.result.errors[0], /قيد CHECK/);
  assert.strictEqual(invalidInsert.state.databases.checkdb.tables.products.rows.length, 2);

  const invalidUpdate = executeScript(
    created.state,
    'UPDATE Products SET Quantity = -5 WHERE Id = 1;'
  );
  assert.ok(invalidUpdate.result.errors.length > 0);
  assert.match(invalidUpdate.result.errors[0], /قيد CHECK/);
  assert.strictEqual(invalidUpdate.state.databases.checkdb.tables.products.rows[0].Quantity, 3);

  const nullable = executeScript(
    created.state,
    'INSERT INTO Products (Id, Price, Quantity) VALUES (4, NULL, 5);'
  );
  assert.deepStrictEqual(nullable.result.errors, []);
});

test('CHECK constraints preserve SQL three-valued logic for AND and OR', () => {
  const created = executeScript(
    EMPTY_STATE,
    `CREATE DATABASE CheckNullLogicDB;
USE CheckNullLogicDB;
CREATE TABLE NullLogic (
  Id INT PRIMARY KEY,
  Price INT NULL,
  Bonus INT NULL,
  CONSTRAINT CK_NullLogic_And CHECK (Price >= 0 AND Bonus IS NULL),
  CONSTRAINT CK_NullLogic_Or CHECK (Price >= 0 OR Bonus >= 1)
);
INSERT INTO NullLogic (Id, Price, Bonus) VALUES (1, NULL, NULL);`
  );
  assert.deepStrictEqual(created.result.errors, []);
  assert.strictEqual(created.state.databases.checknulllogicdb.tables.nulllogic.rows.length, 1);

  const invalid = executeScript(
    created.state,
    'INSERT INTO NullLogic (Id, Price, Bonus) VALUES (2, -1, 0);'
  );
  assert.ok(invalid.result.errors.length > 0);
  assert.match(invalid.result.errors[0], /قيد CHECK/);
  assert.strictEqual(invalid.state.databases.checknulllogicdb.tables.nulllogic.rows.length, 1);
});

test('ALTER TABLE ADD CHECK validates existing data and DROP CONSTRAINT removes it', () => {
  const created = executeScript(
    EMPTY_STATE,
    `CREATE DATABASE AlterCheckDB;
USE AlterCheckDB;
CREATE TABLE Students (Id INT PRIMARY KEY, Score INT);
INSERT INTO Students (Id, Score) VALUES (1, 80), (2, 90);`
  );
  assert.deepStrictEqual(created.result.errors, []);

  const added = executeScript(
    created.state,
    'ALTER TABLE Students ADD CONSTRAINT CK_Students_Score CHECK (Score BETWEEN 0 AND 100);'
  );
  assert.deepStrictEqual(added.result.errors, []);
  assert.strictEqual(added.state.databases.altercheckdb.tables.students.checkConstraints?.length, 1);

  const badUpdate = executeScript(
    added.state,
    'UPDATE Students SET Score = 120 WHERE Id = 1;'
  );
  assert.ok(badUpdate.result.errors.length > 0);
  assert.match(badUpdate.result.errors[0], /قيد CHECK/);

  const removed = executeScript(
    added.state,
    'ALTER TABLE Students DROP CONSTRAINT CK_Students_Score;'
  );
  assert.deepStrictEqual(removed.result.errors, []);
  assert.strictEqual(removed.state.databases.altercheckdb.tables.students.checkConstraints, undefined);

  const nowAllowed = executeScript(
    removed.state,
    'UPDATE Students SET Score = 120 WHERE Id = 1;'
  );
  assert.deepStrictEqual(nowAllowed.result.errors, []);
});

test('ALTER TABLE ADD CHECK rejects existing violations without saving the constraint', () => {
  const created = executeScript(
    EMPTY_STATE,
    `CREATE DATABASE ExistingCheckDB;
USE ExistingCheckDB;
CREATE TABLE Items (Id INT PRIMARY KEY, Quantity INT);
INSERT INTO Items (Id, Quantity) VALUES (1, 5), (2, -3);`
  );
  assert.deepStrictEqual(created.result.errors, []);

  const altered = executeScript(
    created.state,
    'ALTER TABLE Items ADD CONSTRAINT CK_Items_Quantity CHECK (Quantity >= 0);'
  );
  assert.ok(altered.result.errors.length > 0);
  assert.match(altered.result.errors[0], /قيد CHECK/);
  assert.strictEqual(altered.state.databases.existingcheckdb.tables.items.checkConstraints, undefined);
});

test('CHECK constraints prevent dropping columns referenced by their expressions', () => {
  const created = executeScript(
    EMPTY_STATE,
    `CREATE DATABASE CheckColumnDB;
USE CheckColumnDB;
CREATE TABLE Accounts (
  Id INT PRIMARY KEY,
  Balance DECIMAL(10,2),
  CONSTRAINT CK_Accounts_Balance CHECK (Balance >= 0)
);`
  );
  assert.deepStrictEqual(created.result.errors, []);

  const dropped = executeScript(created.state, 'ALTER TABLE Accounts DROP COLUMN Balance;');
  assert.ok(dropped.result.errors.length > 0);
  assert.match(dropped.result.errors[0], /لا يمكن حذف العمود/);
  assert.ok(dropped.state.databases.checkcolumndb.tables.accounts.columns.some((column) => column.name === 'Balance'));
});

test('Named DEFAULT constraints apply values and can be removed', () => {
  const created = executeScript(
    EMPTY_STATE,
    `CREATE DATABASE DefaultConstraintDB;
USE DefaultConstraintDB;
CREATE TABLE Tasks (
  Id INT PRIMARY KEY,
  Status NVARCHAR(20) CONSTRAINT DF_Tasks_Status DEFAULT 'Pending'
);
INSERT INTO Tasks (Id) VALUES (1);`
  );
  assert.deepStrictEqual(created.result.errors, []);
  assert.strictEqual(created.state.databases.defaultconstraintdb.tables.tasks.rows[0].Status, 'Pending');

  const removed = executeScript(
    created.state,
    'ALTER TABLE Tasks DROP CONSTRAINT DF_Tasks_Status;'
  );
  assert.deepStrictEqual(removed.result.errors, []);
  assert.strictEqual(removed.state.databases.defaultconstraintdb.tables.tasks.columns.find((column) => column.name === 'Status')?.defaultValue, undefined);

  const inserted = executeScript(
    removed.state,
    'INSERT INTO Tasks (Id) VALUES (2);'
  );
  assert.deepStrictEqual(inserted.result.errors, []);
  assert.strictEqual(inserted.state.databases.defaultconstraintdb.tables.tasks.rows[1].Status, null);
});

test('ALTER TABLE ADD DEFAULT validates the type and protects its column until dropped', () => {
  const created = executeScript(
    EMPTY_STATE,
    `CREATE DATABASE AlterDefaultDB;
USE AlterDefaultDB;
CREATE TABLE Users (Id INT PRIMARY KEY, Active BIT NULL);`
  );
  assert.deepStrictEqual(created.result.errors, []);

  const invalidDefault = executeScript(
    created.state,
    "ALTER TABLE Users ADD CONSTRAINT DF_Users_Active DEFAULT 2 FOR Active;"
  );
  assert.ok(invalidDefault.result.errors.length > 0);
  assert.match(invalidDefault.result.errors[0], /BIT يقبل القيمتين/);
  assert.strictEqual(invalidDefault.state.databases.alterdefaultdb.tables.users.columns.find((column) => column.name === 'Active')?.defaultConstraintName, undefined);

  const added = executeScript(
    created.state,
    'ALTER TABLE Users ADD CONSTRAINT DF_Users_Active DEFAULT 1 FOR Active;'
  );
  assert.deepStrictEqual(added.result.errors, []);
  const inserted = executeScript(added.state, 'INSERT INTO Users (Id) VALUES (1);');
  assert.deepStrictEqual(inserted.result.errors, []);
  assert.strictEqual(inserted.state.databases.alterdefaultdb.tables.users.rows[0].Active, 1);

  const blockedDrop = executeScript(inserted.state, 'ALTER TABLE Users DROP COLUMN Active;');
  assert.ok(blockedDrop.result.errors.length > 0);
  assert.match(blockedDrop.result.errors[0], /لا يمكن حذف العمود/);

  const removed = executeScript(
    inserted.state,
    'ALTER TABLE Users DROP CONSTRAINT DF_Users_Active;'
  );
  assert.deepStrictEqual(removed.result.errors, []);
  const allowedDrop = executeScript(removed.state, 'ALTER TABLE Users DROP COLUMN Active;');
  assert.deepStrictEqual(allowedDrop.result.errors, []);
});

test('CREATE INDEX and DROP INDEX maintain index metadata and protect indexed columns', () => {
  const created = executeScript(
    EMPTY_STATE,
    `CREATE DATABASE IndexDB;
USE IndexDB;
CREATE TABLE Products (
  Id INT PRIMARY KEY,
  CategoryId INT NOT NULL,
  Code NVARCHAR(20) NOT NULL,
  Price DECIMAL(10,2)
);
INSERT INTO Products (Id, CategoryId, Code, Price) VALUES
  (1, 10, 'A-1', 25.5),
  (2, 10, 'A-2', 30.0);`
  );
  assert.deepStrictEqual(created.result.errors, []);

  const regular = executeScript(
    created.state,
    'CREATE INDEX IX_Products_Category ON Products (CategoryId);'
  );
  assert.deepStrictEqual(regular.result.errors, []);
  assert.deepStrictEqual(regular.state.databases.indexdb.tables.products.indexes?.[0], {
    name: 'IX_Products_Category',
    columns: ['CategoryId'],
    unique: false,
  });

  const unique = executeScript(
    regular.state,
    'CREATE UNIQUE INDEX UX_Products_Code ON Products (Code);'
  );
  assert.deepStrictEqual(unique.result.errors, []);
  assert.strictEqual(unique.state.databases.indexdb.tables.products.indexes?.length, 2);

  const duplicate = executeScript(
    unique.state,
    "INSERT INTO Products (Id, CategoryId, Code, Price) VALUES (3, 11, 'A-1', 40);"
  );
  assert.ok(duplicate.result.errors.length > 0);
  assert.match(duplicate.result.errors[0], /UNIQUE أو PRIMARY KEY/);
  assert.strictEqual(duplicate.state.databases.indexdb.tables.products.rows.length, 2);

  const blockedDrop = executeScript(
    unique.state,
    'ALTER TABLE Products DROP COLUMN Code;'
  );
  assert.ok(blockedDrop.result.errors.length > 0);
  assert.match(blockedDrop.result.errors[0], /فهرس/);

  const removed = executeScript(
    unique.state,
    'DROP INDEX UX_Products_Code ON Products;'
  );
  assert.deepStrictEqual(removed.result.errors, []);
  assert.strictEqual(removed.state.databases.indexdb.tables.products.indexes?.length, 1);

  const nowAllowed = executeScript(
    removed.state,
    "INSERT INTO Products (Id, CategoryId, Code, Price) VALUES (3, 11, 'A-1', 40);"
  );
  assert.deepStrictEqual(nowAllowed.result.errors, []);
  assert.strictEqual(nowAllowed.state.databases.indexdb.tables.products.rows.length, 3);
});

test('UNIQUE INDEX rejects existing duplicates and invalid index definitions', () => {
  const created = executeScript(
    EMPTY_STATE,
    `CREATE DATABASE InvalidIndexDB;
USE InvalidIndexDB;
CREATE TABLE Users (Id INT PRIMARY KEY, Email NVARCHAR(50));
INSERT INTO Users (Id, Email) VALUES (1, 'same@example.com'), (2, 'same@example.com');`
  );
  assert.deepStrictEqual(created.result.errors, []);

  const rejected = executeScript(
    created.state,
    'CREATE UNIQUE INDEX UX_Users_Email ON Users (Email);'
  );
  assert.ok(rejected.result.errors.length > 0);
  assert.match(rejected.result.errors[0], /UNIQUE أو PRIMARY KEY/);
  assert.strictEqual(rejected.state.databases.invalidindexdb.tables.users.indexes, undefined);

  const missingColumn = executeScript(
    created.state,
    'CREATE INDEX IX_Users_Missing ON Users (MissingColumn);'
  );
  assert.ok(missingColumn.result.errors.length > 0);
  assert.match(missingColumn.result.errors[0], /غير موجود في الجدول/);

  const duplicateColumns = executeScript(
    created.state,
    'CREATE INDEX IX_Users_Duplicate ON Users (Email, Email);'
  );
  assert.ok(duplicateColumns.result.errors.length > 0);
  assert.match(duplicateColumns.result.errors[0], /مكررة أو غير صالحة/);
});

test('Composite UNIQUE INDEX enforces the full column combination', () => {
  const created = executeScript(
    EMPTY_STATE,
    `CREATE DATABASE CompositeIndexDB;
USE CompositeIndexDB;
CREATE TABLE Registrations (Id INT PRIMARY KEY, StudentId INT, CourseId INT);
INSERT INTO Registrations (Id, StudentId, CourseId) VALUES (1, 10, 20), (2, 10, 21);
CREATE UNIQUE INDEX UX_Registrations_StudentCourse ON Registrations (StudentId, CourseId);`
  );
  assert.deepStrictEqual(created.result.errors, []);

  const validReuse = executeScript(
    created.state,
    'INSERT INTO Registrations (Id, StudentId, CourseId) VALUES (3, 10, 22);'
  );
  assert.deepStrictEqual(validReuse.result.errors, []);

  const duplicatePair = executeScript(
    validReuse.state,
    'INSERT INTO Registrations (Id, StudentId, CourseId) VALUES (4, 10, 20);'
  );
  assert.ok(duplicatePair.result.errors.length > 0);
  assert.strictEqual(duplicatePair.state.databases.compositeindexdb.tables.registrations.rows.length, 3);
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


/* ==========================================================================
   VIEWS: live SELECT-backed schema objects
   ========================================================================== */

test('CREATE VIEW exposes a live filtered SELECT and supports WHERE / ORDER BY', () => {
  const state = createAdminState();
  const created = executeScript(state, 'CREATE VIEW HighBalances AS SELECT Id, Name, Balance FROM Ledger WHERE Balance >= 200;');
  assert.deepStrictEqual(created.result.errors, []);
  assert.ok(created.state.databases.admindb.views?.highbalances);

  const selected = executeScript(created.state, 'SELECT Id, Name FROM HighBalances ORDER BY Id;');
  assert.deepStrictEqual(selected.result.errors, []);
  assert.deepStrictEqual(selected.result.columns, ['Id', 'Name']);
  assert.deepStrictEqual(selected.result.rows, [['2', 'Deposit']]);
});

test('VIEW results are recalculated after base-table INSERT and UPDATE', () => {
  const state = createAdminState();
  const created = executeScript(state, 'CREATE VIEW LedgerView AS SELECT Id, Name, Balance FROM Ledger WHERE Balance >= 200;');
  assert.deepStrictEqual(created.result.errors, []);

  const updated = executeScript(created.state, 'UPDATE Ledger SET Balance = 300 WHERE Id = 1;');
  assert.deepStrictEqual(updated.result.errors, []);
  const selected = executeScript(updated.state, 'SELECT Id, Balance FROM LedgerView ORDER BY Id;');
  assert.deepStrictEqual(selected.result.errors, []);
  assert.deepStrictEqual(selected.result.rows, [['1', '300'], ['2', '250']]);
});

test('Nested views resolve their underlying view definitions', () => {
  const state = createAdminState();
  const first = executeScript(state, 'CREATE VIEW PositiveBalances AS SELECT Id, Name, Balance FROM Ledger WHERE Balance > 0;');
  assert.deepStrictEqual(first.result.errors, []);
  const second = executeScript(first.state, 'CREATE VIEW NamedBalances AS SELECT Name, Balance FROM PositiveBalances WHERE Name <> \'Opening\';');
  assert.deepStrictEqual(second.result.errors, []);

  const selected = executeScript(second.state, 'SELECT Name, Balance FROM NamedBalances;');
  assert.deepStrictEqual(selected.result.errors, []);
  assert.deepStrictEqual(selected.result.rows, [['Deposit', '250']]);
});

test('ALTER VIEW replaces its validated query definition', () => {
  const state = createAdminState();
  const created = executeScript(state, 'CREATE VIEW LedgerView AS SELECT Id, Name FROM Ledger;');
  assert.deepStrictEqual(created.result.errors, []);
  const altered = executeScript(created.state, 'ALTER VIEW LedgerView AS SELECT Id, Balance FROM Ledger WHERE Balance > 150;');
  assert.deepStrictEqual(altered.result.errors, []);

  const selected = executeScript(altered.state, 'SELECT Id, Balance FROM LedgerView;');
  assert.deepStrictEqual(selected.result.errors, []);
  assert.deepStrictEqual(selected.result.rows, [['2', '250']]);
});

test('VIEW creation rejects invalid source references and duplicate output names', () => {
  const state = createAdminState();
  const invalidSource = executeScript(state, 'CREATE VIEW BrokenView AS SELECT MissingColumn FROM Ledger;');
  assert.ok(invalidSource.result.errors.length > 0);
  assert.match(invalidSource.result.errors[0], /تعريف VIEW غير صالح/);
  assert.strictEqual(invalidSource.state.databases.admindb.views, undefined);

  const duplicateNames = executeScript(state, 'CREATE VIEW DuplicateNames AS SELECT Id, Name AS Id FROM Ledger;');
  assert.ok(duplicateNames.result.errors.length > 0);
  assert.match(duplicateNames.result.errors[0], /أسماء أعمدة العرض يجب أن تكون فريدة/);
});

test('DROP VIEW removes the view and supports IF EXISTS', () => {
  const state = createAdminState();
  const created = executeScript(state, 'CREATE VIEW LedgerView AS SELECT Id, Name FROM Ledger;');
  assert.deepStrictEqual(created.result.errors, []);
  const dropped = executeScript(created.state, 'DROP VIEW LedgerView;');
  assert.deepStrictEqual(dropped.result.errors, []);
  assert.strictEqual(dropped.state.databases.admindb.views, undefined);

  const missing = executeScript(dropped.state, 'DROP VIEW IF EXISTS LedgerView;');
  assert.deepStrictEqual(missing.result.errors, []);
  const query = executeScript(missing.state, 'SELECT * FROM LedgerView;');
  assert.ok(query.result.errors.length > 0);
});

test('VIEW names cannot collide with tables and invalid ALTER VIEW is atomic', () => {
  const state = createAdminState();
  const collision = executeScript(state, 'CREATE VIEW Ledger AS SELECT Id FROM Ledger;');
  assert.ok(collision.result.errors.length > 0);

  const created = executeScript(state, 'CREATE VIEW LedgerView AS SELECT Id, Name FROM Ledger;');
  assert.deepStrictEqual(created.result.errors, []);
  const invalidAlter = executeScript(created.state, 'ALTER VIEW LedgerView AS SELECT UnknownColumn FROM Ledger;');
  assert.ok(invalidAlter.result.errors.length > 0);
  const stillWorks = executeScript(invalidAlter.state, 'SELECT Id, Name FROM LedgerView ORDER BY Id;');
  assert.deepStrictEqual(stillWorks.result.errors, []);
  assert.deepStrictEqual(stillWorks.result.rows, [['1', 'Opening'], ['2', 'Deposit']]);
});


test('ALTER VIEW rejects circular view dependencies and preserves the previous definition', () => {
  const state = createAdminState();
  const first = executeScript(state, 'CREATE VIEW ViewOne AS SELECT Id, Name FROM Ledger;');
  assert.deepStrictEqual(first.result.errors, []);
  const second = executeScript(first.state, 'CREATE VIEW ViewTwo AS SELECT Id, Name FROM ViewOne;');
  assert.deepStrictEqual(second.result.errors, []);

  const circular = executeScript(second.state, 'ALTER VIEW ViewOne AS SELECT Id, Name FROM ViewTwo;');
  assert.ok(circular.result.errors.length > 0);
  assert.match(circular.result.errors[0], /اعتماد دائري/);

  const stillValid = executeScript(circular.state, 'SELECT Id, Name FROM ViewOne ORDER BY Id;');
  assert.deepStrictEqual(stillValid.result.errors, []);
  assert.deepStrictEqual(stillValid.result.rows, [['1', 'Opening'], ['2', 'Deposit']]);
});


/* ==========================================================================
   INFORMATION_SCHEMA: educational database metadata
   ========================================================================== */

test('INFORMATION_SCHEMA.TABLES lists base tables and views', () => {
  const state = createAdminState();
  const created = executeScript(state, 'CREATE VIEW LedgerSummary AS SELECT Id, Balance FROM Ledger;');
  assert.deepStrictEqual(created.result.errors, []);
  const result = executeScript(created.state, 'SELECT TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES ORDER BY TABLE_NAME;');
  assert.deepStrictEqual(result.result.errors, []);
  assert.deepStrictEqual(result.result.rows, [['Ledger', 'BASE TABLE'], ['LedgerSummary', 'VIEW']]);
});

test('INFORMATION_SCHEMA.COLUMNS returns ordered types, nullability and character lengths', () => {
  const state = createAdminState();
  const result = executeScript(state, "SELECT COLUMN_NAME, ORDINAL_POSITION, DATA_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Ledger' ORDER BY ORDINAL_POSITION;");
  assert.deepStrictEqual(result.result.errors, []);
  assert.deepStrictEqual(result.result.rows, [
    ['Id', '1', 'INT', 'NO', 'NULL'],
    ['Name', '2', 'NVARCHAR', 'NO', '20'],
    ['Balance', '3', 'DECIMAL', 'NO', 'NULL'],
  ]);
});

test('INFORMATION_SCHEMA.TABLE_CONSTRAINTS describes primary and named default constraints', () => {
  const created = executeScript(EMPTY_STATE, "CREATE DATABASE CatalogDB; USE CatalogDB; CREATE TABLE Accounts (Id INT PRIMARY KEY, Status NVARCHAR(12) CONSTRAINT DF_Accounts_Status DEFAULT 'Open');");
  assert.deepStrictEqual(created.result.errors, []);
  const result = executeScript(created.state, 'SELECT CONSTRAINT_NAME, CONSTRAINT_TYPE, TABLE_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS ORDER BY CONSTRAINT_TYPE;');
  assert.deepStrictEqual(result.result.errors, []);
  assert.deepStrictEqual(result.result.rows, [
    ['DF_Accounts_Status', 'DEFAULT', 'Accounts'],
    ['PK_Accounts', 'PRIMARY KEY', 'Accounts'],
  ]);
});

test('INFORMATION_SCHEMA.VIEWS exposes definitions and view output columns', () => {
  const state = createAdminState();
  const created = executeScript(state, 'CREATE VIEW LedgerSummary AS SELECT Id AS EntryId, Balance FROM Ledger;');
  assert.deepStrictEqual(created.result.errors, []);
  const views = executeScript(created.state, 'SELECT TABLE_NAME, VIEW_DEFINITION, IS_UPDATABLE FROM INFORMATION_SCHEMA.VIEWS;');
  assert.deepStrictEqual(views.result.errors, []);
  assert.deepStrictEqual(views.result.rows, [['LedgerSummary', 'SELECT Id AS EntryId, Balance FROM Ledger', 'NO']]);
  const columns = executeScript(created.state, "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'LedgerSummary' ORDER BY ORDINAL_POSITION;");
  assert.deepStrictEqual(columns.result.errors, []);
  assert.deepStrictEqual(columns.result.rows, [['EntryId'], ['Balance']]);
});

test('INFORMATION_SCHEMA metadata supports qualified JOINs and filters', () => {
  const state = createAdminState();
  const result = executeScript(state, "SELECT t.TABLE_NAME, c.COLUMN_NAME FROM INFORMATION_SCHEMA.TABLES AS t INNER JOIN INFORMATION_SCHEMA.COLUMNS AS c ON t.TABLE_NAME = c.TABLE_NAME WHERE t.TABLE_TYPE = 'BASE TABLE' AND t.TABLE_NAME = 'Ledger' ORDER BY c.ORDINAL_POSITION;");
  assert.deepStrictEqual(result.result.errors, []);
  assert.deepStrictEqual(result.result.rows, [['Ledger', 'Id'], ['Ledger', 'Name'], ['Ledger', 'Balance']]);
});


/* ==========================================================================
   DBCC CHECKIDENT: identity counter inspection and reseeding
   ========================================================================== */

test('DBCC CHECKIDENT NORESEED reports identity state without changing it', () => {
  const created = executeScript(
    EMPTY_STATE,
    "CREATE DATABASE IdentityDB; USE IdentityDB; CREATE TABLE Jobs (Id INT IDENTITY(5,2) PRIMARY KEY, Title NVARCHAR(20)); INSERT INTO Jobs (Title) VALUES ('A'), ('B');"
  );
  assert.deepStrictEqual(created.result.errors, []);
  const checked = executeScript(created.state, "DBCC CHECKIDENT ('Jobs', NORESEED);");
  assert.deepStrictEqual(checked.result.errors, []);
  assert.deepStrictEqual(checked.result.columns, ['TableName', 'IdentityColumn', 'CurrentIdentityValue', 'NextIdentityValue']);
  assert.deepStrictEqual(checked.result.rows, [['Jobs', 'Id', '7', '9']]);
  assert.strictEqual(checked.state.databases.identitydb.tables.jobs.columns[0].identity?.nextValue, 9);
});

test('DBCC CHECKIDENT RESEED on a non-empty table generates reseed plus increment', () => {
  const created = executeScript(
    EMPTY_STATE,
    "CREATE DATABASE IdentityDB; USE IdentityDB; CREATE TABLE Jobs (Id INT IDENTITY(1,1) PRIMARY KEY, Title NVARCHAR(20)); INSERT INTO Jobs (Title) VALUES ('A'), ('B');"
  );
  assert.deepStrictEqual(created.result.errors, []);
  const reseeded = executeScript(created.state, "DBCC CHECKIDENT ('Jobs', RESEED, 100);");
  assert.deepStrictEqual(reseeded.result.errors, []);
  const inserted = executeScript(reseeded.state, "INSERT INTO Jobs (Title) VALUES ('C'); SELECT Id FROM Jobs WHERE Title = 'C';");
  assert.deepStrictEqual(inserted.result.errors, []);
  assert.deepStrictEqual(inserted.result.rows, [['101']]);
});

test('DBCC CHECKIDENT RESEED on an empty table uses the supplied value for the next row', () => {
  const created = executeScript(
    EMPTY_STATE,
    'CREATE DATABASE IdentityDB; USE IdentityDB; CREATE TABLE Jobs (Id INT IDENTITY(1,1) PRIMARY KEY, Title NVARCHAR(20));'
  );
  assert.deepStrictEqual(created.result.errors, []);
  const reseeded = executeScript(created.state, "DBCC CHECKIDENT ('Jobs', RESEED, 50);");
  assert.deepStrictEqual(reseeded.result.errors, []);
  const inserted = executeScript(reseeded.state, "INSERT INTO Jobs (Title) VALUES ('First'); SELECT Id FROM Jobs;");
  assert.deepStrictEqual(inserted.result.errors, []);
  assert.deepStrictEqual(inserted.result.rows, [['50']]);
});

test('DBCC CHECKIDENT rejects non-identity tables and invalid reseed values atomically', () => {
  const created = executeScript(EMPTY_STATE, 'CREATE DATABASE IdentityDB; USE IdentityDB; CREATE TABLE PlainTable (Id INT PRIMARY KEY);');
  assert.deepStrictEqual(created.result.errors, []);
  const noIdentity = executeScript(created.state, "DBCC CHECKIDENT ('PlainTable', NORESEED);");
  assert.ok(noIdentity.result.errors.length > 0);
  const badMode = executeScript(created.state, "DBCC CHECKIDENT ('PlainTable', RESET);");
  assert.ok(badMode.result.errors.length > 0);
  assert.strictEqual(created.state.databases.identitydb.tables.plaintable.columns[0].identity, undefined);
});


/* SQL Server-style sys catalog subset */

test('sys.tables, sys.views and sys.objects list simulated objects', () => {
  const created = executeScript(EMPTY_STATE, 'CREATE DATABASE SystemCatalogDB; USE SystemCatalogDB; CREATE TABLE Students (Id INT PRIMARY KEY, FullName NVARCHAR(50));');
  assert.deepStrictEqual(created.result.errors, []);
  const viewCreated = executeScript(created.state, 'CREATE VIEW StudentNames AS SELECT FullName FROM Students;');
  assert.deepStrictEqual(viewCreated.result.errors, []);
  const state = viewCreated;
  const tables = executeScript(state.state, 'SELECT name, type_desc FROM sys.tables;');
  assert.deepStrictEqual(tables.result.errors, []);
  assert.deepStrictEqual(tables.result.rows, [['Students', 'USER_TABLE']]);
  const views = executeScript(state.state, 'SELECT name, type_desc FROM sys.views;');
  assert.deepStrictEqual(views.result.errors, []);
  assert.deepStrictEqual(views.result.rows, [['StudentNames', 'VIEW']]);
  const objects = executeScript(state.state, 'SELECT name, type FROM sys.objects ORDER BY name;');
  assert.deepStrictEqual(objects.result.errors, []);
  assert.deepStrictEqual(objects.result.rows, [['StudentNames', 'V'], ['Students', 'U']]);
});

test('sys.columns joins to sys.tables through stable simulator object IDs', () => {
  const state = executeScript(EMPTY_STATE, 'CREATE DATABASE SystemCatalogDB; USE SystemCatalogDB; CREATE TABLE Students (Id INT IDENTITY(10,5) PRIMARY KEY, Name NVARCHAR(50) NOT NULL, Score DECIMAL(10,2));');
  assert.deepStrictEqual(state.result.errors, []);
  const result = executeScript(state.state, "SELECT t.name, c.name, c.column_id, c.system_type_id, c.max_length, c.is_nullable, c.is_identity FROM sys.tables AS t INNER JOIN sys.columns AS c ON t.object_id = c.object_id WHERE t.name = 'Students' ORDER BY c.column_id;");
  assert.deepStrictEqual(result.result.errors, []);
  assert.deepStrictEqual(result.result.rows, [
    ['Students', 'Id', '1', '56', '4', '0', '1'],
    ['Students', 'Name', '2', '231', '100', '0', '0'],
    ['Students', 'Score', '3', '106', '9', '1', '0'],
  ]);
});

test('sys.columns exposes view output names with unknown expression types as NULL', () => {
  const created = executeScript(EMPTY_STATE, 'CREATE DATABASE SystemCatalogDB; USE SystemCatalogDB; CREATE TABLE Students (Id INT, FullName NVARCHAR(50));');
  assert.deepStrictEqual(created.result.errors, []);
  const viewCreated = executeScript(created.state, 'CREATE VIEW StudentNames AS SELECT FullName AS DisplayName FROM Students;');
  assert.deepStrictEqual(viewCreated.result.errors, []);
  const state = viewCreated;
  const result = executeScript(state.state, "SELECT c.name, c.system_type_id FROM sys.views AS v INNER JOIN sys.columns AS c ON v.object_id = c.object_id WHERE v.name = 'StudentNames';");
  assert.deepStrictEqual(result.result.errors, []);
  assert.deepStrictEqual(result.result.rows, [['DisplayName', 'NULL']]);
});

test('sys.schemas exposes the simulator dbo schema', () => {
  const state = executeScript(EMPTY_STATE, 'CREATE DATABASE SystemCatalogDB; USE SystemCatalogDB; CREATE TABLE Students (Id INT);');
  assert.deepStrictEqual(state.result.errors, []);
  const result = executeScript(state.state, 'SELECT schema_id, name FROM sys.schemas;');
  assert.deepStrictEqual(result.result.errors, []);
  assert.deepStrictEqual(result.result.rows, [['1', 'dbo']]);
});


test('CREATE VIEW validates columns on an empty base table and remains queryable', () => {
  const created = executeScript(EMPTY_STATE, 'CREATE DATABASE EmptyViewDB; USE EmptyViewDB; CREATE TABLE Students (Id INT, FullName NVARCHAR(50));');
  assert.deepStrictEqual(created.result.errors, []);
  const viewCreated = executeScript(created.state, 'CREATE VIEW StudentNames AS SELECT FullName FROM Students WHERE Id > 0;');
  assert.deepStrictEqual(viewCreated.result.errors, []);
  const selected = executeScript(viewCreated.state, 'SELECT FullName FROM StudentNames;');
  assert.deepStrictEqual(selected.result.errors, []);
  assert.deepStrictEqual(selected.result.rows, []);
  assert.deepStrictEqual(selected.result.columns, ['FullName']);
});


/* Additional sys catalog metadata for indexes, constraints and identity columns */

test('sys.indexes lists primary keys and user-created unique/non-unique indexes', () => {
  const created = executeScript(EMPTY_STATE, 'CREATE DATABASE SysIndexDB; USE SysIndexDB; CREATE TABLE Products (Id INT PRIMARY KEY, Code NVARCHAR(20) NOT NULL, CategoryId INT); CREATE UNIQUE INDEX UX_Products_Code ON Products (Code); CREATE INDEX IX_Products_Category ON Products (CategoryId);');
  assert.deepStrictEqual(created.result.errors, []);
  const result = executeScript(created.state, 'SELECT name, type_desc, is_unique, is_primary_key FROM sys.indexes ORDER BY index_id;');
  assert.deepStrictEqual(result.result.errors, []);
  assert.deepStrictEqual(result.result.rows, [
    ['PK_Products', 'CLUSTERED', '1', '1'],
    ['UX_Products_Code', 'NONCLUSTERED', '1', '0'],
    ['IX_Products_Category', 'NONCLUSTERED', '0', '0'],
  ]);
});

test('sys.foreign_keys exposes parent and referenced table object IDs', () => {
  const created = executeScript(EMPTY_STATE, "CREATE DATABASE SysForeignDB; USE SysForeignDB; CREATE TABLE Departments (Id INT PRIMARY KEY); CREATE TABLE Students (Id INT PRIMARY KEY, DepartmentId INT, CONSTRAINT FK_Students_Departments FOREIGN KEY (DepartmentId) REFERENCES Departments(Id));");
  assert.deepStrictEqual(created.result.errors, []);
  const result = executeScript(created.state, 'SELECT name, parent_object_id, referenced_object_id, delete_referential_action_desc FROM sys.foreign_keys;');
  assert.deepStrictEqual(result.result.errors, []);
  assert.strictEqual(result.result.rows.length, 1);
  assert.strictEqual(result.result.rows[0][0], 'FK_Students_Departments');
  assert.notStrictEqual(result.result.rows[0][1], result.result.rows[0][2]);
  assert.strictEqual(result.result.rows[0][3], 'NO_ACTION');
});

test('sys.check_constraints exposes check expressions', () => {
  const created = executeScript(EMPTY_STATE, 'CREATE DATABASE SysCheckDB; USE SysCheckDB; CREATE TABLE Products (Id INT PRIMARY KEY, Price DECIMAL(10,2) CHECK (Price >= 0));');
  assert.deepStrictEqual(created.result.errors, []);
  const result = executeScript(created.state, 'SELECT name, definition, is_disabled, is_not_trusted FROM sys.check_constraints;');
  assert.deepStrictEqual(result.result.errors, []);
  assert.deepStrictEqual(result.result.rows, [['CK_Products_Price', 'Price >= 0', '0', '0']]);
});

test('sys.identity_columns reports seed, increment and last stored identity value', () => {
  const created = executeScript(EMPTY_STATE, "CREATE DATABASE SysIdentityDB; USE SysIdentityDB; CREATE TABLE Jobs (Id INT IDENTITY(10,5) PRIMARY KEY, Title NVARCHAR(20)); INSERT INTO Jobs (Title) VALUES ('A'), ('B');");
  assert.deepStrictEqual(created.result.errors, []);
  const result = executeScript(created.state, 'SELECT name, seed_value, increment_value, last_value FROM sys.identity_columns;');
  assert.deepStrictEqual(result.result.errors, []);
  assert.deepStrictEqual(result.result.rows, [['Id', '10', '5', '15']]);
});

test('sys.default_constraints exposes default expressions and their column IDs', () => {
  const created = executeScript(EMPTY_STATE, "CREATE DATABASE SysDefaultDB; USE SysDefaultDB; CREATE TABLE Tasks (Id INT PRIMARY KEY, Status NVARCHAR(12) CONSTRAINT DF_Tasks_Status DEFAULT 'Open');");
  assert.deepStrictEqual(created.result.errors, []);
  const result = executeScript(created.state, 'SELECT name, parent_column_id, definition FROM sys.default_constraints;');
  assert.deepStrictEqual(result.result.errors, []);
  assert.deepStrictEqual(result.result.rows, [['DF_Tasks_Status', '2', "'Open'"]]);
});


/* sys index-column and key-constraint catalog */

test('sys.index_columns exposes composite index column order and joins to sys.indexes', () => {
  const created = executeScript(EMPTY_STATE, 'CREATE DATABASE SysIndexColumnsDB; USE SysIndexColumnsDB; CREATE TABLE Orders (OrderId INT PRIMARY KEY, RegionId INT, ItemCode NVARCHAR(20)); CREATE UNIQUE INDEX UX_Orders_Region_Item ON Orders (RegionId, ItemCode);');
  assert.deepStrictEqual(created.result.errors, []);
  const result = executeScript(created.state, 'SELECT i.name, c.name, ic.key_ordinal FROM sys.indexes AS i INNER JOIN sys.index_columns AS ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id INNER JOIN sys.columns AS c ON ic.object_id = c.object_id AND ic.column_id = c.column_id ORDER BY i.index_id, ic.key_ordinal;');
  assert.deepStrictEqual(result.result.errors, []);
  assert.deepStrictEqual(result.result.rows, [
    ['PK_Orders', 'OrderId', '1'],
    ['UX_Orders_Region_Item', 'RegionId', '1'],
    ['UX_Orders_Region_Item', 'ItemCode', '2'],
  ]);
});

test('sys.key_constraints distinguishes primary-key and unique constraints', () => {
  const created = executeScript(EMPTY_STATE, 'CREATE DATABASE SysKeysDB; USE SysKeysDB; CREATE TABLE Users (Id INT PRIMARY KEY, Email NVARCHAR(50) UNIQUE, UserCode NVARCHAR(20), CONSTRAINT UQ_Users_Code UNIQUE (UserCode));');
  assert.deepStrictEqual(created.result.errors, []);
  const result = executeScript(created.state, 'SELECT name, type, type_desc FROM sys.key_constraints ORDER BY type;');
  assert.deepStrictEqual(result.result.errors, []);
  assert.deepStrictEqual(result.result.rows, [
    ['PK_Users', 'PK', 'PRIMARY_KEY_CONSTRAINT'],
    ['UQ_Users_Email', 'UQ', 'UNIQUE_CONSTRAINT'],
    ['UQ_Users_1', 'UQ', 'UNIQUE_CONSTRAINT'],
  ]);
});
