import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useStudio } from '@/lib/studioContext';
import { AppMark, ScreenHeader, SectionLabel, StatCard } from '@/components/StudioUI';

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { state, result, script, locale } = useStudio();
  const databases = Object.values(state.databases);
  const tables = databases.reduce((total, db) => total + Object.keys(db.tables).length, 0);
  const rows = databases.reduce((total, db) => total + Object.values(db.tables).reduce((sum, table) => sum + table.rows.length, 0), 0);
  const isArabic = locale === 'ar';

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 110 }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.topbar}><AppMark /><View style={[styles.statusDot, { backgroundColor: colors.primary }]} /></View>
      <ScreenHeader
        eyebrow={isArabic ? 'بيئة تعلم محلية' : 'LOCAL LEARNING ENVIRONMENT'}
        title={isArabic ? 'تعلّم SQL من هاتفك.' : 'Learn SQL from your phone.'}
        subtitle={isArabic ? 'اكتب استعلامات T-SQL وشاهد النتيجة فورًا، بدون إنترنت.' : 'Write T-SQL queries and see the result instantly, without internet.'}
      />
      <View style={styles.statsRow}>
        <StatCard icon="database" value={String(databases.length)} label={isArabic ? 'قواعد بيانات' : 'Databases'} />
        <StatCard icon="layers" value={String(tables)} label={isArabic ? 'جداول' : 'Tables'} />
        <StatCard icon="list" value={String(rows)} label={isArabic ? 'صفوف' : 'Rows'} accent />
      </View>
      <Pressable testID="open-studio" onPress={() => router.push('/studio')} style={({ pressed }) => [styles.hero, { backgroundColor: colors.editor, opacity: pressed ? 0.9 : 1 }]}>
        <View style={styles.heroCopy}>
          <Text style={[styles.heroKicker, { color: colors.editorMuted }]}>{isArabic ? 'مساحة العمل' : 'YOUR WORKSPACE'}</Text>
          <Text style={[styles.heroTitle, { color: colors.editorForeground }]}>{isArabic ? 'ابدأ بدرس University' : 'Start with the University lesson'}</Text>
          <Text style={[styles.heroText, { color: colors.editorMuted }]}>{isArabic ? 'نفّذ دورة كاملة من إنشاء القاعدة إلى عرض النتائج.' : 'Run a complete flow from creating a database to viewing results.'}</Text>
        </View>
        <View style={[styles.heroAction, { backgroundColor: colors.primary }]}><Feather name="arrow-up-left" size={20} color={colors.primaryForeground} /></View>
      </Pressable>
      <SectionLabel action={<Text style={[styles.count, { color: colors.mutedForeground }]}>{result ? `${result.durationMs} ms` : ''}</Text>}>{isArabic ? 'آخر تشغيل' : 'Latest run'}</SectionLabel>
      {result ? (
        <View style={[styles.latest, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.latestHeader}><Feather name={result.errors.length ? 'alert-circle' : 'check-circle'} size={18} color={result.errors.length ? colors.destructive : colors.primary} /><Text style={[styles.latestTitle, { color: colors.foreground }]}>{result.errors.length ? (isArabic ? 'يحتاج إلى مراجعة' : 'Needs attention') : (isArabic ? 'تم التنفيذ بنجاح' : 'Executed successfully')}</Text></View>
          <Text numberOfLines={2} style={[styles.latestScript, { color: colors.mutedForeground }]}>{script}</Text>
        </View>
      ) : (
        <View style={[styles.latest, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.latestTitle, { color: colors.foreground }]}>{isArabic ? 'لا توجد عمليات بعد' : 'No executions yet'}</Text>
          <Text style={[styles.latestScript, { color: colors.mutedForeground }]}>{isArabic ? 'افتح الاستوديو وشغّل الدرس التجريبي.' : 'Open Studio and run the starter lesson.'}</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, gap: 2 },
  topbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  statusDot: { width: 9, height: 9, borderRadius: 5 },
  statsRow: { flexDirection: 'row', gap: 9, marginBottom: 18 },
  hero: { minHeight: 176, borderRadius: 22, padding: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 28 },
  heroCopy: { flex: 1, gap: 8, paddingRight: 12 },
  heroKicker: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  heroTitle: { fontSize: 22, lineHeight: 28, fontWeight: '700', letterSpacing: -0.5 },
  heroText: { fontSize: 13, lineHeight: 19 },
  heroAction: { width: 40, height: 40, borderRadius: 13, justifyContent: 'center', alignItems: 'center' },
  count: { fontSize: 12 },
  latest: { borderRadius: 18, borderWidth: 1, padding: 16, gap: 12 },
  latestHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  latestTitle: { fontSize: 14, fontWeight: '700' },
  latestScript: { fontFamily: 'monospace', fontSize: 12, lineHeight: 18, textAlign: 'left' },
});
