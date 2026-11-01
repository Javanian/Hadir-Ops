import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LOCALES, locale, setLocale, t, type Locale } from '../i18n';
import { colors } from '../theme/colors';

/** Two chips; choosing the other language saves it and reloads the app. */
export default function LanguageSwitcher() {
  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={t('common.language')}>
      {(Object.keys(LOCALES) as Locale[]).map((code) => {
        const active = code === locale;
        return (
          <Pressable
            key={code}
            onPress={() => setLocale(code)}
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
            style={[styles.chip, active && styles.chipActive]}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{LOCALES[code]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    justifyContent: 'center',
  },
  chipActive: { borderColor: colors.action, backgroundColor: colors.actionTint },
  chipText: { fontSize: 14, color: colors.textMuted },
  chipTextActive: { color: colors.action, fontWeight: '600' },
});
