import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { demoApi } from '../api/demo.api';
import { intlLocale, t } from '../i18n';
import { colors } from '../theme/colors';

/** On the public demo: fictional data that resets every day. */
export default function DemoBanner() {
  const { data } = useQuery({ queryKey: ['demo'], queryFn: demoApi.info, staleTime: 10 * 60 * 1000, retry: false });
  if (!data?.enabled) return null;
  const time = data.next_reset_at
    ? new Intl.DateTimeFormat(intlLocale, { hour: '2-digit', minute: '2-digit' }).format(new Date(data.next_reset_at))
    : null;
  return (
    <View style={styles.banner} accessibilityRole="text">
      <Ionicons name="flask-outline" size={16} color={colors.warningStrong} />
      <Text style={styles.text}>
        {t('demo.bannerTitle')} {time ? t('demo.bannerResetAt', { time }) : t('demo.bannerReset')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    backgroundColor: colors.warningTint,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  text: { flex: 1, fontSize: 12, lineHeight: 17, color: colors.warningStrong },
});
