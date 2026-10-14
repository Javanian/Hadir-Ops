import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { isAxiosError } from 'axios';

import OfflineBanner from '../components/OfflineBanner';
import { DatePickerModal, fmtDateShort, getTodayStr } from '../components/DateRangePicker';
import { useCancelLeave, useMyLeave, useSubmitLeave } from '../hooks/useLeave';
import { useAuthState } from '../store/authStore';
import type { LeaveRequest, LeaveStatus, LeaveType } from '../types/leave';
import { showError, showSuccess } from '../utils/toast';
import { colors } from '../theme/colors';

// Same limits as the API (backend/app/services/leave_service.py)
const MAX_DAYS = 30;
const MAX_BACKDATE_DAYS = 7;
const MAX_ADVANCE_DAYS = 90;

const TYPES: Array<{ value: LeaveType; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }> = [
  { value: 'SICK', label: 'Sakit', icon: 'medkit-outline' },
  { value: 'PERMIT', label: 'Izin', icon: 'document-text-outline' },
  { value: 'ANNUAL', label: 'Cuti', icon: 'sunny-outline' },
];

const TYPE_LABEL: Record<LeaveType, string> = { SICK: 'Sakit', PERMIT: 'Izin', ANNUAL: 'Cuti tahunan' };

const STATUS_STYLE: Record<LeaveStatus, { label: string; fg: string; bg: string }> = {
  PENDING: { label: 'Menunggu', fg: colors.warningStrong, bg: colors.warningTintStrong },
  APPROVED: { label: 'Disetujui', fg: colors.successStrong, bg: colors.successTintStrong },
  REJECTED: { label: 'Ditolak', fg: colors.dangerStrong, bg: colors.dangerTintStrong },
  CANCELLED: { label: 'Dibatalkan', fg: colors.textMuted, bg: colors.muted },
};

/** YYYY-MM-DD shifted by whole days (date-only arithmetic in UTC). */
function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function spanDays(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

function rangeLabel(start: string, end: string): string {
  return start === end ? fmtDateShort(start) : `${fmtDateShort(start)} – ${fmtDateShort(end)}`;
}

function apiMessage(err: unknown): string | null {
  if (!isAxiosError(err)) return null;
  const detail = err.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (detail && typeof detail.message === 'string') return detail.message;
  return null;
}

export default function LeaveScreen() {
  const tz = useAuthState().user?.site_timezone ?? 'Asia/Jakarta';
  const today = getTodayStr(tz);

  const [leaveType, setLeaveType] = useState<LeaveType>('SICK');
  const [startDate, setStartDate] = useState<string>(today);
  const [endDate, setEndDate] = useState<string>(today);
  const [reason, setReason] = useState('');
  const [picker, setPicker] = useState<'start' | 'end' | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const { data = [], isLoading, isError, refetch, isRefetching } = useMyLeave();
  const submit = useSubmitLeave();
  const cancel = useCancelLeave();

  const minStart = addDays(today, -MAX_BACKDATE_DAYS);
  const maxStart = addDays(today, MAX_ADVANCE_DAYS);
  const days = spanDays(startDate, endDate);
  const pendingCount = useMemo(() => data.filter((r) => r.status === 'PENDING').length, [data]);

  function onPickDate(d: string) {
    if (d === '__clear__') {
      setPicker(null);
      return;
    }
    if (picker === 'start') {
      setStartDate(d);
      if (endDate < d) setEndDate(d);
    } else if (picker === 'end') {
      setEndDate(d);
    }
    setFormError(null);
    setPicker(null);
  }

  async function onSubmit() {
    const text = reason.trim();
    if (!text) return setFormError('Tulis alasan singkat, misalnya "demam, ada surat dokter".');
    if (endDate < startDate) return setFormError('Tanggal selesai tidak boleh sebelum tanggal mulai.');
    if (days > MAX_DAYS) return setFormError(`Satu pengajuan maksimal ${MAX_DAYS} hari.`);
    setFormError(null);
    try {
      await submit.mutateAsync({ leave_type: leaveType, start_date: startDate, end_date: endDate, reason: text });
      showSuccess('Atasan Anda akan meninjau pengajuan ini.', 'Pengajuan terkirim');
      setReason('');
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 409) {
        setFormError('Tanggal ini bertabrakan dengan pengajuan lain yang masih aktif.');
      } else if (isAxiosError(err) && err.response?.status === 422) {
        setFormError(apiMessage(err) ?? 'Data pengajuan tidak valid.');
      } else if (!isAxiosError(err) || err.response) {
        setFormError(apiMessage(err) ?? 'Pengajuan gagal dikirim. Coba lagi.');
      }
      // Network errors already show a toast from the API client.
    }
  }

  function onCancel(item: LeaveRequest) {
    Alert.alert(
      'Batalkan pengajuan?',
      `${TYPE_LABEL[item.leave_type]}, ${rangeLabel(item.start_date, item.end_date)}`,
      [
        { text: 'Tidak', style: 'cancel' },
        {
          text: 'Batalkan',
          style: 'destructive',
          onPress: () =>
            cancel.mutate(item.id, {
              onSuccess: () => showSuccess('Pengajuan dibatalkan'),
              onError: (err) => showError(apiMessage(err) ?? 'Gagal membatalkan pengajuan'),
            }),
        },
      ],
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle} accessibilityRole="header">{'Izin & Cuti'}</Text>
        {pendingCount > 0 && (
          <View style={styles.headerBadge}>
            <Text style={styles.headerBadgeText}>{pendingCount} menunggu</Text>
          </View>
        )}
      </View>
      <OfflineBanner />

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.action} />}
      >
        {/* ── Form ── */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Ajukan baru</Text>

          <Text style={styles.label}>Jenis</Text>
          <View style={styles.typeRow} accessibilityRole="radiogroup">
            {TYPES.map((t) => {
              const active = leaveType === t.value;
              return (
                <Pressable
                  key={t.value}
                  onPress={() => setLeaveType(t.value)}
                  style={[styles.typeChip, active && styles.typeChipActive]}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                >
                  <Ionicons name={t.icon} size={18} color={active ? colors.action : colors.textMuted} />
                  <Text style={[styles.typeText, active && styles.typeTextActive]}>{t.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.dateRow}>
            <View style={styles.dateCol}>
              <Text style={styles.label}>Mulai</Text>
              <Pressable style={styles.dateBtn} onPress={() => setPicker('start')} accessibilityLabel={`Tanggal mulai ${fmtDateShort(startDate)}`}>
                <Ionicons name="calendar-outline" size={16} color={colors.action} />
                <Text style={styles.dateText}>{fmtDateShort(startDate)}</Text>
              </Pressable>
            </View>
            <View style={styles.dateCol}>
              <Text style={styles.label}>Selesai</Text>
              <Pressable style={styles.dateBtn} onPress={() => setPicker('end')} accessibilityLabel={`Tanggal selesai ${fmtDateShort(endDate)}`}>
                <Ionicons name="calendar-outline" size={16} color={colors.action} />
                <Text style={styles.dateText}>{fmtDateShort(endDate)}</Text>
              </Pressable>
            </View>
          </View>
          <Text style={[styles.hint, days > MAX_DAYS && styles.hintError]}>
            {days} hari{days > MAX_DAYS ? ` — maksimal ${MAX_DAYS} hari` : ''}
          </Text>

          <Text style={styles.label}>Alasan</Text>
          <TextInput
            value={reason}
            onChangeText={(v) => { setReason(v); setFormError(null); }}
            placeholder="Contoh: demam, ada surat dokter"
            placeholderTextColor={colors.textSubtle}
            multiline
            maxLength={500}
            style={styles.input}
            accessibilityLabel="Alasan"
          />

          {formError && (
            <View style={styles.errorBox} accessibilityLiveRegion="polite">
              <Ionicons name="alert-circle" size={16} color={colors.danger} />
              <Text style={styles.errorText}>{formError}</Text>
            </View>
          )}

          <Pressable
            style={({ pressed }) => [styles.submitBtn, pressed && styles.submitBtnPressed, submit.isPending && styles.submitBtnDisabled]}
            onPress={onSubmit}
            disabled={submit.isPending}
            accessibilityRole="button"
          >
            {submit.isPending
              ? <ActivityIndicator color={colors.white} />
              : <Text style={styles.submitText}>Kirim pengajuan</Text>}
          </Pressable>
        </View>

        {/* ── History ── */}
        <Text style={styles.listTitle}>Pengajuan saya</Text>
        {isLoading ? (
          <ActivityIndicator style={styles.spinner} color={colors.action} />
        ) : isError ? (
          <Pressable style={styles.emptyBox} onPress={() => refetch()}>
            <Ionicons name="cloud-offline-outline" size={28} color={colors.textSubtle} />
            <Text style={styles.emptyText}>Gagal memuat. Ketuk untuk mencoba lagi.</Text>
          </Pressable>
        ) : data.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="calendar-clear-outline" size={28} color={colors.textSubtle} />
            <Text style={styles.emptyText}>Belum ada pengajuan izin atau cuti.</Text>
          </View>
        ) : (
          data.map((item) => {
            const st = STATUS_STYLE[item.status];
            return (
              <View key={item.id} style={styles.item}>
                <View style={styles.itemTop}>
                  <Text style={styles.itemType}>{TYPE_LABEL[item.leave_type]}</Text>
                  <View style={[styles.statusPill, { backgroundColor: st.bg }]}>
                    <Text style={[styles.statusText, { color: st.fg }]}>{st.label}</Text>
                  </View>
                </View>
                <Text style={styles.itemRange}>
                  {rangeLabel(item.start_date, item.end_date)} · {item.days} hari
                </Text>
                <Text style={styles.itemReason} numberOfLines={3}>{item.reason}</Text>
                {item.review_note && (
                  <Text style={styles.itemNote}>
                    {item.reviewer_name ? `${item.reviewer_name}: ` : ''}“{item.review_note}”
                  </Text>
                )}
                {item.status === 'PENDING' && (
                  <Pressable
                    style={styles.cancelBtn}
                    onPress={() => onCancel(item)}
                    disabled={cancel.isPending}
                    accessibilityRole="button"
                  >
                    <Text style={styles.cancelText}>Batalkan</Text>
                  </Pressable>
                )}
              </View>
            );
          })
        )}
      </ScrollView>

      <DatePickerModal
        visible={picker !== null}
        title={picker === 'start' ? 'Tanggal mulai' : 'Tanggal selesai'}
        selected={picker === 'start' ? startDate : endDate}
        todayStr={today}
        onSelect={onPickDate}
        onClose={() => setPicker(null)}
        minDate={picker === 'start' ? minStart : startDate}
        maxDate={picker === 'start' ? maxStart : addDays(startDate, MAX_DAYS - 1)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.muted },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.action,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: colors.white },
  headerBadge: { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  headerBadgeText: { color: colors.white, fontSize: 12, fontWeight: '600' },

  content: { padding: 16, paddingBottom: 32 },

  card: {
    backgroundColor: colors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.ink, marginBottom: 8 },
  label: { fontSize: 13, fontWeight: '600', color: colors.text, marginTop: 12, marginBottom: 6 },

  typeRow: { flexDirection: 'row', gap: 8 },
  typeChip: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.canvas,
  },
  typeChipActive: { borderColor: colors.action, backgroundColor: colors.actionTint },
  typeText: { fontSize: 14, fontWeight: '600', color: colors.textMuted },
  typeTextActive: { color: colors.action },

  dateRow: { flexDirection: 'row', gap: 12 },
  dateCol: { flex: 1 },
  dateBtn: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
  },
  dateText: { fontSize: 14, color: colors.ink, fontWeight: '500' },
  hint: { fontSize: 12, color: colors.textMuted, marginTop: 6 },
  hintError: { color: colors.danger, fontWeight: '600' },

  input: {
    minHeight: 88,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.ink,
    textAlignVertical: 'top',
  },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 12,
    padding: 10,
    borderRadius: 10,
    backgroundColor: colors.dangerTint,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
  },
  errorText: { flex: 1, fontSize: 13, color: colors.dangerStrong },

  submitBtn: {
    marginTop: 16,
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: colors.action,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnPressed: { backgroundColor: colors.actionPressed },
  submitBtnDisabled: { opacity: 0.7 },
  submitText: { color: colors.white, fontSize: 15, fontWeight: '700' },

  listTitle: { fontSize: 15, fontWeight: '700', color: colors.ink, marginTop: 24, marginBottom: 10 },
  spinner: { marginTop: 24 },
  emptyBox: { alignItems: 'center', gap: 8, paddingVertical: 32 },
  emptyText: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },

  item: {
    backgroundColor: colors.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 10,
  },
  itemTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  itemType: { fontSize: 15, fontWeight: '700', color: colors.ink },
  statusPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  statusText: { fontSize: 12, fontWeight: '700' },
  itemRange: { fontSize: 13, color: colors.text, marginTop: 4 },
  itemReason: { fontSize: 13, color: colors.textMuted, marginTop: 6 },
  itemNote: { fontSize: 13, color: colors.text, marginTop: 8, fontStyle: 'italic' },
  cancelBtn: {
    alignSelf: 'flex-start',
    marginTop: 10,
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
  },
  cancelText: { color: colors.danger, fontSize: 13, fontWeight: '700' },
});
