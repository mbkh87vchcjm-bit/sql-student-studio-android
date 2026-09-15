import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useStudio } from '@/lib/studioContext';
import { IconButton, ResultPanel, SectionLabel, ScreenHeader } from '@/components/StudioUI';

export default function StudioScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { script, setScript, execute, result, locale } = useStudio();
  const isArabic = locale === 'ar';
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 110 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.toolbar}><Pressable onPress={() => router.back()} style={styles.back}><Feather name="arrow-right" size={20} color={colors.foreground} /></Pressable><View style={styles.toolbarTitle}><Text style={[styles.toolbarEyebrow, { color: colors.primary }]}>{isArabic ? 'المحرر' : 'EDITOR'}</Text><Text style={[styles.toolbarText, { color: colors.foreground }]}>{isArabic ? 'استوديو SQL' : 'SQL Studio'}</Text></View><IconButton icon="play" onPress={execute} label={isArabic ? 'تشغيل' : 'Run'} tone="primary" /></View>
        <ScreenHeader title={isArabic ? 'اكتب، نفّذ، وتعلّم.' : 'Write, run, learn.'} subtitle={isArabic ? 'يدعم المحرك أوامر T-SQL التعليمية الأساسية مع GO بين الدفعات.' : 'The engine supports core educational T-SQL with GO between batches.'} />
        <SectionLabel action={<Text style={[styles.ltrHint, { color: colors.editorMuted }]}>{isArabic ? 'النص من اليسار إلى اليمين' : 'LTR editor'}</Text>}>{isArabic ? 'نص الاستعلام' : 'Query script'}</SectionLabel>
        <View style={[styles.editorShell, { backgroundColor: colors.editor }]}>
          <View style={styles.editorTop}><View style={styles.windowDots}><View style={[styles.dot, { backgroundColor: colors.accent }]} /><View style={[styles.dot, { backgroundColor: colors.primary }]} /><View style={[styles.dot, { backgroundColor: colors.editorMuted }]} /></View><Text style={[styles.editorLabel, { color: colors.editorMuted }]}>lesson.sql</Text><Pressable testID="clear-script" onPress={() => setScript('')}><Feather name="trash-2" size={15} color={colors.editorMuted} /></Pressable></View>
          <TextInput testID="sql-editor" value={script} onChangeText={setScript} multiline autoCapitalize="none" autoCorrect={false} spellCheck={false} textAlign="left" textAlignVertical="top" style={[styles.editorInput, { color: colors.editorForeground }]} placeholder="SELECT * FROM Students;" placeholderTextColor={colors.editorMuted} />
        </View>
        <View style={styles.quickRow}>
          <Text style={[styles.quickLabel, { color: colors.mutedForeground }]}>{isArabic ? 'أمثلة سريعة' : 'Quick examples'}</Text>
          {['SELECT * FROM Students;', 'SELECT Name, Age FROM Students WHERE Age >= 20;'].map((example) => <Pressable key={example} onPress={() => setScript(example)} style={[styles.exampleChip, { backgroundColor: colors.secondary }]}><Text numberOfLines={1} style={[styles.exampleText, { color: colors.secondaryForeground }]}>{example}</Text></Pressable>)}
        </View>
        <ResultPanel result={result} emptyLabel={isArabic ? 'ستظهر النتائج هنا بعد التشغيل' : 'Results will appear here after execution'} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, gap: 10 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20 },
  back: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  toolbarTitle: { flex: 1, gap: 2 },
  toolbarEyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 1.1 },
  toolbarText: { fontSize: 15, fontWeight: '700' },
  ltrHint: { fontSize: 11 },
  editorShell: { borderRadius: 19, overflow: 'hidden', minHeight: 340 },
  editorTop: { height: 42, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#36515A' },
  windowDots: { flexDirection: 'row', gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  editorLabel: { flex: 1, fontFamily: 'monospace', fontSize: 11 },
  editorInput: { flex: 1, minHeight: 295, paddingHorizontal: 16, paddingVertical: 16, fontFamily: 'monospace', fontSize: 13, lineHeight: 21 },
  quickRow: { gap: 8, marginBottom: 10 },
  quickLabel: { fontSize: 12, fontWeight: '600' },
  exampleChip: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10 },
  exampleText: { fontFamily: 'monospace', fontSize: 11 },
});
