import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { demoApi, type DemoRole } from '../api/demo.api';
import { completeLogin } from '../hooks/useAuth';
import { t } from '../i18n';
import { colors } from '../theme/colors';

const ROLES: { role: DemoRole; icon: keyof typeof Ionicons.glyphMap; label: () => string; hint: () => string }[] = [
  { role: 'EMPLOYEE', icon: 'person-outline', label: () => t('demo.roleEmployee'), hint: () => t('demo.roleEmployeeHint') },
  { role: 'SUPERVISOR', icon: 'people-outline', label: () => t('demo.roleSupervisor'), hint: () => t('demo.roleSupervisorHint') },
];

/** One-click sign-in on the public demo. Renders nothing on a normal server. */
export default function DemoLoginPanel() {
  const queryClient = useQueryClient();
  const info = useQuery({ queryKey: ['demo'], queryFn: demoApi.info, staleTime: 10 * 60 * 1000, retry: false });
  const demoLogin = useMutation({
    mutationFn: (role: DemoRole) => demoApi.login(role),
    onSuccess: (tokens) => completeLogin(tokens, queryClient),
  });
  if (!info.data?.enabled) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t('demo.panelTitle')}</Text>
      <Text style={styles.hint}>{t('demo.panelHint')}</Text>
      {ROLES.map(({ role, icon, label, hint }) => (
        <Pressable
          key={role}
          style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
          disabled={demoLogin.isPending}
          onPress={() => demoLogin.mutate(role)}
          accessibilityRole="button"
        >
          {demoLogin.isPending && demoLogin.variables === role
            ? <ActivityIndicator color={colors.action} />
            : <Ionicons name={icon} size={20} color={colors.action} />}
          <View style={styles.optionText}>
            <Text style={styles.optionLabel}>{label()}</Text>
            <Text style={styles.optionHint}>{hint()}</Text>
          </View>
        </Pressable>
      ))}
      {demoLogin.isError && <Text style={styles.error}>{t('demo.loginFailed')}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.actionTint,
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    gap: 8,
  },
  title: { fontSize: 15, fontWeight: '700', color: colors.ink },
  hint: { fontSize: 13, lineHeight: 18, color: colors.textMuted, marginBottom: 4 },
  option: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: colors.white,
  },
  optionPressed: { opacity: 0.7 },
  optionText: { flex: 1 },
  optionLabel: { fontSize: 15, fontWeight: '600', color: colors.ink },
  optionHint: { fontSize: 12, color: colors.textMuted },
  error: { fontSize: 13, color: colors.danger },
});
