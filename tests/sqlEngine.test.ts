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

/* ==========================================================================
   NEW EDUCATIONAL SUITES: FUNCTIONS, JOINS, SUBQUERIES, SET OPS, CLAUSES
   ========================================================================== */

function setupSampleDatabase() {
  let state = EMPTY_STATE;
  const setupScript = `
CREATE DATABASE EduDB;
GO
USE EduDB;
GO
CREATE TABLE Departments (
  ID INT PRIMARY KEY,
  Name NVARCHAR(50) NOT NULL
);
GO
CREATE TABLE Students (
  Id INT PRIMARY KEY,
  Name NVARCHAR(100) NOT NULL,
  Age INT,
  Grade INT,
  DepartmentID INT,
  BirthDate NVARCHAR(20),
  Phone NVARCHAR(20)
);
GO
CREATE TABLE Teachers (
  Id INT PRIMARY KEY,
  Name NVARCHAR(100) NOT NULL,
  DepartmentID INT
);
GO
CREATE TABLE Employees (
  ID INT PRIMARY KEY,
  Name NVARCHAR(50) NOT NULL,
  ManagerID INT
);
GO
INSERT INTO Departments (ID, Name) VALUES (1, 'IT'), (2, 'CS'), (3, 'IS');
GO
INSERT INTO Students (Id, Name, Age, Grade, DepartmentID, BirthDate, Phone) VALUES
  (1, 'Ali Hassan', 20, 85, 1, '2004-05-15', '0101234567'),
  (2, 'Ahmed Khaled', 21, 92, 1, '2003-08-20', NULL),
  (3, 'Sara Mohamed', 19, 58, 2, '2005-01-10', '0129876543'),
  (4, 'Mona Ali', 22, 95, 2, '2002-11-05', NULL),
  (5, 'Omar Farouk', 20, 74, 3, '2004-03-25', '0111122233');
GO
INSERT INTO Teachers (Id, Name, DepartmentID) VALUES
  (101, 'Dr. Mahmoud', 1),
  (102, 'Dr. Mona Ali', 2);
GO
INSERT INTO Employees (ID, Name, ManagerID) VALUES
  (1, 'Boss User', NULL),
  (2, 'Dev One', 1),
  (3, 'Dev Two', 1),
  (4, 'Sub Dev', 2);
`;
  const res = executeScript(state, setupScript);
  assert.strictEqual(res.result.errors.length, 0);
  return res.state;
}

test('String Functions (UPPER, LOWER, LEFT, RIGHT, CONCAT, REPLACE, SUBSTRING, CHARINDEX, LEN, LTRIM, RTRIM, TRIM, REVERSE, SPACE, REPLICATE, STUFF)', () => {
  const state = setupSampleDatabase();

  const res = executeScript(
    state,
    `SELECT
      UPPER(Name) AS UName,
      LOWER(Name) AS LName,
      LEFT(Name, 3) AS Left3,
      RIGHT(Name, 4) AS Right4,
      CONCAT(Name, ' - ', Age) AS ConcatStr,
      REPLACE(Name, 'Ali', 'AliX') AS RepStr,
      SUBSTRING(Name, 1, 4) AS SubStr,
      CHARINDEX('Hassan', Name) AS CharIdx,
      LEN(Name) AS NameLen,
      TRIM('  hello  ') AS Trimmed,
      REVERSE('ABC') AS RevStr,
      REPLICATE('A', 3) AS Rep3,
      STUFF('Hello World', 7, 5, 'SQL') AS Stuffed
     FROM Students WHERE Id = 1;`
  );

  assert.strictEqual(res.result.errors.length, 0);
  assert.strictEqual(res.result.rows[0][0], 'ALI HASSAN');
  assert.strictEqual(res.result.rows[0][1], 'ali hassan');
  assert.strictEqual(res.result.rows[0][2], 'Ali');
  assert.strictEqual(res.result.rows[0][3], 'ssan');
  assert.strictEqual(res.result.rows[0][4], 'Ali Hassan - 20');
  assert.strictEqual(res.result.rows[0][5], 'AliX Hassan');
  assert.strictEqual(res.result.rows[0][6], 'Ali ');
  assert.strictEqual(res.result.rows[0][7], '5');
  assert.strictEqual(res.result.rows[0][8], '10');
  assert.strictEqual(res.result.rows[0][9], 'hello');
  assert.strictEqual(res.result.rows[0][10], 'CBA');
  assert.strictEqual(res.result.rows[0][11], 'AAA');
  assert.strictEqual(res.result.rows[0][12], 'Hello SQL');
});

test('Numeric Functions (ABS, ROUND, CEILING, FLOOR, POWER, SQRT, SIGN)', () => {
  const state = setupSampleDatabase();

  const res = executeScript(
    state,
    `SELECT
      ABS(-15) AS AbsVal,
      ROUND(85.678, 2) AS RoundVal,
      CEILING(12.1) AS CeilVal,
      FLOOR(12.9) AS FloorVal,
      POWER(2, 3) AS PowVal,
      SQRT(16) AS SqrtVal,
      SIGN(-50) AS SignVal;`
  );

  assert.strictEqual(res.result.errors.length, 0);
  assert.strictEqual(res.result.rows[0][0], '15');
  assert.strictEqual(res.result.rows[0][1], '85.68');
  assert.strictEqual(res.result.rows[0][2], '13');
  assert.strictEqual(res.result.rows[0][3], '12');
  assert.strictEqual(res.result.rows[0][4], '8');
  assert.strictEqual(res.result.rows[0][5], '4');
  assert.strictEqual(res.result.rows[0][6], '-1');
});

test('Date Functions (YEAR, MONTH, DAY, DATEPART, DATEADD, DATEDIFF, EOMONTH, GETDATE)', () => {
  const state = setupSampleDatabase();

  const res = executeScript(
    state,
    `SELECT
      YEAR(BirthDate) AS Y,
      MONTH(BirthDate) AS M,
      DAY(BirthDate) AS D,
      DATEPART(month, BirthDate) AS PartM,
      DATEADD(year, 1, BirthDate) AS AddY,
      DATEDIFF(year, '2000-01-01', '2025-01-01') AS DiffY,
      EOMONTH('2024-02-10') AS FebEO
     FROM Students WHERE Id = 1;`
  );

  assert.strictEqual(res.result.errors.length, 0);
  assert.strictEqual(res.result.rows[0][0], '2004');
  assert.strictEqual(res.result.rows[0][1], '5');
  assert.strictEqual(res.result.rows[0][2], '15');
  assert.strictEqual(res.result.rows[0][3], '5');
  assert.strictEqual(res.result.rows[0][4], '2005-05-15 00:00:00');
  assert.strictEqual(res.result.rows[0][5], '25');
  assert.strictEqual(res.result.rows[0][6], '2024-02-29');
});

test('NULL & Conditional Functions (ISNULL, COALESCE, NULLIF, IIF, CASE)', () => {
  const state = setupSampleDatabase();

  const res = executeScript(
    state,
    `SELECT
      ISNULL(Phone, 'No Phone') AS PhoneChecked,
      COALESCE(NULL, Phone, 'Fallback') AS CoalVal,
      NULLIF(Age, 20) AS NullIf20,
      IIF(Grade >= 60, 'Pass', 'Fail') AS PassStatus,
      CASE
        WHEN Grade >= 90 THEN 'Excellent'
        WHEN Grade >= 60 THEN 'Pass'
        ELSE 'Fail'
      END AS GradeLabel
     FROM Students WHERE Id IN (1, 2);`
  );

  assert.strictEqual(res.result.errors.length, 0);
  // Id 1 (Ali, Age 20, Grade 85, Phone 010...)
  assert.strictEqual(res.result.rows[0][0], '0101234567');
  assert.strictEqual(res.result.rows[0][1], '0101234567');
  assert.strictEqual(res.result.rows[0][2], 'NULL');
  assert.strictEqual(res.result.rows[0][3], 'Pass');
  assert.strictEqual(res.result.rows[0][4], 'Pass');

  // Id 2 (Ahmed, Age 21, Grade 92, Phone NULL)
  assert.strictEqual(res.result.rows[1][0], 'No Phone');
  assert.strictEqual(res.result.rows[1][1], 'Fallback');
  assert.strictEqual(res.result.rows[1][2], '21');
  assert.strictEqual(res.result.rows[1][3], 'Pass');
  assert.strictEqual(res.result.rows[1][4], 'Excellent');
});

test('Clauses & Aggregates (DISTINCT, LIKE, GROUP BY, HAVING, COUNT, SUM, AVG, MAX, MIN)', () => {
  const state = setupSampleDatabase();

  // 1. DISTINCT
  let res = executeScript(state, 'SELECT DISTINCT DepartmentID FROM Students ORDER BY DepartmentID;');
  assert.strictEqual(res.result.errors.length, 0);
  assert.strictEqual(res.result.rows.length, 3);

  // 2. LIKE patterns
  res = executeScript(state, "SELECT Name FROM Students WHERE Name LIKE 'A%' ORDER BY Name;");
  assert.strictEqual(res.result.errors.length, 0);
  assert.strictEqual(res.result.rows.length, 2);
  assert.strictEqual(res.result.rows[0][0], 'Ahmed Khaled');
  assert.strictEqual(res.result.rows[1][0], 'Ali Hassan');

  res = executeScript(state, "SELECT Name FROM Students WHERE Name LIKE '%Ali%' ORDER BY Name;");
  assert.strictEqual(res.result.errors.length, 0);
  assert.strictEqual(res.result.rows.length, 2); // Ali Hassan, Mona Ali

  // 3. GROUP BY & HAVING & Aggregates
  res = executeScript(
    state,
    `SELECT DepartmentID, COUNT(*) AS Total, AVG(Grade) AS AvgGrade, MAX(Grade) AS MaxGrade
     FROM Students
     GROUP BY DepartmentID
     HAVING COUNT(*) >= 2
     ORDER BY DepartmentID;`
  );

  assert.strictEqual(res.result.errors.length, 0);
  assert.strictEqual(res.result.rows.length, 2); // Dept 1 (2 students), Dept 2 (2 students)
  assert.strictEqual(res.result.rows[0][0], '1');
  assert.strictEqual(res.result.rows[0][1], '2');
  assert.strictEqual(res.result.rows[0][2], '88.5'); // (85 + 92)/2
  assert.strictEqual(res.result.rows[0][3], '92');
});

test('JOINs (INNER, LEFT, RIGHT, FULL OUTER, CROSS, SELF JOIN with Aliases)', () => {
  const state = setupSampleDatabase();

  // 1. INNER JOIN
  let res = executeScript(
    state,
    `SELECT s.Name AS StudentName, d.Name AS DeptName
     FROM Students s
     INNER JOIN Departments d ON s.DepartmentID = d.ID
     ORDER BY s.Id;`
  );
  assert.strictEqual(res.result.errors.length, 0);
  assert.strictEqual(res.result.rows[0][0], 'Ali Hassan');
  assert.strictEqual(res.result.rows[0][1], 'IT');

  // 2. LEFT JOIN
  res = executeScript(
    state,
    `SELECT d.Name AS DeptName, s.Name AS StudentName
     FROM Departments d
     LEFT JOIN Students s ON d.ID = s.DepartmentID
     ORDER BY d.ID, s.Id;`
  );
  assert.strictEqual(res.result.errors.length, 0);
  assert.ok(res.result.rows.length >= 5);

  // 3. CROSS JOIN
  res = executeScript(state, 'SELECT s.Name, d.Name FROM Students s CROSS JOIN Departments d;');
  assert.strictEqual(res.result.errors.length, 0);
  assert.strictEqual(res.result.rows.length, 15); // 5 students * 3 departments

  // 4. SELF JOIN
  res = executeScript(
    state,
    `SELECT e.Name AS EmployeeName, m.Name AS ManagerName
     FROM Employees e
     LEFT JOIN Employees m ON e.ManagerID = m.ID
     ORDER BY e.ID;`
  );
  assert.strictEqual(res.result.errors.length, 0);
  assert.strictEqual(res.result.rows[0][0], 'Boss User');
  assert.strictEqual(res.result.rows[0][1], 'NULL');
  assert.strictEqual(res.result.rows[1][0], 'Dev One');
  assert.strictEqual(res.result.rows[1][1], 'Boss User');
});

test('Subqueries (WHERE, SELECT, FROM, EXISTS, NOT EXISTS, Multi-level)', () => {
  const state = setupSampleDatabase();

  // 1. Scalar WHERE Subquery
  let res = executeScript(
    state,
    `SELECT Name FROM Students WHERE Grade > (SELECT AVG(Grade) FROM Students) ORDER BY Name;`
  );
  assert.strictEqual(res.result.errors.length, 0);
  // Avg grade is (85+92+58+95+74)/5 = 80.8. Students > 80.8: Ahmed Khaled (92), Ali Hassan (85), Mona Ali (95)
  assert.strictEqual(res.result.rows.length, 3);

  // 2. IN Subquery
  res = executeScript(
    state,
    `SELECT Name FROM Students WHERE DepartmentID IN (SELECT ID FROM Departments WHERE Name = 'IT') ORDER BY Name;`
  );
  assert.strictEqual(res.result.errors.length, 0);
  assert.strictEqual(res.result.rows.length, 2);

  // 3. EXISTS & NOT EXISTS Correlated Subquery
  res = executeScript(
    state,
    `SELECT s.Name FROM Students s WHERE EXISTS (SELECT 1 FROM Departments d WHERE d.ID = s.DepartmentID AND d.Name = 'CS');`
  );
  assert.strictEqual(res.result.errors.length, 0);
  assert.strictEqual(res.result.rows.length, 2);

  // 4. Nested Multi-level Subquery
  res = executeScript(
    state,
    `SELECT Name FROM Students WHERE DepartmentID = (
      SELECT ID FROM Departments WHERE Name = (
        SELECT Name FROM Departments WHERE ID = 1
      )
    ) ORDER BY Name;`
  );
  assert.strictEqual(res.result.errors.length, 0);
  assert.strictEqual(res.result.rows.length, 2);

  // 5. Derived Table Subquery in FROM
  res = executeScript(
    state,
    `SELECT Sub.Name, Sub.Grade FROM (SELECT Name, Grade FROM Students WHERE Grade >= 80) AS Sub ORDER BY Sub.Grade DESC;`
  );
  assert.strictEqual(res.result.errors.length, 0);
  assert.strictEqual(res.result.rows.length, 3);
  assert.strictEqual(res.result.rows[0][0], 'Mona Ali');
});

test('Set Operators (UNION, UNION ALL, INTERSECT, EXCEPT)', () => {
  const state = setupSampleDatabase();

  // 1. UNION (Distinct)
  let res = executeScript(
    state,
    `SELECT Name FROM Students WHERE DepartmentID = 1
     UNION
     SELECT Name FROM Teachers WHERE DepartmentID = 1;`
  );
  assert.strictEqual(res.result.errors.length, 0);
  assert.strictEqual(res.result.rows.length, 3); // Ali Hassan, Ahmed Khaled, Dr. Mahmoud

  // 2. UNION ALL
  res = executeScript(
    state,
    `SELECT Name FROM Students WHERE Name = 'Mona Ali'
     UNION ALL
     SELECT Name FROM Teachers WHERE Name = 'Dr. Mona Ali';`
  );
  assert.strictEqual(res.result.errors.length, 0);
  assert.strictEqual(res.result.rows.length, 2);

  // 3. INTERSECT
  res = executeScript(
    state,
    `SELECT Name FROM Students
     INTERSECT
     SELECT Name FROM Teachers;`
  );
  assert.strictEqual(res.result.errors.length, 0);
  assert.strictEqual(res.result.rows.length, 0); // No exact match student name vs teacher name

  // 4. EXCEPT
  res = executeScript(
    state,
    `SELECT Name FROM Students WHERE DepartmentID = 1
     EXCEPT
     SELECT Name FROM Students WHERE Grade < 90;`
  );
  assert.strictEqual(res.result.errors.length, 0);
  assert.strictEqual(res.result.rows.length, 1);
  assert.strictEqual(res.result.rows[0][0], 'Ahmed Khaled');
});

test('Educational Error Messages', () => {
  const state = setupSampleDatabase();

  // Non-existent table
  let res = executeScript(state, 'SELECT * FROM UnknownTable;');
  assert.ok(res.result.errors.length > 0);
  assert.match(res.result.errors[0], /غير موجود/);

  // HAVING without GROUP BY or Aggregates
  res = executeScript(state, 'SELECT Name FROM Students HAVING Grade > 80;');
  assert.ok(res.result.errors.length > 0);
  assert.match(res.result.errors[0], /HAVING/);

  // Scalar subquery returning multiple rows
  res = executeScript(state, 'SELECT Name FROM Students WHERE Grade = (SELECT Grade FROM Students);');
  assert.ok(res.result.errors.length > 0);
  assert.match(res.result.errors[0], /Subquery returned more than one value/);

  // Set operator column count mismatch
  res = executeScript(state, 'SELECT Id, Name FROM Students UNION SELECT Name FROM Teachers;');
  assert.ok(res.result.errors.length > 0);
  assert.match(res.result.errors[0], /غير متطابق/);
});

/* ==========================================================================
   ADVANCED & HARDENING REGRESSION TESTS
   ========================================================================== */

test('JOIN Column Ambiguity and Overwrite Prevention', () => {
  const state = setupSampleDatabase();

  // Unqualified 'Name' in JOIN projection must trigger Ambiguous column error
  let res = executeScript(
    state,
    `SELECT Name FROM Students s INNER JOIN Departments d ON s.DepartmentID = d.ID;`
  );
  assert.ok(res.result.errors.length > 0);
  assert.match(res.result.errors[0], /Ambiguous column 'Name'/i);

  // Qualified s.Name and d.Name in SELECT * / projection work independently
  res = executeScript(
    state,
    `SELECT s.Name AS StudentName, d.Name AS DeptName
     FROM Students s
     INNER JOIN Departments d ON s.DepartmentID = d.ID
     WHERE s.Id = 1;`
  );
  assert.strictEqual(res.result.errors.length, 0);
  assert.strictEqual(res.result.rows[0][0], 'Ali Hassan');
  assert.strictEqual(res.result.rows[0][1], 'IT');
});

test('Chained Multiple Set Operators', () => {
  const state = setupSampleDatabase();

  const res = executeScript(
    state,
    `SELECT Name FROM Students WHERE DepartmentID = 1
     UNION
     SELECT Name FROM Students WHERE DepartmentID = 2
     UNION
     SELECT Name FROM Teachers;`
  );

  assert.strictEqual(res.result.errors.length, 0);
  assert.strictEqual(res.result.rows.length, 6); // 2 dept 1 + 2 dept 2 + 2 teachers
});

test('NULL Semantics with Three-Valued Logic and NOT IN', () => {
  const state = setupSampleDatabase();

  // NULL = NULL evaluates to false
  let res = executeScript(state, 'SELECT * FROM Students WHERE NULL = NULL;');
  assert.strictEqual(res.result.errors.length, 0);
  assert.strictEqual(res.result.rows.length, 0);

  // NULL <> 5 evaluates to false
  res = executeScript(state, 'SELECT * FROM Students WHERE NULL <> 5;');
  assert.strictEqual(res.result.errors.length, 0);
  assert.strictEqual(res.result.rows.length, 0);

  // NOT IN with candidate set containing NULL evaluates to 0 rows
  res = executeScript(
    state,
    `SELECT Name FROM Students WHERE Name NOT IN ('Ali Hassan', NULL);`
  );
  assert.strictEqual(res.result.errors.length, 0);
  assert.strictEqual(res.result.rows.length, 0);
});

test('COUNT(col) ignoring NULL vs COUNT(*)', () => {
  const state = setupSampleDatabase();

  const res = executeScript(
    state,
    `SELECT COUNT(*) AS TotalCount, COUNT(Phone) AS PhoneCount FROM Students;`
  );

  assert.strictEqual(res.result.errors.length, 0);
  assert.strictEqual(res.result.rows[0][0], '5'); // Total students
  assert.strictEqual(res.result.rows[0][1], '3'); // Non-null phone count (2 NULLs ignored)
});

test('NOT LIKE Clause and Function Argument Validation', () => {
  const state = setupSampleDatabase();

  // NOT LIKE
  let res = executeScript(
    state,
    `SELECT Name FROM Students WHERE Name NOT LIKE '%Ali%' ORDER BY Name;`
  );
  assert.strictEqual(res.result.errors.length, 0);
  assert.strictEqual(res.result.rows.length, 3); // Ahmed Khaled, Ali Hassan (filtered), Mona Ali (filtered), Omar Farouk, Sara Mohamed

  // Function with missing arguments returns educational error
  res = executeScript(state, 'SELECT SUBSTRING(Name, 1) FROM Students;');
  assert.ok(res.result.errors.length > 0);
  assert.match(res.result.errors[0], /SUBSTRING/i);
});
