import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { isAxiosError } from '../api/axios';
import { useChangePassword } from '../hooks/useAuth';
import { colors } from '../theme/colors'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  onClose: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getServerError(error: unknown): string {
  if (isAxiosError(error) && error.response?.data) {
    const data = error.response.data as { code?: string } | undefined;
    switch (data?.code) {
      case 'SAME_PASSWORD':
        return 'Password baru tidak boleh sama dengan password lama.';
      case 'WRONG_CURRENT_PASSWORD':
        return 'Password saat ini salah.';
      default:
        break;
    }
    // FastAPI validation error (422)
    if (error.response.status === 422) {
      return 'Input tidak valid. Periksa kembali isian Anda.';
    }
  }
  return 'Terjadi kesalahan. Silakan coba lagi.';
}

// ── PasswordField sub-component ───────────────────────────────────────────────

function PasswordField({
  label,
  value,
  onChangeText,
  placeholder,
  editable,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  editable: boolean;
}) {
  const [secure, setSecure] = useState(true);
  return (
    <View style={fieldStyles.group}>
      <Text style={fieldStyles.label}>{label}</Text>
      <View style={fieldStyles.row}>
        <TextInput
          style={[fieldStyles.input, fieldStyles.inputFlex]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textSubtle}
          secureTextEntry={secure}
          textContentType="password"
          autoCapitalize="none"
          autoCorrect={false}
          editable={editable}
        />
        <Pressable
          style={fieldStyles.eyeBtn}
          onPress={() => setSecure((v) => !v)}
          accessibilityLabel={secure ? 'Tampilkan password' : 'Sembunyikan password'}
        >
          <Text style={fieldStyles.eyeText}>{secure ? '👁' : '🙈'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const fieldStyles = StyleSheet.create({
  group: { gap: 6 },
  label: { fontSize: 14, fontWeight: '500', color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center' },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 15,
    color: colors.ink,
    backgroundColor: colors.white,
  },
  inputFlex: {
    flex: 1,
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
    borderRightWidth: 0,
  },
  eyeBtn: {
    height: 48,
    width: 48,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderTopRightRadius: 10,
    borderBottomRightRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
  eyeText: { fontSize: 18 },
});

// ── Main Component ─────────────────────────────────────────────────────────────

export default function ChangePasswordModal({ visible, onClose }: Props) {
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [clientError, setClientError] = useState<string | null>(null);

  const changePassword = useChangePassword();

  function resetForm() {
    setCurrentPw('');
    setNewPw('');
    setConfirmPw('');
    setClientError(null);
    changePassword.reset();
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  async function handleSubmit() {
    setClientError(null);
    changePassword.reset();

    // Client-side validation
    if (!currentPw || !newPw || !confirmPw) {
      setClientError('Semua kolom wajib diisi.');
      return;
    }
    if (newPw.length < 8) {
      setClientError('Password baru minimal 8 karakter.');
      return;
    }
    if (newPw !== confirmPw) {
      setClientError('Konfirmasi password tidak cocok.');
      return;
    }

    try {
      await changePassword.mutateAsync({
        current_password: currentPw,
        new_password: newPw,
      });
      // onSuccess in the hook handles logout + navigation — modal will unmount naturally
    } catch {
      // Error displayed via changePassword.error below
    }
  }

  const isPending = changePassword.isPending;
  const serverError = changePassword.error ? getServerError(changePassword.error) : null;
  const errorMessage = clientError ?? serverError;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.card}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Ionicons name="lock-closed-outline" size={20} color={colors.action} />
              <Text style={styles.headerTitle}>Ubah Password</Text>
            </View>
            <Pressable onPress={handleClose} disabled={isPending} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <PasswordField
              label="Password Saat Ini"
              value={currentPw}
              onChangeText={setCurrentPw}
              placeholder="Masukkan password saat ini"
              editable={!isPending}
            />
            <PasswordField
              label="Password Baru"
              value={newPw}
              onChangeText={setNewPw}
              placeholder="Minimal 8 karakter"
              editable={!isPending}
            />
            <PasswordField
              label="Konfirmasi Password Baru"
              value={confirmPw}
              onChangeText={setConfirmPw}
              placeholder="Ulangi password baru"
              editable={!isPending}
            />

            {errorMessage != null && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={16} color={colors.dangerStrong} />
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            )}

            <Pressable
              style={[styles.submitBtn, isPending && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={isPending}
            >
              {isPending ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.submitText}>Simpan Password</Text>
              )}
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.muted,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.ink,
  },
  closeBtn: {
    padding: 4,
  },
  body: {
    padding: 20,
    gap: 16,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: colors.dangerTint,
    borderRadius: 8,
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: colors.dangerBright,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: colors.dangerStrong,
    lineHeight: 18,
  },
  submitBtn: {
    height: 52,
    backgroundColor: colors.action,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  submitBtnDisabled: {
    backgroundColor: colors.actionBorderStrong,
  },
  submitText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.white,
  },
});
