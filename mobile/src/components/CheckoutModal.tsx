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
  const [fix, setFix] = useState<Fix | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [retryToFace, setRetryToFace] = useState(false);
  const [result, setResult] = useState<AttendanceRecord | null>(null);
  const [queuedAt, setQueuedAt] = useState<string | null>(null);

  const [isCapturing, setIsCapturing] = useState(false);

  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const queryClient = useQueryClient();

  const requestAndLocate = useCallback(async () => {
    setStep('locating');
    setFix(null);
    setErrorMsg('');
    setRetryToFace(false);
    setResult(null);
    setQueuedAt(null);

    try {
      setFix(await getFix(10_000));
    } catch {
      // For check-out, GPS is optional per backend schema. Proceed without it.
      setFix(null);
    }
    setStep('ready');
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

  async function handleCapture() {
    if (!cameraRef.current || !userId || isCapturing) return;
    setIsCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
      if (!photo?.uri) return;
      const body: Record<string, unknown> = {};
      if (fix) {
        body.latitude = fix.latitude;
        body.longitude = fix.longitude;
        if (fix.accuracy != null) body.accuracy_m = fix.accuracy;
        if (fix.mocked) body.is_mocked = true;
      }
      // The check-out time is the moment of the photo, even if sending happens later.
      const item = capture('checkout', userId, body);
      setStep('verifying');

      let res;
      try {
        res = await faceApi.verify(userId, photo.uri);
      } catch (e) {
        const status = isAxiosError(e) ? e.response?.status : undefined;
        if (status === 404) {
          setRetryToFace(false);
          setErrorMsg('Wajah belum terdaftar. Silakan daftarkan wajah di halaman Profil terlebih dahulu.');
          setStep('error');
          return;
        }
        if (status === undefined || status >= 500) {
          // No signal: record the check-out now; it is flagged for review.
          await send(item);
          return;
        }
        const msg = errorMessage(e);
        reportAttempt(userId, 'CHECKOUT', 'FACE_ERROR', msg, body);
        setRetryToFace(true);
        setErrorMsg(msg);
        setStep('error');
        return;
      }

      if (!res.verified) {
        reportAttempt(userId, 'CHECKOUT', 'FACE_MISMATCH', `similarity ${res.similarity}`, body);
        setRetryToFace(true);
        setErrorMsg('Wajah tidak dikenali. Pastikan wajah Anda menghadap kamera dan coba lagi.');
        setStep('error');
        return;
      }
      item.body.face_token = res.face_token;
      await send(item);
    } catch (e) {
      setRetryToFace(true);
      setErrorMsg(`Gagal check out: ${errorMessage(e)}`);
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
            {fix
              ? `Lokasi: ${fix.latitude.toFixed(5)}, ${fix.longitude.toFixed(5)}`
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
            <Pressable
              style={styles.shutterBtn}
              onPress={handleCapture}
              disabled={isCapturing}
              accessibilityRole="button"
              accessibilityLabel="Ambil foto"
            >
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

    if (step === 'queued' && queuedAt) {
      return (
        <View style={styles.stateBox}>
          <View style={[styles.iconCircle, { backgroundColor: colors.warningTintStrong }]}>
            <Ionicons name="cloud-upload-outline" size={36} color={colors.warning} />
          </View>
          <Text style={styles.stateTitle}>Check Out Tersimpan di HP</Text>
          <Text style={styles.timeText}>{formatTime(queuedAt, siteTimezone)}</Text>
          <Text style={styles.stateSubtitle}>
            Belum ada sinyal ke server. Jam pulang Anda sudah tercatat dan akan dikirim
            otomatis saat koneksi kembali.
          </Text>
          <Pressable style={styles.doneBtn} onPress={onClose}>
            <Text style={styles.doneBtnText}>Mengerti</Text>
          </Pressable>
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
          {result.needs_review && (
            <Text style={styles.stateSubtitle}>
              Supervisor akan meninjau karena {reviewReason(result.risk_flags)}.
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
