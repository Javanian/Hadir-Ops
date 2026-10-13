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
import { useCheckin } from '../hooks/useCheckin';
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

function getStatusColor(status: AttendanceRecord['status']): string {
  switch (status) {
    case 'ONTIME': return colors.success;
    case 'LATE': return colors.warning;
    case 'OUT_OF_RADIUS': return colors.danger;
    default: return colors.textMuted;
  }
}

function getStatusLabel(status: AttendanceRecord['status']): string {
  switch (status) {
    case 'ONTIME': return 'Tepat Waktu';
    case 'LATE': return 'Terlambat';
    case 'OUT_OF_RADIUS': return 'Di Luar Area';
    default: return '-';
  }
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

export default function CheckinModal({ visible, onClose, userId, siteTimezone = 'Asia/Jakarta' }: Props) {
  const [step, setStep] = useState<Step>('locating');
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [retryToFace, setRetryToFace] = useState(false);
  const [result, setResult] = useState<AttendanceRecord | null>(null);
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);

  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();

  const checkin = useCheckin();
  const verify = useFaceVerify();

  const requestAndLocate = useCallback(async () => {
    setStep('locating');
    setCoords(null);
    setErrorMsg('');
    setRetryToFace(false);
    setResult(null);
    setCapturedUri(null);

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setErrorMsg('Izin lokasi diperlukan untuk absensi. Aktifkan di Pengaturan > Aplikasi > Izin Lokasi.');
        setStep('error');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      setCoords({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      setStep('ready');
    } catch {
      setErrorMsg('Gagal mendapatkan lokasi. Pastikan GPS aktif dan coba lagi.');
      setStep('error');
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
    console.log('[CheckinModal] handleCapture — cameraRef:', !!cameraRef.current,
      '| coords:', !!coords, '| userId:', userId);
    if (!cameraRef.current || !coords || !userId || isCapturing) {
      console.warn('[CheckinModal] handleCapture EARLY RETURN — guard failed');
      return;
    }
    setIsCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
      console.log('[CheckinModal] photo taken — uri:', photo?.uri?.slice(0, 80));
      if (!photo?.uri) return;
      // Store URI in state and change step — mirrors FaceRegisterModal's pattern.
      // React commits the render (CameraView unmounts) before the useEffect below
      // fires the actual upload, matching the timing that makes registration reliable.
      setCapturedUri(photo.uri);
      setStep('verifying');
    } catch {
      setErrorMsg('Gagal mengambil foto. Coba lagi.');
      setRetryToFace(true);
      setStep('error');
    } finally {
      setIsCapturing(false);
    }
  }

  // Runs after React commits the 'verifying' render (CameraView fully unmounted).
  // Mirrors the FaceRegisterModal upload timing that works reliably on Android.
  useEffect(() => {
    if (step !== 'verifying' || !capturedUri || !userId || !coords) return;
    const uri = capturedUri;
    setCapturedUri(null);

    const run = async () => {
      try {
        console.log('[CheckinModal] starting verify — userId:', userId);
        const res = await verify.mutateAsync({ userId, imageUri: uri });
        console.log('[CheckinModal] verify result — verified:', res.verified);
        if (res.verified) {
          setStep('submitting');
          console.log('[CheckinModal] starting checkin — coords:', coords);
          const record = await checkin.mutateAsync(coords);
          setResult(record);
          setStep('success');
        } else {
          setRetryToFace(true);
          setErrorMsg('Wajah tidak dikenali. Pastikan wajah Anda menghadap kamera dan coba lagi.');
          setStep('error');
        }
      } catch (e) {
        if (__DEV__) console.error('[CheckinModal] face/checkin error:', e);
        if (isAxiosError(e) && e.response?.status === 404) {
          setRetryToFace(false);
          setErrorMsg('Wajah belum terdaftar. Silakan daftarkan wajah di halaman Profil terlebih dahulu.');
        } else if (isAxiosError(e) && e.response?.data?.detail) {
          setRetryToFace(true);
          setErrorMsg(e.response.data.detail as string);
        } else if (isAxiosError(e) && !e.response) {
          const baseURL = e.config?.baseURL ?? 'unknown';
          setRetryToFace(true);
          setErrorMsg(`Tidak dapat terhubung ke server.\nURL: ${baseURL}\nError: ${e.message}`);
        } else if (isAxiosError(e)) {
          setRetryToFace(false);
          setErrorMsg(`HTTP ${e.response?.status ?? '?'}: ${e.response?.data?.detail ?? 'Gagal melakukan check in.'}`);
        } else {
          const msg = e instanceof Error ? e.message : String(e);
          setRetryToFace(true);
          setErrorMsg(`Kesalahan: ${msg}`);
        }
        setStep('error');
      }
    };
    run();
  }, [step, capturedUri, userId, coords, verify, checkin]);

  function renderContent() {
    if (step === 'locating') {
      return (
        <View style={styles.stateBox}>
          <ActivityIndicator size="large" color={colors.action} />
          <Text style={styles.stateTitle}>Mendapatkan Lokasi</Text>
          <Text style={styles.stateSubtitle}>Harap tunggu sebentar…</Text>
        </View>
      );
    }

    if (step === 'ready') {
      return (
        <View style={styles.stateBox}>
          <View style={styles.iconCircle}>
            <Ionicons name="location" size={32} color={colors.action} />
          </View>
          <Text style={styles.stateTitle}>Lokasi Ditemukan</Text>
          <Text style={styles.coordText}>
            {coords?.latitude.toFixed(6)}, {coords?.longitude.toFixed(6)}
          </Text>
          <Pressable style={styles.confirmBtn} onPress={openFaceVerify}>
            <Ionicons name="log-in-outline" size={20} color={colors.white} />
            <Text style={styles.confirmBtnText}>Konfirmasi Check In</Text>
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
                ? <ActivityIndicator color={colors.success} />
                : <View style={styles.shutterInner} />}
            </Pressable>
          </View>
        </View>
      );
    }

    if (step === 'verifying') {
      return (
        <View style={styles.stateBox}>
          <ActivityIndicator size="large" color={colors.action} />
          <Text style={styles.stateTitle}>Memverifikasi Wajah…</Text>
          <Text style={styles.stateSubtitle}>Harap tunggu sebentar.</Text>
        </View>
      );
    }

    if (step === 'submitting') {
      return (
        <View style={styles.stateBox}>
          <ActivityIndicator size="large" color={colors.success} />
          <Text style={styles.stateTitle}>Mencatat Absensi…</Text>
        </View>
      );
    }

    if (step === 'success' && result) {
      const statusColor = getStatusColor(result.status);
      return (
        <View style={styles.stateBox}>
          <View style={[styles.iconCircle, { backgroundColor: statusColor + '20' }]}>
            <Ionicons name="checkmark-circle" size={40} color={statusColor} />
          </View>
          <Text style={styles.stateTitle}>Check In Berhasil!</Text>
          <Text style={styles.timeText}>{formatTime(result.checkin_time, siteTimezone)}</Text>
          <View style={[styles.statusBadge, { backgroundColor: statusColor + '20' }]}>
            <Text style={[styles.statusBadgeText, { color: statusColor }]}>
              {getStatusLabel(result.status)}
            </Text>
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
              <Ionicons name="camera-outline" size={18} color={colors.action} />
              <Text style={styles.retryBtnText}>Coba Lagi</Text>
            </Pressable>
          ) : (
            <Pressable style={styles.retryBtn} onPress={requestAndLocate}>
              <Ionicons name="refresh-outline" size={18} color={colors.action} />
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
            <Text style={styles.headerTitle}>Check In</Text>
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
    backgroundColor: colors.actionTint,
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
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
  },
  coordText: {
    fontSize: 12,
    color: colors.textSubtle,
    fontVariant: ['tabular-nums'],
  },
  timeText: {
    fontSize: 40,
    fontWeight: '700',
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
  statusBadge: {
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  statusBadgeText: {
    fontSize: 14,
    fontWeight: '600',
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
    backgroundColor: colors.success,
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
    borderColor: colors.action,
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
    color: colors.action,
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
    backgroundColor: colors.success,
  },
});
