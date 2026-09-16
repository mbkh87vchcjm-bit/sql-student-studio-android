# SQL Student Studio 🎓

تطبيق تعليمي تفاعلي للطلاب يهدف إلى توفير بيئة محلية وسريعة لتعلم واختبار أوامر T-SQL مباشرة من هاتف Android، بدون الحاجة إلى الاتصال بـ Microsoft SQL Server حقيقي أو وجود اتصال بالإنترنت.

> **Note:** SQL Student Studio is an educational local SQL/T-SQL engine. It is not Microsoft SQL Server.

---

## 🚀 التقنيات الأساسية (Tech Stack)

- **React Native** (0.86)
- **Expo** (v57 Managed Workflow)
- **TypeScript** (Strict Mode)
- **Expo Router** (File-based navigation)
- **AsyncStorage** (التخزين المحلي لحالة وقواعد البيانات)

---

## ✨ المميزات والوظائف المتاحة

- **محرر SQL تفاعلي (SQL Studio):** كتابة استعلامات متعددة الأسطر مع خيارات التشغيل الفوري وإظهار نتائج الجداول وزمن التنفيذ.
- **مستكشف قواعد البيانات (Data Explorer):** عرض شجري تفاعلي لقواعد البيانات والجداول والأعمدة يتردد تحديثه تلقائيًا.
- **إعدادات وحفظ حالة تلقائي:** التبديل بين العربية والإنجليزية، وتخزين قواعد البيانات محليًا عبر AsyncStorage، مع زر مسح مساحة العمل آمن يطلب التأكيد قبل الحذف.
- **محرك T-SQL محلي تفاعلي واسع:** دعم المجموعات الشاملة للدوال النصية والتجميعية والرقمية ودوال التاريخ والربط (JOINs) والاستعلامات الفرعية (Subqueries) والعمليات المجموعية (Set Operators).

---

## 📜 الأوامر والدوال المدعومة (Supported Features & T-SQL Commands)

### 1. DDL (Data Definition Language)
- `CREATE DATABASE <name>`
- `DROP DATABASE <name>`
- `USE <database>`
- `CREATE TABLE <table_name> (...)` مع دعم القيود: `PRIMARY KEY`, `UNIQUE`, `NOT NULL`, `DEFAULT`
- `DROP TABLE <table_name>`

```sql
CREATE DATABASE University;
GO
USE University;
GO
CREATE TABLE Students (
  Id INT PRIMARY KEY,
  Name NVARCHAR(100) NOT NULL,
  Age INT,
  Grade INT,
  DepartmentID INT,
  Phone NVARCHAR(20)
);
```

### 2. DML (Data Manipulation Language)
- `INSERT INTO <table_name> [(cols)] VALUES (...)`
- `UPDATE <table_name> SET col = expr [WHERE ...]`
- `DELETE FROM <table_name> [WHERE ...]`
- `GO [n]` (تكرار الدفعة n من المرات)

```sql
INSERT INTO Students (Id, Name, Age, Grade, DepartmentID, Phone) VALUES
  (1, 'Ali Hassan', 20, 85, 1, '0101234567'),
  (2, 'Ahmed Khaled', 21, 92, 1, NULL);

UPDATE Students SET Grade = 90 WHERE Id = 1;
DELETE FROM Students WHERE Grade < 60;
```

### 3. DQL & Clauses
- `SELECT [DISTINCT] [TOP n] <exprs|*> FROM <source>`
- `WHERE <condition>`
- `GROUP BY <cols>`
- `HAVING <condition>`
- `ORDER BY <col> [ASC|DESC]`
- `LIKE` مع الأنماط الأساسية (`'A%'`, `'%'`, `'a_c'`, `'%abc%'`)

```sql
SELECT DISTINCT DepartmentID FROM Students;

SELECT DepartmentID, COUNT(*) AS Total, AVG(Grade) AS AvgGrade
FROM Students
WHERE Grade >= 60
GROUP BY DepartmentID
HAVING COUNT(*) >= 2
ORDER BY AvgGrade DESC;
```

### 4. Functions (الدوال)

#### أ. الدوال النصية (String Functions)
- `UPPER`, `LOWER`, `LEFT`, `RIGHT`, `CONCAT`, `REPLACE`, `SUBSTRING`, `CHARINDEX`, `LEN`, `LTRIM`, `RTRIM`, `TRIM`, `REVERSE`, `SPACE`, `REPLICATE`, `STUFF`

```sql
SELECT UPPER(Name), LEFT(Name, 3), CONCAT(Name, ' - ', Phone), LEN(Name) FROM Students;
```

#### ب. الدوال الرقمية (Numeric Functions)
- `ABS`, `ROUND`, `CEILING`, `FLOOR`, `POWER`, `SQRT`, `SIGN`

```sql
SELECT ABS(-15), ROUND(Grade, 1), SQRT(16), POWER(2, 3);
```

#### ج. دوال التاريخ والوقت (Date Functions)
- `GETDATE`, `SYSDATETIME`, `YEAR`, `MONTH`, `DAY`, `DATEPART`, `DATEADD`, `DATEDIFF`, `EOMONTH`

```sql
SELECT YEAR(GETDATE()), DATEADD(year, 1, '2024-01-01'), DATEDIFF(day, '2024-01-01', '2024-01-10');
```

#### د. دوال NULL والعمليات الشرطية (NULL & Conditional Functions)
- `ISNULL`, `COALESCE`, `NULLIF`, `IIF`, `CASE WHEN ... THEN ... ELSE ... END`

```sql
SELECT
  ISNULL(Phone, 'No Phone') AS PhoneStr,
  IIF(Grade >= 60, 'Pass', 'Fail') AS Status,
  CASE
    WHEN Grade >= 90 THEN 'Excellent'
    WHEN Grade >= 60 THEN 'Pass'
    ELSE 'Fail'
  END AS GradeLabel
FROM Students;
```

#### هـ. الدوال التجميعية (Aggregate Functions)
- `COUNT`, `SUM`, `MAX`, `MIN`, `AVG`

```sql
SELECT COUNT(*), AVG(Grade), MAX(Grade), MIN(Grade) FROM Students;
```

### 5. JOINs (ربط الجداول)
- `INNER JOIN`, `LEFT JOIN`, `RIGHT JOIN`, `FULL OUTER JOIN`, `CROSS JOIN`, `SELF JOIN`
- دعم Table Aliases (`Students s`, `Departments d`, `Employees e`) والتحقق من الأسماء المزدوجة.

```sql
-- INNER JOIN with Aliases
SELECT s.Name AS Student, d.Name AS Department
FROM Students s
INNER JOIN Departments d ON s.DepartmentID = d.ID;

-- SELF JOIN
SELECT e.Name AS Employee, m.Name AS Manager
FROM Employees e
LEFT JOIN Employees m ON e.ManagerID = m.ID;
```

### 6. Subqueries (الاستعلامات الفرعية)
- Subquery في `WHERE`, `SELECT`, `FROM` (Derived tables).
- Nested & Multi-level Subqueries.
- `IN`, `NOT IN`, `EXISTS`, `NOT EXISTS`.

```sql
-- Scalar Subquery
SELECT Name FROM Students WHERE Grade > (SELECT AVG(Grade) FROM Students);

-- IN & EXISTS Subquery
SELECT Name FROM Students WHERE DepartmentID IN (SELECT ID FROM Departments WHERE Name = 'IT');

SELECT s.Name FROM Students s WHERE EXISTS (SELECT 1 FROM Departments d WHERE d.ID = s.DepartmentID);

-- Multi-level Subquery
SELECT Name FROM Students WHERE DepartmentID = (
  SELECT ID FROM Departments WHERE Name = (
    SELECT Name FROM Departments WHERE ID = 1
  )
);
```

### 7. Set Operators (المعاملات المجموعية)
- `UNION`, `UNION ALL`, `INTERSECT`, `EXCEPT` (مع التحقق من تطابق عدد الأعمدة).

```sql
SELECT Name FROM Students
UNION
SELECT Name FROM Teachers;

SELECT Name FROM Students
EXCEPT
SELECT Name FROM Teachers;
```

### 8. Conditions & Operators
- `IN`, `NOT IN`, `BETWEEN`, `NOT BETWEEN`, `IS NULL`, `IS NOT NULL`, `=`, `<>`, `!=`, `>`, `<`, `>=`, `<=`
- `AND`, `OR`, `NOT`

---

## ⚠️ قيود مهمة (Important Limitation)

> **تنبيه:** هذا التطبيق عبارة عن **محرك SQL تعليمي محلي خفيف** مبني بلغة TypeScript للتطبيقات المحمولة. **ليس** Microsoft SQL Server حقيقيًا، ولا يحتاج إلى خادم خارجي أو قواعد بيانات سحابية.

---

## 💻 طريقة تشغيل المشروع (Local Development)

1. **تثبيت التبعيات:**
   ```bash
   npm install
   ```

2. **تشغيل خادم Expo:**
   ```bash
   npx expo start
   ```

3. **تشغيل الاختبارات الآلية ومحرك التقييم:**
   ```bash
   npm test
   npm run typecheck
   ```

---

## 📱 بناء حزمة APK للهاتف (EAS Build)

المشروع مهيأ تمامًا لبناء ملف APK قابل للتثبيت مباشرة باستخدام EAS:

```bash
eas build -p android --profile preview
```

---

## 📁 بنية المشروع (Project Structure)

```
sql-student-studio/
├── app/                  # صفحات وشاشات التطبيق (Expo Router)
│   ├── (tabs)/           # شاشات التبويب (Home, Studio, Explorer, Settings)
│   └── _layout.tsx       # التخطيط الرئيسي
├── components/           # عناصر الواجهة والرسائل البرمجية
├── lib/                  # محرك SQL وحالة التطبيق (sqlEngine.ts, studioContext.tsx)
├── hooks/                # الخطاطيف المخصصة (useColors)
├── constants/            # الألوان والثوابت
├── scripts/              # سكريبتات مساعدة محليّة
├── tests/                # الاختبارات الآلية لمحرك SQL
├── app.json              # إعدادات تطبيق Expo و Android Package
├── eas.json              # إعدادات EAS Build لإنشاء ملف APK
├── package.json          # التبعيات والسكريبتات القياسية
└── tsconfig.json         # إعدادات TypeScript
```

---

## 📄 الترخيص (License)

هذا المشروع مرخص بموجب ترخيص [MIT License](LICENSE).
