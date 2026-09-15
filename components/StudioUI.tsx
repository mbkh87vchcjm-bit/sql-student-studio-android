import { Feather } from '@expo/vector-icons';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ExecutionResult } from '@/lib/sqlEngine';

export function AppMark({ compact = false }: { compact?: boolean }) {
  const colors = useColors();
  return (
    <View style={styles.markRow}>
      <View style={[styles.mark, { backgroundColor: colors.primary }]}>
        <Feather name="database" size={compact ? 17 : 21} color={colors.primaryForeground} />
      </View>
      {!compact && <Text style={[styles.brand, { color: colors.foreground }]}>SQL Student Studio</Text>}
    </View>
  );
}

export function ScreenHeader({ eyebrow, title, subtitle }: { eyebrow?: string; title: string; subtitle?: string }) {
  const colors = useColors();
  return (
    <View style={styles.header}>
      <AppMark compact />
      {eyebrow && <Text style={[styles.eyebrow, { color: colors.primary }]}>{eyebrow}</Text>}
      <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
      {subtitle && <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{subtitle}</Text>}
    </View>
  );
}

export function SectionLabel({ children, action }: { children: string; action?: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={styles.sectionRow}>
      <Text style={[styles.sectionLabel, { color: colors.foreground }]}>{children}</Text>
      {action}
    </View>
  );
}

export function IconButton({ icon, onPress, label, tone = 'secondary' }: { icon: keyof typeof Feather.glyphMap; onPress: () => void; label?: string; tone?: 'primary' | 'secondary' }) {
  const colors = useColors();
  const primary = tone === 'primary';
  return (
    <Pressable testID={label} accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.iconButton, { backgroundColor: primary ? colors.primary : colors.secondary, opacity: pressed ? 0.72 : 1 }]}>
      <Feather name={icon} size={17} color={primary ? colors.primaryForeground : colors.secondaryForeground} />
      {label && <Text style={[styles.iconButtonText, { color: primary ? colors.primaryForeground : colors.secondaryForeground }]}>{label}</Text>}
    </Pressable>
  );
}

export function StatCard({ icon, value, label, accent }: { icon: keyof typeof Feather.glyphMap; value: string; label: string; accent?: boolean }) {
  const colors = useColors();
  return (
    <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.statIcon, { backgroundColor: accent ? colors.accent : colors.secondary }]}>
        <Feather name={icon} size={16} color={accent ? colors.accentForeground : colors.secondaryForeground} />
      </View>
      <Text style={[styles.statValue, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

export function ResultPanel({ result, emptyLabel }: { result: ExecutionResult | null; emptyLabel: string }) {
  const colors = useColors();
  if (!result) {
    return (
      <View style={[styles.emptyPanel, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Feather name="grid" size={24} color={colors.mutedForeground} />
        <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{emptyLabel}</Text>
      </View>
    );
  }
  const hasError = result.errors.length > 0;
  return (
    <View style={[styles.resultPanel, { backgroundColor: colors.card, borderColor: hasError ? colors.destructive : colors.border }]}>
      <View style={styles.resultHeader}>
        <View style={styles.resultTitleRow}>
          <Feather name={hasError ? 'alert-circle' : 'check-circle'} size={17} color={hasError ? colors.destructive : colors.primary} />
          <Text style={[styles.resultTitle, { color: colors.foreground }]}>{hasError ? 'Execution error' : 'Execution result'}</Text>
        </View>
        <Text style={[styles.duration, { color: colors.mutedForeground }]}>{result.durationMs} ms</Text>
      </View>
      {result.errors.map((error) => <Text key={error} style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>)}
      {!hasError && result.columns.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View>
            <View style={[styles.tableRow, { backgroundColor: colors.secondary }]}>
              {result.columns.map((column) => <Text key={column} style={[styles.cell, styles.headerCell, { color: colors.secondaryForeground }]}>{column}</Text>)}
            </View>
            {result.rows.map((row, index) => (
              <View key={`${index}-${row.join('-')}`} style={[styles.tableRow, { borderBottomColor: colors.border }]}>
                {row.map((value, cellIndex) => <Text key={`${cellIndex}-${value}`} style={[styles.cell, { color: colors.foreground }]}>{value}</Text>)}
              </View>
            ))}
          </View>
        </ScrollView>
      )}
      {result.messages.map((message) => <Text key={message} style={[styles.messageText, { color: colors.mutedForeground }]}>{message}</Text>)}
    </View>
  );
}

export const styles = StyleSheet.create({
  markRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mark: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  brand: { fontSize: 16, fontWeight: '700', letterSpacing: -0.3 },
  header: { gap: 6, marginBottom: 22 },
  eyebrow: { fontSize: 12, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase', marginTop: 13 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: -0.8 },
  subtitle: { fontSize: 14, lineHeight: 21, marginTop: 2 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionLabel: { fontSize: 16, fontWeight: '700' },
  iconButton: { minHeight: 42, borderRadius: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  iconButtonText: { fontSize: 13, fontWeight: '700' },
  statCard: { flex: 1, minHeight: 112, borderRadius: 17, borderWidth: 1, padding: 14, justifyContent: 'space-between' },
  statIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  statValue: { fontSize: 22, fontWeight: '700', marginTop: 8 },
  statLabel: { fontSize: 12, fontWeight: '500' },
  emptyPanel: { minHeight: 160, borderWidth: 1, borderRadius: 18, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  emptyTitle: { fontSize: 14, fontWeight: '600', textAlign: 'center' },
  resultPanel: { borderRadius: 18, borderWidth: 1, padding: 14, gap: 10 },
  resultHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  resultTitleRow: { flexDirection: 'row', gap: 7, alignItems: 'center' },
  resultTitle: { fontSize: 14, fontWeight: '700' },
  duration: { fontSize: 11 },
  errorText: { fontSize: 13, lineHeight: 20, fontWeight: '600' },
  messageText: { fontSize: 12, marginTop: 2 },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1, minWidth: 350 },
  cell: { minWidth: 100, paddingVertical: 10, paddingHorizontal: 9, fontSize: 12 },
  headerCell: { fontWeight: '700' },
});
