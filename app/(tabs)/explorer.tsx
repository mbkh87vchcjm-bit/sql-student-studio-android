import { Feather } from '@expo/vector-icons';
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useStudio } from '@/lib/studioContext';
import { ScreenHeader } from '@/components/StudioUI';

export default function ExplorerScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { state, locale } = useStudio();
  const isArabic = locale === 'ar';
  const databases = Object.values(state.databases);
  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={[styles.content, { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 110 }]} showsVerticalScrollIndicator={false}>
      <ScreenHeader eyebrow={isArabic ? 'مخطط القاعدة' : 'DATABASE MAP'} title={isArabic ? 'مستكشف البيانات' : 'Data explorer'} subtitle={isArabic ? 'تتحدث الشجرة تلقائيًا بعد كل عملية ناجحة.' : 'The tree updates automatically after each successful operation.'} />
      {databases.length === 0 ? (
        <View style={[styles.empty, { borderColor: colors.border, backgroundColor: colors.card }]}><Feather name="database" size={26} color={colors.mutedForeground} /><Text style={[styles.emptyTitle, { color: colors.foreground }]}>{isArabic ? 'لا توجد قواعد بيانات' : 'No databases yet'}</Text><Text style={[styles.emptyText, { color: colors.mutedForeground }]}>{isArabic ? 'شغّل الدرس التجريبي من شاشة الاستوديو لتبدأ.' : 'Run the starter lesson from Studio to begin.'}</Text></View>
      ) : databases.map((database) => (
        <View key={database.name} style={[styles.databaseCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.databaseHeader}><View style={[styles.databaseIcon, { backgroundColor: colors.secondary }]}><Feather name="database" size={17} color={colors.secondaryForeground} /></View><View style={styles.databaseCopy}><Text style={[styles.databaseName, { color: colors.foreground }]}>{database.name}</Text><Text style={[styles.databaseMeta, { color: colors.mutedForeground }]}>{Object.keys(database.tables).length} {isArabic ? 'جداول' : 'tables'}</Text></View><Feather name="chevron-down" size={18} color={colors.mutedForeground} /></View>
          {Object.values(database.tables).map((table) => <View key={table.name} style={[styles.tableItem, { borderTopColor: colors.border }]}><Feather name="grid" size={15} color={colors.primary} /><View style={styles.tableCopy}><Text style={[styles.tableName, { color: colors.foreground }]}>{table.name}</Text><Text style={[styles.tableMeta, { color: colors.mutedForeground }]}>{table.columns.length} {isArabic ? 'أعمدة' : 'columns'} · {table.rows.length} {isArabic ? 'صفوف' : 'rows'}</Text></View></View>)}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, gap: 12 },
  empty: { minHeight: 220, borderWidth: 1, borderRadius: 20, alignItems: 'center', justifyContent: 'center', padding: 30, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '700' },
  emptyText: { fontSize: 13, textAlign: 'center', lineHeight: 20 },
  databaseCard: { borderRadius: 19, borderWidth: 1, overflow: 'hidden' },
  databaseHeader: { flexDirection: 'row', alignItems: 'center', padding: 15, gap: 11 },
  databaseIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  databaseCopy: { flex: 1, gap: 3 },
  databaseName: { fontSize: 15, fontWeight: '700' },
  databaseMeta: { fontSize: 12 },
  tableItem: { flexDirection: 'row', alignItems: 'center', gap: 11, borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 18, paddingVertical: 13 },
  tableCopy: { gap: 2 },
  tableName: { fontSize: 13, fontWeight: '600' },
  tableMeta: { fontSize: 11 },
});
