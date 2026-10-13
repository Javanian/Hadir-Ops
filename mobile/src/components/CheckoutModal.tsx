import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { isAxiosError } from 'axios';
import { useCheckout } from '../hooks/useCheckin';
import { useFaceVerify } from '../hooks/useFaceRegister';
import { AttendanceRecord } from '../types/attendance';
import { colors } from '../theme/colors'

// ── Types ──────────────────────────────────────────────────────────────────────

type Step = 'locating' | 'ready' | 'face_verify' | 'verifying' | 'submitting' | 'success' | 'error';

interface Props {
  visible: boolean;
  onClose: () => void;
  userId?: number;
  siteTimezone?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} menit`;
  if (m === 0) return `${h} jam`;
  return `${h} jam ${m} menit`;
}

function formatTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CheckoutModal({ visible, onClose, userId, siteTimezone = 'Asia/Jakarta' }: Props) {
  const [step, setStep] = useState<Step>('locating');
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [retryToFace, setRetryToFace] = useState(false);
  const [result, setResult] = useState<AttendanceRecord | null>(null);

  const [isCapturing, setIsCapturing] = useState(false);

  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();

  const checkout = useCheckout();
  const verify = useFaceVerify();

  const requestAndLocate = useCallback(async () => {
    setStep('locating');
    setCoords(null);
    setErrorMsg('');
    setRetryToFace(false);
    setResult(null);

    try {
      // Location permission may already be granted from check-in.
      // If not granted, still attempt and handle denial gracefully.
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        // For check-out, GPS is optional per backend schema. Allow proceeding without coords.
        setCoords(undefined as unknown as { latitude: number; longitude: number });
        setStep('ready');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setCoords({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      setStep('ready');
    } catch {
      // GPS unavailable — still allow checkout without coords.
      setCoords(undefined as unknown as { latitude: number; longitude: number });
      setStep('ready');
    }
  }, []);

  useEffect(() => {
    if (visible) {
      requestAndLocate();
    }
  }, [visible, requestAndLocate]);

  async function openFaceVerify() {
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) {
        setErrorMsg('Izin kamera diperlukan untuk verifikasi wajah. Aktifkan di Pengaturan.');
        setRetryToFace(false);
        setStep('error');
        return;
      }
    }
    setRetryToFace(false);
    setStep('face_verify');
  }

  async function handleCapture() {
    if (!cameraRef.current || !userId || isCapturing) return;
    setIsCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
      if (!photo?.uri) return;
      setStep('verifying');

      const res = await verify.mutateAsync({ userId, imageUri: photo.uri });
      if (res.verified) {
        setStep('submitting');
        // coords may be null/undefined for checkout — backend accepts optional GPS.
        const record = await checkout.mutateAsync(coords ?? {});
        setResult(record);
        setStep('success');
      } else {
        setRetryToFace(true);
        setErrorMsg('Wajah tidak dikenali. Pastikan wajah Anda menghadap kamera dan coba lagi.');
        setStep('error');
      }
    } catch (e) {
      if (isAxiosError(e) && e.response?.status === 404) {
        setRetryToFace(false);
        setErrorMsg('Wajah belum terdaftar. Silakan daftarkan wajah di halaman Profil terlebih dahulu.');
      } else if (isAxiosError(e) && e.response?.data?.detail) {
        setRetryToFace(true);
        setErrorMsg(e.response.data.detail as string);
      } else if (isAxiosError(e) && !e.response) {
        setRetryToFace(true);
        setErrorMsg('Terjadi kesalahan jaringan. Coba lagi.');
      } else if (isAxiosError(e)) {
        setRetryToFace(false);
        setErrorMsg(e.response?.data?.detail ?? 'Gagal melakukan check out. Coba lagi.');
      } else {
        setRetryToFace(true);
        setErrorMsg('Gagal verifikasi wajah. Coba lagi.');
      }
      setStep('error');
    } finally {
      setIsCapturing(false);
    }
  }

  function renderContent() {
    if (step === 'locating') {
      return (
        <View style={styles.stateBox}>
          <ActivityIndicator size="large" color={colors.warning} />
          <Text style={styles.stateTitle}>Mendapatkan Lokasi</Text>
          <Text style={styles.stateSubtitle}>Harap tunggu sebentar…</Text>
        </View>
      );
    }

    if (step === 'ready') {
      return (
        <View style={styles.stateBox}>
          <View style={styles.iconCircle}>
            <Ionicons name="log-out-outline" size={32} color={colors.warning} />
          </View>
          <Text style={styles.stateTitle}>Konfirmasi Check Out</Text>
          <Text style={styles.stateSubtitle}>
            {coords
              ? `Lokasi: ${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`
              : 'Tanpa data lokasi'}
          </Text>
          <Pressable style={styles.confirmBtn} onPress={openFaceVerify}>
            <Ionicons name="log-out-outline" size={20} color={colors.white} />
            <Text style={styles.confirmBtnText}>Konfirmasi Check Out</Text>
          </Pressable>
        </View>
      );
    }

    if (step === 'face_verify') {
      return (
        <View style={styles.cameraWrapper}>
          <CameraView ref={cameraRef} style={StyleSheet.absoluteFillObject} facing="front" />
          {/* Oval face guide */}
          <View style={[StyleSheet.absoluteFillObject, styles.ovalContainer]}>
            <View style={styles.faceGuide} />
          </View>
          {/* Floating controls */}
          <View style={styles.cameraControls}>
            <Text style={styles.cameraHint}>Posisikan wajah di dalam lingkaran</Text>
            <Pressable style={styles.shutterBtn} onPress={handleCapture} disabled={isCapturing}>
              {isCapturing
                ? <ActivityIndicator color={colors.warning} />
                : <View style={styles.shutterInner} />}
            </Pressable>
          </View>
        </View>
      );
    }

    if (step === 'verifying') {
      return (
        <View style={styles.stateBox}>
          <ActivityIndicator size="large" color={colors.warning} />
          <Text style={styles.stateTitle}>Memverifikasi Wajah…</Text>
          <Text style={styles.stateSubtitle}>Harap tunggu sebentar.</Text>
        </View>
      );
    }

    if (step === 'submitting') {
      return (
        <View style={styles.stateBox}>
          <ActivityIndicator size="large" color={colors.warning} />
          <Text style={styles.stateTitle}>Mencatat Absensi Pulang…</Text>
        </View>
      );
    }

    if (step === 'success' && result) {
      return (
        <View style={styles.stateBox}>
          <View style={[styles.iconCircle, { backgroundColor: colors.warningTintStrong }]}>
            <Ionicons name="checkmark-circle" size={40} color={colors.warning} />
          </View>
          <Text style={styles.stateTitle}>Check Out Berhasil!</Text>
          {result.checkout_time && (
            <Text style={styles.timeText}>{formatTime(result.checkout_time, siteTimezone)}</Text>
          )}
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Durasi Kerja</Text>
              <Text style={styles.summaryValue}>
                {formatDuration(result.work_duration_minutes)}
              </Text>
            </View>
            {result.overtime_minutes > 0 && (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Lembur</Text>
                <Text style={[styles.summaryValue, { color: colors.warning }]}>
                  {formatDuration(result.overtime_minutes)}
                </Text>
              </View>
            )}
          </View>
          <Pressable style={styles.doneBtn} onPress={onClose}>
            <Text style={styles.doneBtnText}>Selesai</Text>
          </Pressable>
        </View>
      );
    }

    if (step === 'error') {
      return (
        <View style={styles.stateBox}>
          <View style={[styles.iconCircle, { backgroundColor: colors.dangerTintStrong }]}>
            <Ionicons name="alert-circle" size={36} color={colors.danger} />
          </View>
          <Text style={styles.stateTitle}>Gagal</Text>
          <Text style={styles.errorText}>{errorMsg}</Text>
          {retryToFace ? (
            <Pressable
              style={styles.retryBtn}
              onPress={() => { setErrorMsg(''); setStep('face_verify'); }}
            >
              <Ionicons name="camera-outline" size={18} color={colors.warning} />
              <Text style={styles.retryBtnText}>Coba Lagi</Text>
            </Pressable>
          ) : (
            <Pressable style={styles.retryBtn} onPress={requestAndLocate}>
              <Ionicons name="refresh-outline" size={18} color={colors.warning} />
              <Text style={styles.retryBtnText}>Coba Lagi</Text>
            </Pressable>
          )}
        </View>
      );
    }

    return null;
  }

  const isFullscreen = step === 'face_verify';
  const canClose = step !== 'submitting' && step !== 'locating' && step !== 'verifying' && step !== 'face_verify';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={canClose ? onClose : undefined}
    >
      <View style={styles.overlay}>
        <View style={[styles.sheet, isFullscreen && styles.sheetFullscreen]}>
          {/* Handle */}
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Check Out</Text>
            {canClose && (
              <Pressable onPress={onClose} hitSlop={12}>
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </Pressable>
            )}
          </View>

          {renderContent()}
        </View>
      </View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 40,
    paddingHorizontal: 24,
  },
  sheetFullscreen: {
    flex: 1,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    paddingHorizontal: 0,
    paddingBottom: 0,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderBottomWidth: 1,
    borderBottomColor: colors.muted,
    marginBottom: 24,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.ink,
  },
  stateBox: {
    alignItems: 'center',
    gap: 12,
    paddingBottom: 8,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.warningTintStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  stateTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.ink,
  },
  stateSubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
  },
  timeText: {
    fontSize: 40,
    fontWeight: '700',
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
  summaryCard: {
    backgroundColor: colors.canvas,
    borderRadius: 12,
    padding: 16,
    width: '100%',
    gap: 10,
    marginTop: 4,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: 14,
    color: colors.textMuted,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.ink,
  },
  errorText: {
    fontSize: 14,
    color: colors.danger,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 8,
  },
  confirmBtn: {
    height: 52,
    backgroundColor: colors.warning,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 32,
    marginTop: 8,
    width: '100%',
  },
  confirmBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.white,
  },
  doneBtn: {
    height: 52,
    backgroundColor: colors.action,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    marginTop: 8,
    width: '100%',
  },
  doneBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.white,
  },
  retryBtn: {
    height: 48,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.warning,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 24,
    marginTop: 8,
  },
  retryBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.warning,
  },
  // ── Camera (fills remaining space below header) ────────────────────────────
  cameraWrapper: {
    flex: 1,
  },
  ovalContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  faceGuide: {
    width: 220,
    height: 290,
    borderRadius: 110,
    borderWidth: 2.5,
    borderColor: 'rgba(255,255,255,0.9)',
    borderStyle: 'dashed',
  },
  cameraControls: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 16,
  },
  cameraHint: {
    fontSize: 14,
    color: colors.white,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  shutterBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.white,
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.warning,
  },
});
