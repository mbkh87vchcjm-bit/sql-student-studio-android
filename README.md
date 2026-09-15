# SQL Student Studio 🎓

تطبيق تعليمي تفاعلي للطلاب يهدف إلى توفير بيئة محلية وسريعة لتعلم واختبار أوامر T-SQL مباشرة من هاتف Android، بدون الحاجة إلى الاتصال بـ Microsoft SQL Server حقيقي أو وجود اتصال بالإنترنت.

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
- **محرك T-SQL محلي مستقل:** تنفيذ العمليات مع ضمان الذرية (Atomicity) والتحقق الصارم من وجود الأعمدة والأخطاء التكرارية (Primary Key / Unique constraints).

---

## 📜 أوامر SQL المدعومة (Supported T-SQL Commands)

- `CREATE DATABASE <name>`
- `DROP DATABASE <name>`
- `USE <database>`
- `CREATE TABLE <table_name> (...)`
- `DROP TABLE <table_name>`
- `INSERT INTO <table_name> (...) VALUES (...)`
- `SELECT [DISTINCT] [TOP n] <columns|*> FROM <table_name> [WHERE ...] [ORDER BY ...]`
- `UPDATE <table_name> SET col = val [WHERE ...]`
- `DELETE FROM <table_name> [WHERE ...]`
- `GO [n]` (يفصل بين الدفعات ويسمح بتكرار الدفعة n من المرات)

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
