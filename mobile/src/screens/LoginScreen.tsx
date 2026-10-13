import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { isAxiosError } from '../api/axios';
import { useLogin } from '../hooks/useAuth';
import { colors } from '../theme/colors'

export default function LoginScreen() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [secureText, setSecureText] = useState(true);

  const login = useLogin();

  function getErrorMessage(error: unknown): string {
    if (__DEV__ && isAxiosError(error)) {
      console.error('[LoginScreen] login error:', {
        code: error.code,
        message: error.message,
        baseURL: error.config?.baseURL,
        status: error.response?.status,
      });
    } else if (__DEV__) {
      console.error('[LoginScreen] login error (non-axios):', error);
    }

    if (isAxiosError(error)) {
      // Network error — server never responded (wrong IP, backend down, firewall, etc.)
      if (!error.response) {
        const url = error.config?.baseURL ?? '';
        return `Tidak dapat terhubung ke server.\n\nPastikan:\n• Backend berjalan\n• HP dan PC di jaringan Wi-Fi yang sama\n• IP di .env sudah benar\n  (${url})`;
      }
      if (error.response.status === 429) return 'Terlalu banyak percobaan. Silakan tunggu.';
      if (error.response.status >= 500) return 'Server error. Silakan coba lagi nanti.';

      // Structured error codes from backend
      const data = error.response.data as {
        code?: string;
        attempts_remaining?: number;
        retry_in_minutes?: number;
      } | undefined;
      const code = data?.code;
      if (code === 'USER_NOT_FOUND') return 'Username tidak ditemukan.';
      if (code === 'WRONG_PASSWORD') {
        const rem = data?.attempts_remaining;
        return rem != null
          ? `Password salah. Sisa percobaan: ${rem} kali.`
          : 'Password salah.';
      }
      if (code === 'ACCOUNT_LOCKED') {
        const mins = data?.retry_in_minutes;
        return mins != null
          ? `Akun terkunci. Coba lagi dalam ${mins} menit.`
          : 'Akun terkunci. Coba lagi beberapa menit lagi.';
      }
      if (code === 'ACCOUNT_INACTIVE') return 'Akun tidak aktif. Hubungi administrator.';

      if (error.response.status === 401) return 'Email/ID atau password salah.';
    }
    // Internal auth errors (e.g. "No refresh token available") must never surface raw
    return 'Login gagal. Periksa username dan password.';
  }

  async function handleLogin() {
    if (!identifier.trim() || !password) return;

    try {
      await login.mutateAsync({ identifier: identifier.trim(), password });
    } catch {
      // Error displayed via login.error
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={styles.header}>
            <Image
              source={require('../../assets/icon.png')}
              style={styles.logo}
              accessibilityIgnoresInvertColors
            />
            <Text style={styles.eyebrow}>HadirOps</Text>
            <Text style={styles.appName}>Masuk ke akunmu</Text>
            <Text style={styles.subtitle}>Presensi dan operasional karyawan</Text>
          </View>

          {/* Form */}
          <View style={[styles.form, styles.card]}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Email atau ID karyawan</Text>
              <TextInput
                style={styles.input}
                value={identifier}
                onChangeText={setIdentifier}
                placeholder="Masukkan email atau ID karyawan"
                placeholderTextColor={colors.textMuted}
                accessibilityLabel="Email atau ID karyawan"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                editable={!login.isPending}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Kata sandi</Text>
              <View style={styles.passwordRow}>
                <TextInput
                  style={[styles.input, styles.passwordInput]}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Masukkan kata sandi"
                  placeholderTextColor={colors.textMuted}
                  accessibilityLabel="Kata sandi"
                  secureTextEntry={secureText}
                  textContentType="password"
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                  editable={!login.isPending}
                />
                <Pressable
                  style={styles.eyeBtn}
                  onPress={() => setSecureText((v) => !v)}
                  accessibilityRole="button"
                  accessibilityLabel={secureText ? 'Tampilkan kata sandi' : 'Sembunyikan kata sandi'}
                >
                  <Text style={styles.eyeText}>{secureText ? 'Lihat' : 'Tutup'}</Text>
                </Pressable>
              </View>
            </View>

            {login.error != null && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>
                  {getErrorMessage(login.error)}
                </Text>
              </View>
            )}

            <Pressable
              style={[
                styles.button,
                (login.isPending || !identifier.trim() || !password) &&
                  styles.buttonDisabled,
              ]}
              onPress={handleLogin}
              disabled={login.isPending || !identifier.trim() || !password}
            >
              {login.isPending ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.buttonText}>Masuk ke HadirOps</Text>
              )}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  flex: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 40,
  },
  header: {
    marginBottom: 28,
  },
  logo: {
    width: 56,
    height: 56,
    borderRadius: 16,
    marginBottom: 24,
    shadowColor: colors.action,
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  eyebrow: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.action,
    marginBottom: 6,
  },
  appName: {
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: -0.5,
    color: colors.ink,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    color: colors.textMuted,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: colors.ink,
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  form: {
    gap: 16,
  },
  inputGroup: {
    gap: 6,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 15,
    color: colors.ink,
    backgroundColor: colors.white,
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  passwordInput: {
    flex: 1,
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
    borderRightWidth: 0,
  },
  eyeBtn: {
    height: 48,
    width: 64,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
  eyeText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.action,
  },
  errorBox: {
    backgroundColor: colors.dangerTint,
    borderRadius: 8,
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: colors.dangerBright,
  },
  errorText: {
    fontSize: 13,
    color: colors.dangerStrong,
  },
  button: {
    height: 52,
    backgroundColor: colors.action,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    shadowColor: colors.action,
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.white,
  },
});
