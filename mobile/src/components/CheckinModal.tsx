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
import { CameraView, useCameraPermissions } from 'expo-camera';
import { isAxiosError } from 'axios';
import { useQueryClient } from '@tanstack/react-query';
import { faceApi } from '../api/face.api';
import { OutboxItem } from '../offline/outbox';
import { keepPhoto } from '../offline/photos';
import { capture, errorMessage, reportAttempt, submit } from '../offline/sync';
import { AttendanceRecord } from '../types/attendance';
import { Fix, getFix } from '../utils/location';
import { reviewReason } from '../utils/reviewReason';
import { colors } from '../theme/colors'

// ── Types ──────────────────────────────────────────────────────────────────────

type Step = 'locating' | 'ready' | 'face_verify' | 'verifying' | 'submitting' | 'success' | 'queued' | 'error';

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
  const [fix, setFix] = useState<Fix | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [retryToFace, setRetryToFace] = useState(false);
  const [result, setResult] = useState<AttendanceRecord | null>(null);
  const [queuedAt, setQueuedAt] = useState<string | null>(null);
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);

  const cameraRef = useRef<CameraView>(null);
  const pendingRef = useRef<OutboxItem | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const queryClient = useQueryClient();

  const requestAndLocate = useCallback(async () => {
    setStep('locating');
    setFix(null);
    setErrorMsg('');
    setRetryToFace(false);
    setResult(null);
    setQueuedAt(null);
    setCapturedUri(null);
    pendingRef.current = null;

    try {
      setFix(await getFix());
      setStep('ready');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Gagal mendapatkan lokasi.';
      if (userId) reportAttempt(userId, 'CHECKIN', 'NO_GPS', msg);
      setErrorMsg(msg);
      setStep('error');
    }
  }, [userId]);

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
    if (!cameraRef.current || !fix || !userId || isCapturing) return;
    setIsCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
      if (!photo?.uri) return;
      // The check-in time is the moment of the photo, even if sending happens later.
      pendingRef.current = capture('checkin', userId, {
        latitude: fix.latitude,
        longitude: fix.longitude,
        accuracy_m: fix.accuracy ?? undefined,
        is_mocked: fix.mocked || undefined,
      });
      // Store URI in state and change step — React commits the render
      // (CameraView unmounts) before the effect below starts the upload,
      // the timing that makes uploads reliable on Android.
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

  async function send(item: OutboxItem) {
    setStep('submitting');
    const outcome = await submit(item);
    if (outcome.status === 'sent') {
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
      setResult(outcome.record ?? null);
      setStep('success');
    } else if (outcome.status === 'queued') {
      setQueuedAt(item.capturedAt);
      setStep('queued');
    } else {
      setRetryToFace(false);
      setErrorMsg(outcome.message);
      setStep('error');
    }
  }

  // Runs after React commits the 'verifying' render (CameraView fully unmounted).
  useEffect(() => {
    const item = pendingRef.current;
    if (step !== 'verifying' || !capturedUri || !userId || !item) return;
    const uri = capturedUri;
    setCapturedUri(null);

    const run = async () => {
      let res;
      try {
        res = await faceApi.verify(userId, uri);
      } catch (e) {
        const status = isAxiosError(e) ? e.response?.status : undefined;
        if (status === 404) {
          setRetryToFace(false);
          setErrorMsg('Wajah belum terdaftar. Silakan daftarkan wajah di halaman Profil terlebih dahulu.');
          setStep('error');
          return;
        }
        if (status === undefined || status >= 500) {
          // No signal or server trouble: record the check-in now and attach
          // the photo when it syncs. It is marked for supervisor review.
          item.photoPath = await keepPhoto(uri, item.id);
          await send(item);
          return;
        }
        const msg = errorMessage(e);
        reportAttempt(userId, 'CHECKIN', 'FACE_ERROR', msg, item.body);
        setRetryToFace(true);
        setErrorMsg(msg);
        setStep('error');
        return;
      }

      if (!res.verified) {
        reportAttempt(userId, 'CHECKIN', 'FACE_MISMATCH', `similarity ${res.similarity}`, item.body);
        setRetryToFace(true);
        setErrorMsg('Wajah tidak dikenali. Pastikan wajah Anda menghadap kamera dan coba lagi.');
        setStep('error');
        return;
      }
      item.body.face_token = res.face_token;
      await send(item);
    };
    run().catch((e) => {
      setRetryToFace(false);
      setErrorMsg(`Kesalahan: ${errorMessage(e)}`);
      setStep('error');
    });
  }, [step, capturedUri, userId]);

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
            {fix?.latitude.toFixed(6)}, {fix?.longitude.toFixed(6)}
            {fix?.accuracy != null ? `  ±${Math.round(fix.accuracy)} m` : ''}
          </Text>
          {fix?.stale && (
            <Text style={styles.stateSubtitle}>Memakai posisi terakhir yang tersimpan di HP.</Text>
          )}
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
            <Pressable
              style={styles.shutterBtn}
              onPress={handleCapture}
              disabled={isCapturing}
              accessibilityRole="button"
              accessibilityLabel="Ambil foto"
            >
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

    if (step === 'queued' && queuedAt) {
      return (
        <View style={styles.stateBox}>
          <View style={[styles.iconCircle, { backgroundColor: colors.warning + '20' }]}>
            <Ionicons name="cloud-upload-outline" size={36} color={colors.warning} />
          </View>
          <Text style={styles.stateTitle}>Absen Tersimpan di HP</Text>
          <Text style={styles.timeText}>{formatTime(queuedAt, siteTimezone)}</Text>
          <Text style={styles.stateSubtitle}>
            Belum ada sinyal ke server. Jam absen Anda sudah tercatat dan akan dikirim
            otomatis saat koneksi kembali. Tidak perlu absen ulang.
          </Text>
          <Pressable style={styles.doneBtn} onPress={onClose}>
            <Text style={styles.doneBtnText}>Mengerti</Text>
          </Pressable>
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
          {result.needs_review && (
            <Text style={styles.stateSubtitle}>
              Absen tercatat. Supervisor akan meninjau karena {reviewReason(result.risk_flags)}.
            </Text>
          )}
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
          <Text style={styles.stateSubtitle}>Percobaan ini tercatat dan bisa dilihat supervisor.</Text>
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
              <Pressable accessibilityRole="button" accessibilityLabel="Tutup" onPress={onClose} hitSlop={12}>
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
