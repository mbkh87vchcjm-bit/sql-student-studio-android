import assert from 'node:assert';
import { test } from 'node:test';
import { EMPTY_STATE, executeScript, splitBatches } from '../lib/sqlEngine';

test('GO batch splitting with count', () => {
  const script = `INSERT INTO T VALUES (1);
GO 3`;
  const batches = splitBatches(script);
  assert.strictEqual(batches.length, 3);
  assert.strictEqual(batches[0], 'INSERT INTO T VALUES (1);');
  assert.strictEqual(batches[1], 'INSERT INTO T VALUES (1);');
  assert.strictEqual(batches[2], 'INSERT INTO T VALUES (1);');
});

test('Full T-SQL lifecycle: CREATE, USE, INSERT, SELECT, UPDATE, DELETE', () => {
  let state = EMPTY_STATE;

  // 1. CREATE DATABASE & USE
  let res = executeScript(
    state,
    `CREATE DATABASE TestDB;
GO
USE TestDB;`
  );
  assert.strictEqual(res.result.errors.length, 0);
  assert.strictEqual(res.state.currentDatabase, 'TestDB');
  state = res.state;

  // 2. CREATE TABLE
  res = executeScript(
    state,
    `CREATE TABLE Users (
      Id INT PRIMARY KEY,
      Name NVARCHAR(50) NOT NULL,
      Age INT
    );`
  );
  assert.strictEqual(res.result.errors.length, 0);
  state = res.state;

  // 3. INSERT
  res = executeScript(
    state,
    `INSERT INTO Users (Id, Name, Age) VALUES
      (1, 'Ali', 20),
      (2, 'Sara', 25),
      (3, 'Omar', 18);`
  );
  assert.strictEqual(res.result.errors.length, 0);
  assert.strictEqual(res.result.affectedRows, 3);
  state = res.state;

  // 4. SELECT with WHERE and ORDER BY
  res = executeScript(state, 'SELECT Name, Age FROM Users WHERE Age >= 20 ORDER BY Age DESC;');
  assert.strictEqual(res.result.errors.length, 0);
  assert.deepStrictEqual(res.result.columns, ['Name', 'Age']);
  assert.strictEqual(res.result.rows.length, 2);
  assert.strictEqual(res.result.rows[0][0], 'Sara');
  assert.strictEqual(res.result.rows[1][0], 'Ali');

  // 5. UPDATE
  res = executeScript(state, "UPDATE Users SET Age = 21 WHERE Name = 'Ali';");
  assert.strictEqual(res.result.errors.length, 0);
  assert.strictEqual(res.result.affectedRows, 1);
  state = res.state;

  // Verify update
  res = executeScript(state, "SELECT Age FROM Users WHERE Name = 'Ali';");
  assert.strictEqual(res.result.rows[0][0], '21');

  // 6. DELETE
  res = executeScript(state, 'DELETE FROM Users WHERE Age < 20;');
  assert.strictEqual(res.result.errors.length, 0);
  assert.strictEqual(res.result.affectedRows, 1);
  state = res.state;

  // 7. DROP TABLE & DATABASE
  res = executeScript(
    state,
    `DROP TABLE Users;
GO
DROP DATABASE TestDB;`
  );
  assert.strictEqual(res.result.errors.length, 0);
  assert.strictEqual(res.state.currentDatabase, null);
});

test('INSERT Atomicity: Failed row aborts whole statement', () => {
  let state = EMPTY_STATE;
  let res = executeScript(
    state,
    `CREATE DATABASE TestDB;
GO
USE TestDB;
GO
CREATE TABLE Products (Id INT PRIMARY KEY, Name NVARCHAR(50));`
  );
  state = res.state;

  // Try inserting 2 rows where 2nd row violates Primary Key
  res = executeScript(
    state,
    `INSERT INTO Products (Id, Name) VALUES (1, 'Book'), (1, 'Pen');`
  );
  assert.ok(res.result.errors.length > 0);

  // Verify no rows were committed
  res = executeScript(state, 'SELECT * FROM Products;');
  assert.strictEqual(res.result.rows.length, 0);
});

test('INSERT with parenthetical string values', () => {
  let state = EMPTY_STATE;
  let res = executeScript(
    state,
    `CREATE DATABASE TestDB;
GO
USE TestDB;
GO
CREATE TABLE Courses (Id INT PRIMARY KEY, Title NVARCHAR(100));`
  );
  state = res.state;

  res = executeScript(
    state,
    `INSERT INTO Courses (Id, Title) VALUES (1, 'Math (Advanced)'), (2, 'Physics (Lab)');`
  );
  assert.strictEqual(res.result.errors.length, 0);
  assert.strictEqual(res.result.affectedRows, 2);
  state = res.state;

  res = executeScript(state, 'SELECT Title FROM Courses WHERE Id = 1;');
  assert.strictEqual(res.result.rows[0][0], 'Math (Advanced)');
});

test('Column Validation Error Handling', () => {
  let state = EMPTY_STATE;
  let res = executeScript(
    state,
    `CREATE DATABASE TestDB;
GO
USE TestDB;
GO
CREATE TABLE Items (Id INT PRIMARY KEY);`
  );
  state = res.state;

  res = executeScript(state, 'SELECT NonExistentCol FROM Items;');
  assert.ok(res.result.errors.length > 0);
  assert.match(res.result.errors[0], /غير موجود/);
});
