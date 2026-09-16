import { Feather } from '@expo/vector-icons';
import React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useStudio } from '@/lib/studioContext';
import { AppMark, ScreenHeader } from '@/components/StudioUI';

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { locale, setLocale, reset } = useStudio();
  const isArabic = locale === 'ar';
  const confirmReset = () => Alert.alert(isArabic ? 'مسح مساحة العمل؟' : 'Clear workspace?', isArabic ? 'سيتم حذف قواعد البيانات المحفوظة محليًا.' : 'Locally saved databases will be deleted.', [{ text: isArabic ? 'إلغاء' : 'Cancel', style: 'cancel' }, { text: isArabic ? 'مسح' : 'Clear', style: 'destructive', onPress: reset }]);
  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={[styles.content, { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 110 }]} showsVerticalScrollIndicator={false}>
      <ScreenHeader eyebrow={isArabic ? 'التطبيق' : 'APPLICATION'} title={isArabic ? 'الإعدادات' : 'Settings'} subtitle={isArabic ? 'خصّص طريقة تعلّمك وحافظ على مساحة العمل.' : 'Customize your learning experience and workspace.'} />
      <View style={[styles.brandCard, { backgroundColor: colors.editor }]}><AppMark /><Text style={[styles.brandVersion, { color: colors.editorMuted }]}>T-SQL educational engine · v1.0.0</Text></View>
      <Text style={[styles.groupLabel, { color: colors.mutedForeground }]}>{isArabic ? 'اللغة' : 'LANGUAGE'}</Text>
      <View style={[styles.optionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.optionIcon}><Feather name="globe" size={18} color={colors.primary} /></View><View style={styles.optionCopy}><Text style={[styles.optionTitle, { color: colors.foreground }]}>{isArabic ? 'لغة الواجهة' : 'Interface language'}</Text><Text style={[styles.optionSub, { color: colors.mutedForeground }]}>{isArabic ? 'العربية' : 'English'}</Text></View>
        <View style={[styles.segment, { backgroundColor: colors.secondary }]}><Pressable onPress={() => setLocale('ar')} style={[styles.segmentButton, locale === 'ar' && { backgroundColor: colors.primary }]}><Text style={[styles.segmentText, { color: locale === 'ar' ? colors.primaryForeground : colors.secondaryForeground }]}>عربي</Text></Pressable><Pressable onPress={() => setLocale('en')} style={[styles.segmentButton, locale === 'en' && { backgroundColor: colors.primary }]}><Text style={[styles.segmentText, { color: locale === 'en' ? colors.primaryForeground : colors.secondaryForeground }]}>EN</Text></Pressable></View>
      </View>
      <Text style={[styles.groupLabel, { color: colors.mutedForeground }]}>{isArabic ? 'مساحة العمل' : 'WORKSPACE'}</Text>
      <Pressable testID="reset-workspace" onPress={confirmReset} style={[styles.optionCard, { backgroundColor: colors.card, borderColor: colors.border }]}><View style={[styles.optionIcon, { backgroundColor: '#FFF0EE' }]}><Feather name="trash-2" size={18} color={colors.destructive} /></View><View style={styles.optionCopy}><Text style={[styles.optionTitle, { color: colors.foreground }]}>{isArabic ? 'مسح قواعد البيانات' : 'Clear databases'}</Text><Text style={[styles.optionSub, { color: colors.mutedForeground }]}>{isArabic ? 'حذف كل البيانات المحلية وإعادة المحرر للدرس التجريبي' : 'Delete local data and restore the starter lesson'}</Text></View><Feather name="chevron-left" size={18} color={colors.mutedForeground} /></Pressable>
      <View style={styles.note}><Feather name="info" size={16} color={colors.primary} /><Text style={[styles.noteText, { color: colors.mutedForeground }]}>{isArabic ? 'هذا التطبيق محرك T-SQL تعليمي مستقل، وليس Microsoft SQL Server.' : 'This is an independent educational T-SQL engine, not Microsoft SQL Server.'}</Text></View>

      <Text style={[styles.groupLabel, { color: colors.mutedForeground }]}>{isArabic ? 'حول التطبيق' : 'ABOUT APP'}</Text>
      <View style={[styles.aboutCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.aboutTitle, { color: colors.foreground }]}>SQL Student Studio</Text>
        <Text style={[styles.aboutMeta, { color: colors.mutedForeground }]}>{isArabic ? 'الإصدار 1.0.0' : 'Version 1.0.0'}</Text>
        <Text style={[styles.aboutMeta, { color: colors.mutedForeground }]}>{isArabic ? 'المطور: محمد الفقيه' : 'Developer: Mohammed Al-Faqeeh'}</Text>
        <Text style={[styles.aboutMeta, { color: colors.mutedForeground }]}>© 2026 {isArabic ? 'محمد الفقيه' : 'Mohammed Al-Faqeeh'}</Text>
        <Text style={[styles.aboutMeta, { color: colors.mutedForeground }]}>{isArabic ? 'جميع الحقوق محفوظة' : 'All rights reserved'}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, gap: 12 },
  brandCard: { minHeight: 120, borderRadius: 20, padding: 18, justifyContent: 'space-between', marginBottom: 10 },
  brandVersion: { fontSize: 11, fontFamily: 'monospace' },
  groupLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1.1, marginTop: 12 },
  optionCard: { borderWidth: 1, borderRadius: 17, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 11 },
  optionIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#E7F5F4', alignItems: 'center', justifyContent: 'center' },
  optionCopy: { flex: 1, gap: 3 },
  optionTitle: { fontSize: 14, fontWeight: '700' },
  optionSub: { fontSize: 11, lineHeight: 16 },
  segment: { borderRadius: 10, padding: 3, flexDirection: 'row', gap: 2 },
  segmentButton: { minWidth: 35, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  segmentText: { fontSize: 11, fontWeight: '700' },
  note: { flexDirection: 'row', gap: 9, padding: 12, marginTop: 8 },
  noteText: { flex: 1, fontSize: 12, lineHeight: 18 },
  aboutCard: { borderWidth: 1, borderRadius: 17, padding: 16, gap: 6, alignItems: 'center' },
  aboutTitle: { fontSize: 16, fontWeight: '700', marginBottom: 2 },
  aboutMeta: { fontSize: 12, lineHeight: 18, textAlign: 'center' },
});
