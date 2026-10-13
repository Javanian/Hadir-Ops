import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { isAxiosError } from 'axios';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';

import { useMe } from '../hooks/useAuth';
import {
  useApproveOvertime,
  useMyOvertimes,
  useRejectOvertime,
  useSubmitOvertime,
  useTeamOvertimes,
} from '../hooks/useOvertime';
import OfflineBanner from '../components/OfflineBanner';
import { Calendar, DatePickerModal, fmtDateShort, getTodayStr } from '../components/DateRangePicker';
import type { OvertimeRequest } from '../types/overtime';
import type { MainTabParamList } from '../navigation/MainNavigator';
import { colors } from '../theme/colors'

// ── Date / Time Helpers ───────────────────────────────────────────────────────

function fmtDateSv(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: tz }).format(new Date(iso));
}

function fmtTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso));
}

function fmtDate(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: tz, day: '2-digit', month: 'short', year: 'numeric',
  }).format(new Date(iso));
}

function fmtTimeRange(startIso: string, endIso: string, tz: string): string {
  const cross = fmtDateSv(startIso, tz) !== fmtDateSv(endIso, tz);
  if (cross) {
    return `${fmtTime(startIso, tz)} — ${fmtDate(endIso, tz)} ${fmtTime(endIso, tz)}`;
  }
  return `${fmtTime(startIso, tz)} — ${fmtTime(endIso, tz)}`;
}

function isCrossMidnight(startIso: string, endIso: string, tz: string): boolean {
  return fmtDateSv(startIso, tz) !== fmtDateSv(endIso, tz);
}

function durationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} menit`;
  if (m === 0) return `${h} jam`;
  return `${h} jam ${m} menit`;
}

function localToUtcIso(dateStr: string, h: number, m: number, tz: string): string {
  const parts2 = dateStr.split('-').map(Number);
  const [y, mo, d] = [parts2[0]!, parts2[1]!, parts2[2]!];
  const probe = new Date(Date.UTC(y, mo - 1, d, h, m, 0));
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(probe);
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10);
  const probeLocal = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  const target = Date.UTC(y, mo - 1, d, h, m, 0);
  return new Date(probe.getTime() + (target - probeLocal)).toISOString();
}

function addDays(dateStr: string, n: number): string {
  const p = dateStr.split('-').map(Number);
  const [y, m, d] = [p[0]!, p[1]!, p[2]!];
  const date = new Date(Date.UTC(y, m - 1, d + n));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

// ── Status Helpers ────────────────────────────────────────────────────────────

function statusColor(s: OvertimeRequest['status']): string {
  switch (s) {
    case 'APPROVED': return colors.success;
    case 'REJECTED': return colors.danger;
    default:         return colors.warning;
  }
}

function statusLabel(s: OvertimeRequest['status']): string {
  switch (s) {
    case 'APPROVED': return 'Disetujui';
    case 'REJECTED': return 'Ditolak';
    default:         return 'Menunggu';
  }
}

// ── TimeStepper ───────────────────────────────────────────────────────────────

function TimeStepper({
  hour, minute, onHour, onMin,
}: { hour: number; minute: number; onHour: (h: number) => void; onMin: (m: number) => void }) {
  return (
    <View style={styles.timeStepper}>
      <View style={styles.stepperUnit}>
        <TouchableOpacity style={styles.stepperBtn} onPress={() => onHour((hour + 1) % 24)}>
          <Ionicons name="chevron-up" size={22} color={colors.action} />
        </TouchableOpacity>
        <View style={styles.stepperValueBox}>
          <Text style={styles.stepperValue}>{String(hour).padStart(2, '0')}</Text>
        </View>
        <TouchableOpacity style={styles.stepperBtn} onPress={() => onHour((hour - 1 + 24) % 24)}>
          <Ionicons name="chevron-down" size={22} color={colors.action} />
        </TouchableOpacity>
        <Text style={styles.stepperUnitLabel}>Jam</Text>
      </View>

      <Text style={styles.stepperColon}>:</Text>

      <View style={styles.stepperUnit}>
        <TouchableOpacity style={styles.stepperBtn} onPress={() => onMin((minute + 5) % 60)}>
          <Ionicons name="chevron-up" size={22} color={colors.action} />
        </TouchableOpacity>
        <View style={styles.stepperValueBox}>
          <Text style={styles.stepperValue}>{String(minute).padStart(2, '0')}</Text>
        </View>
        <TouchableOpacity style={styles.stepperBtn} onPress={() => onMin(minute < 5 ? 55 : minute - 5)}>
          <Ionicons name="chevron-down" size={22} color={colors.action} />
        </TouchableOpacity>
        <Text style={styles.stepperUnitLabel}>Menit</Text>
      </View>
    </View>
  );
}

// ── SubmitModal ───────────────────────────────────────────────────────────────

function SubmitModal({ visible, onClose, tz }: { visible: boolean; onClose: () => void; tz: string }) {
  const submit = useSubmitOvertime();

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [startH, setStartH] = useState(17);
  const [startM, setStartM] = useState(0);
  const [endH, setEndH] = useState(20);
  const [endM, setEndM] = useState(0);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (visible) {
      setSelectedDate(null);
      setStartH(17);
      setStartM(0);
      setEndH(20);
      setEndM(0);
      setNotes('');
      setError('');
    }
  }, [visible]);

  const todayStr = getTodayStr(tz);

  const endDateStr = selectedDate
    ? (endH < startH || (endH === startH && endM <= startM) ? addDays(selectedDate, 1) : selectedDate)
    : null;

  const crossMidnight = endDateStr !== null && selectedDate !== null && endDateStr !== selectedDate;

  const startUtc = selectedDate ? localToUtcIso(selectedDate, startH, startM, tz) : null;
  const endUtc = endDateStr ? localToUtcIso(endDateStr, endH, endM, tz) : null;

  async function handleSubmit() {
    if (!selectedDate || !startUtc || !endUtc) {
      setError('Pilih tanggal lembur terlebih dahulu.');
      return;
    }
    if (new Date(endUtc) <= new Date(startUtc)) {
      setError('Waktu selesai harus setelah waktu mulai.');
      return;
    }
    setError('');
    try {
      await submit.mutateAsync({
        requested_start: startUtc,
        requested_end: endUtc,
        notes: notes.trim() || undefined,
      });
      onClose();
    } catch (e) {
      setError(
        isAxiosError(e)
          ? (e.response?.data as { detail?: string })?.detail ?? 'Gagal mengajukan lembur.'
          : 'Gagal mengajukan lembur.',
      );
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.modalSafe} edges={['top', 'bottom']}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Ajukan Lembur</Text>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
          <Text style={styles.sectionTitle}>Pilih Tanggal Lembur</Text>
          <Text style={styles.sectionHint}>Hanya hari ini dan tanggal mendatang yang dapat dipilih.</Text>
          <View style={styles.calendarBox}>
            <Calendar todayStr={todayStr} selected={selectedDate} onSelect={setSelectedDate} disablePast />
          </View>

          {selectedDate ? (
            <>
              <View style={styles.selectedDateBadge}>
                <Ionicons name="calendar-outline" size={15} color={colors.action} />
                <Text style={styles.selectedDateText}>
                  {new Intl.DateTimeFormat('id-ID', {
                    day: 'numeric', month: 'long', year: 'numeric',
                  }).format(new Date(`${selectedDate}T12:00:00Z`))}
                </Text>
              </View>

              <Text style={styles.label}>Jam Mulai Lembur</Text>
              <TimeStepper hour={startH} minute={startM} onHour={setStartH} onMin={setStartM} />

              <Text style={styles.label}>Jam Selesai Lembur</Text>
              <TimeStepper hour={endH} minute={endM} onHour={setEndH} onMin={setEndM} />

              {crossMidnight ? (
                <View style={styles.crossMidnightWarn}>
                  <Ionicons name="moon-outline" size={16} color={colors.overtime} />
                  <Text style={styles.crossMidnightText}>
                    Lembur melewati tengah malam — selesai pada hari berikutnya.
                  </Text>
                </View>
              ) : null}

              <Text style={styles.label}>Catatan (opsional)</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={notes}
                onChangeText={setNotes}
                placeholder="Alasan atau keterangan lembur..."
                placeholderTextColor={colors.textSubtle}
                multiline
                numberOfLines={3}
                maxLength={500}
              />
            </>
          ) : (
            <View style={styles.noDateHint}>
              <Ionicons name="hand-left-outline" size={32} color={colors.borderStrong} />
              <Text style={styles.noDateHintText}>Pilih tanggal di atas untuk melanjutkan.</Text>
            </View>
          )}

          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </ScrollView>

        <View style={styles.modalFooter}>
          <TouchableOpacity
            style={[
              styles.submitBtn,
              (!selectedDate || submit.isPending) && styles.submitBtnDisabled,
            ]}
            onPress={handleSubmit}
            disabled={!selectedDate || submit.isPending}
          >
            {submit.isPending
              ? <ActivityIndicator color={colors.white} />
              : <Text style={styles.submitBtnText}>Kirim Pengajuan</Text>}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

// ── ApproveModal ──────────────────────────────────────────────────────────────

function ApproveModal({ item, tz, onClose }: { item: OvertimeRequest | null; tz: string; onClose: () => void }) {
  const approve = useApproveOvertime();
  const [supervisorNotes, setSupervisorNotes] = useState('');
  const [overrideEnabled, setOverrideEnabled] = useState(false);
  const [oStartH, setOStartH] = useState(0);
  const [oStartM, setOStartM] = useState(0);
  const [oEndH, setOEndH] = useState(0);
  const [oEndM, setOEndM] = useState(0);
  const [error, setError] = useState('');

  function getHourInTz(iso: string): number {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hour12: false }).formatToParts(new Date(iso));
    const h = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
    return h === 24 ? 0 : h;
  }
  function getMinInTz(iso: string): number {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, minute: '2-digit' }).formatToParts(new Date(iso));
    return parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  }

  useEffect(() => {
    setSupervisorNotes('');
    setOverrideEnabled(false);
    setError('');
    if (!item) return;
    setOStartH(getHourInTz(item.requested_start));
    setOStartM(Math.round(getMinInTz(item.requested_start) / 5) * 5 % 60);
    setOEndH(getHourInTz(item.requested_end));
    setOEndM(Math.round(getMinInTz(item.requested_end) / 5) * 5 % 60);
  }, [item?.id]);

  async function handleApprove() {
    if (!item) return;
    const body: Parameters<typeof approve.mutateAsync>[0]['body'] = {};
    if (supervisorNotes.trim()) body.supervisor_notes = supervisorNotes.trim();
    if (overrideEnabled) {
      const baseDateStr = fmtDateSv(item.requested_start, tz);
      const endDateStr = (oEndH < oStartH || (oEndH === oStartH && oEndM <= oStartM))
        ? addDays(baseDateStr, 1)
        : baseDateStr;
      const s = localToUtcIso(baseDateStr, oStartH, oStartM, tz);
      const e = localToUtcIso(endDateStr, oEndH, oEndM, tz);
      if (new Date(e) <= new Date(s)) {
        setError('Waktu selesai harus setelah waktu mulai.');
        return;
      }
      body.approved_start = s;
      body.approved_end = e;
    }
    setError('');
    try {
      await approve.mutateAsync({ id: item.id, body });
      onClose();
    } catch (e) {
      setError(
        isAxiosError(e)
          ? (e.response?.data as { detail?: string })?.detail ?? 'Gagal menyetujui.'
          : 'Gagal menyetujui.',
      );
    }
  }

  if (!item) return null;
  const cross = isCrossMidnight(item.requested_start, item.requested_end, tz);

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.modalSafe} edges={['top', 'bottom']}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Setujui Lembur</Text>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
          {item.employee_name ? (
            <View style={styles.employeeBadge}>
              <View style={styles.employeeAvatar}>
                <Text style={styles.employeeAvatarText}>{item.employee_name.charAt(0).toUpperCase()}</Text>
              </View>
              <View>
                <Text style={styles.employeeName}>{item.employee_name}</Text>
                {item.employee_id ? <Text style={styles.employeeId}>{item.employee_id}</Text> : null}
              </View>
            </View>
          ) : null}

          <Text style={styles.label}>Waktu Diajukan</Text>
          <View style={styles.infoBox}>
            <Text style={styles.infoDate}>{fmtDate(item.requested_start, tz)}</Text>
            <Text style={styles.infoTime}>{fmtTimeRange(item.requested_start, item.requested_end, tz)}</Text>
            {cross ? (
              <View style={styles.crossMidnightWarn}>
                <Ionicons name="moon-outline" size={13} color={colors.overtime} />
                <Text style={[styles.crossMidnightText, { fontSize: 12 }]}>Lintas tengah malam</Text>
              </View>
            ) : null}
            <Text style={styles.infoDuration}>{durationLabel(item.requested_minutes)}</Text>
          </View>

          <TouchableOpacity style={styles.overrideToggle} onPress={() => setOverrideEnabled(!overrideEnabled)}>
            <Ionicons name={overrideEnabled ? 'checkbox' : 'square-outline'} size={22} color={colors.action} />
            <Text style={styles.overrideToggleText}>Ubah jam lembur yang disetujui</Text>
          </TouchableOpacity>

          {overrideEnabled ? (
            <>
              <Text style={styles.label}>Jam Mulai yang Disetujui</Text>
              <TimeStepper hour={oStartH} minute={oStartM} onHour={setOStartH} onMin={setOStartM} />
              <Text style={styles.label}>Jam Selesai yang Disetujui</Text>
              <TimeStepper hour={oEndH} minute={oEndM} onHour={setOEndH} onMin={setOEndM} />
            </>
          ) : null}

          {item.notes ? (
            <View style={styles.infoBox}>
              <Text style={[styles.infoDate, { marginBottom: 0 }]}>Catatan pengaju:</Text>
              <Text style={[styles.infoTime, { fontSize: 13, fontWeight: '400', color: colors.text }]}>{item.notes}</Text>
            </View>
          ) : null}

          <Text style={styles.label}>Catatan untuk pengaju (opsional)</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={supervisorNotes}
            onChangeText={setSupervisorNotes}
            placeholder="Tambahkan catatan untuk karyawan..."
            placeholderTextColor={colors.textSubtle}
            multiline
            numberOfLines={3}
          />

          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </ScrollView>

        <View style={styles.modalFooter}>
          <TouchableOpacity
            style={[styles.submitBtn, approve.isPending && styles.submitBtnDisabled]}
            onPress={handleApprove}
            disabled={approve.isPending}
          >
            {approve.isPending
              ? <ActivityIndicator color={colors.white} />
              : <Text style={styles.submitBtnText}>Setujui</Text>}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

// ── RejectModal ───────────────────────────────────────────────────────────────

function RejectModal({ item, onClose }: { item: OvertimeRequest | null; onClose: () => void }) {
  const reject = useRejectOvertime();
  const [supervisorNotes, setSupervisorNotes] = useState('');
  const [error, setError] = useState('');

  function handleClose() { setSupervisorNotes(''); setError(''); onClose(); }

  async function handleReject() {
    if (!item) return;
    setError('');
    try {
      await reject.mutateAsync({ id: item.id, body: supervisorNotes.trim() ? { supervisor_notes: supervisorNotes.trim() } : {} });
      handleClose();
    } catch (e) {
      setError(
        isAxiosError(e)
          ? (e.response?.data as { detail?: string })?.detail ?? 'Gagal menolak.'
          : 'Gagal menolak.',
      );
    }
  }

  if (!item) return null;

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <SafeAreaView style={styles.modalSafe} edges={['top', 'bottom']}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Tolak Lembur</Text>
          <TouchableOpacity onPress={handleClose}>
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
          {item.employee_name ? (
            <View style={styles.employeeBadge}>
              <View style={styles.employeeAvatar}>
                <Text style={styles.employeeAvatarText}>{item.employee_name.charAt(0).toUpperCase()}</Text>
              </View>
              <View>
                <Text style={styles.employeeName}>{item.employee_name}</Text>
                {item.employee_id ? <Text style={styles.employeeId}>{item.employee_id}</Text> : null}
              </View>
            </View>
          ) : null}

          <Text style={styles.label}>Catatan Penolakan (opsional)</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={supervisorNotes}
            onChangeText={setSupervisorNotes}
            placeholder="Alasan penolakan..."
            placeholderTextColor={colors.textSubtle}
            multiline
            numberOfLines={4}
          />
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </ScrollView>

        <View style={styles.modalFooter}>
          <TouchableOpacity
            style={[styles.submitBtn, styles.rejectBtnFull, reject.isPending && styles.submitBtnDisabled]}
            onPress={handleReject}
            disabled={reject.isPending}
          >
            {reject.isPending
              ? <ActivityIndicator color={colors.white} />
              : <Text style={styles.submitBtnText}>Tolak Pengajuan</Text>}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

// ── CheckinStatusBanner ───────────────────────────────────────────────────────

function CheckinStatusBanner({ item, tz }: { item: OvertimeRequest; tz: string }) {
  if (item.status === 'PENDING') {
    return (
      <View style={[styles.checkinBanner, { backgroundColor: colors.warningTint }]}>
        <Ionicons name="hourglass-outline" size={13} color={colors.warningStrong} />
        <Text style={[styles.checkinBannerText, { color: colors.warningStrong }]}>
          Menunggu persetujuan atasan — belum dapat memulai lembur
        </Text>
      </View>
    );
  }
  if (item.status === 'REJECTED') {
    return (
      <View style={[styles.checkinBanner, { backgroundColor: colors.dangerTint }]}>
        <Ionicons name="close-circle-outline" size={13} color={colors.dangerStrong} />
        <Text style={[styles.checkinBannerText, { color: colors.dangerStrong }]}>
          Pengajuan ditolak — tidak dapat memulai lembur
        </Text>
      </View>
    );
  }
  const now = new Date();
  const start = new Date(item.requested_start);
  const end = new Date(item.requested_end);
  if (now < start) {
    return (
      <View style={[styles.checkinBanner, { backgroundColor: colors.actionTint }]}>
        <Ionicons name="time-outline" size={13} color={colors.actionPressed} />
        <Text style={[styles.checkinBannerText, { color: colors.actionPressed }]}>
          Disetujui · Dapat dimulai: {fmtTime(item.requested_start, tz)}
        </Text>
      </View>
    );
  }
  if (now <= end) {
    return (
      <View style={[styles.checkinBanner, { backgroundColor: colors.successTint }]}>
        <Ionicons name="radio-button-on-outline" size={13} color={colors.successStrong} />
        <Text style={[styles.checkinBannerText, { color: colors.successStrong }]}>
          Sedang berlangsung · Berakhir: {fmtTime(item.requested_end, tz)}
        </Text>
      </View>
    );
  }
  return (
    <View style={[styles.checkinBanner, { backgroundColor: colors.canvas }]}>
      <Ionicons name="checkmark-circle-outline" size={13} color={colors.textMuted} />
      <Text style={[styles.checkinBannerText, { color: colors.textMuted }]}>Lembur telah selesai</Text>
    </View>
  );
}

// ── OvertimeItem ──────────────────────────────────────────────────────────────

function OvertimeItem({
  item, tz, showActions, onApprove, onReject,
}: {
  item: OvertimeRequest;
  tz: string;
  showActions: boolean;
  onApprove: (i: OvertimeRequest) => void;
  onReject: (i: OvertimeRequest) => void;
}) {
  const cross = isCrossMidnight(item.requested_start, item.requested_end, tz);
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardDate}>{fmtDate(item.requested_start, tz)}</Text>
        <View style={[styles.badge, { backgroundColor: statusColor(item.status) }]}>
          <Text style={styles.badgeText}>{statusLabel(item.status)}</Text>
        </View>
      </View>

      <View style={styles.cardRow}>
        <Ionicons name="time-outline" size={15} color={colors.textMuted} />
        <Text style={styles.cardMeta}>
          {fmtTimeRange(item.requested_start, item.requested_end, tz)}
          {cross ? <Text style={styles.crossLabel}> (lintas tengah malam)</Text> : null}
        </Text>
      </View>

      <View style={styles.cardRow}>
        <Ionicons name="hourglass-outline" size={15} color={colors.textMuted} />
        <Text style={styles.cardMeta}>{durationLabel(item.requested_minutes)}</Text>
      </View>

      {item.notes ? (
        <View style={styles.cardRow}>
          <Ionicons name="chatbubble-outline" size={15} color={colors.textMuted} />
          <Text style={[styles.cardMeta, { flex: 1 }]}>
            <Text style={{ fontWeight: '600' }}>Catatan: </Text>{item.notes}
          </Text>
        </View>
      ) : null}
      {item.supervisor_notes ? (
        <View style={styles.cardRow}>
          <Ionicons name="chatbubble-ellipses-outline" size={15} color={colors.action} />
          <Text style={[styles.cardMeta, { flex: 1, color: colors.actionPressed }]}>
            <Text style={{ fontWeight: '600' }}>Atasan: </Text>{item.supervisor_notes}
          </Text>
        </View>
      ) : null}

      <CheckinStatusBanner item={item} tz={tz} />

      {showActions && item.status === 'PENDING' ? (
        <View style={styles.actionRow}>
          <TouchableOpacity style={[styles.actionBtn, styles.rejectBtn]} onPress={() => onReject(item)}>
            <Text style={styles.actionBtnText}>Tolak</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, styles.approveBtn]} onPress={() => onApprove(item)}>
            <Text style={styles.actionBtnText}>Setujui</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

// ── FilterBar ─────────────────────────────────────────────────────────────────

type StatusFilter = 'PENDING' | 'APPROVED' | 'REJECTED' | undefined;

const STATUS_CHIPS: { label: string; value: StatusFilter }[] = [
  { label: 'Semua', value: undefined },
  { label: 'Menunggu', value: 'PENDING' },
  { label: 'Disetujui', value: 'APPROVED' },
  { label: 'Ditolak', value: 'REJECTED' },
];

interface FilterBarProps {
  statusFilter: StatusFilter;
  onStatusChange: (v: StatusFilter) => void;
  fromDate: string | null;
  toDate: string | null;
  onFromDate: (d: string | null) => void;
  onToDate: (d: string | null) => void;
  tz: string;
}

function FilterBar({
  statusFilter, onStatusChange,
  fromDate, toDate, onFromDate, onToDate,
  tz,
}: FilterBarProps) {
  const [showFrom, setShowFrom] = useState(false);
  const [showTo, setShowTo] = useState(false);
  const todayStr = getTodayStr(tz);
  const hasDateFilter = fromDate !== null || toDate !== null;

  return (
    <View style={fb.container}>
      {/* Status chips — full width, evenly distributed */}
      <View style={fb.chipsRow}>
        {STATUS_CHIPS.map((c) => (
          <TouchableOpacity
            key={c.label}
            style={[fb.chip, statusFilter === c.value && fb.chipActive]}
            onPress={() => onStatusChange(c.value)}
          >
            <Text style={[fb.chipText, statusFilter === c.value && fb.chipTextActive]}>{c.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Date range row — full width, each button takes equal half */}
      <View style={fb.dateRow}>
        <Ionicons name="calendar-outline" size={14} color={colors.textMuted} style={{ marginRight: 8 }} />

        <TouchableOpacity
          style={[fb.dateBtn, fromDate && fb.dateBtnActive]}
          onPress={() => setShowFrom(true)}
        >
          <Ionicons
            name="arrow-forward-outline"
            size={12}
            color={fromDate ? colors.action : colors.textSubtle}
            style={{ marginRight: 4 }}
          />
          <Text style={[fb.dateBtnText, fromDate && fb.dateBtnTextActive]} numberOfLines={1}>
            {fromDate ? fmtDateShort(fromDate) : 'Dari tanggal'}
          </Text>
        </TouchableOpacity>

        <Text style={fb.dateSep}>–</Text>

        <TouchableOpacity
          style={[fb.dateBtn, toDate && fb.dateBtnActive]}
          onPress={() => setShowTo(true)}
        >
          <Ionicons
            name="arrow-back-outline"
            size={12}
            color={toDate ? colors.action : colors.textSubtle}
            style={{ marginRight: 4 }}
          />
          <Text style={[fb.dateBtnText, toDate && fb.dateBtnTextActive]} numberOfLines={1}>
            {toDate ? fmtDateShort(toDate) : 'Sampai tanggal'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => { onFromDate(null); onToDate(null); }}
          style={[fb.clearBtn, !hasDateFilter && fb.clearBtnHidden]}
          disabled={!hasDateFilter}
        >
          <Ionicons name="close-circle" size={18} color={colors.textSubtle} />
        </TouchableOpacity>
      </View>

      {/* Date picker modals */}
      <DatePickerModal
        visible={showFrom}
        title="Dari Tanggal"
        selected={fromDate}
        todayStr={todayStr}
        onSelect={(d) => {
          if (d === '__clear__') { onFromDate(null); }
          else { onFromDate(d); if (toDate && d > toDate) onToDate(null); }
          setShowFrom(false);
        }}
        onClose={() => setShowFrom(false)}
        maxDate={toDate}
      />
      <DatePickerModal
        visible={showTo}
        title="Sampai Tanggal"
        selected={toDate}
        todayStr={todayStr}
        onSelect={(d) => {
          if (d === '__clear__') { onToDate(null); }
          else { onToDate(d); if (fromDate && d < fromDate) onFromDate(null); }
          setShowTo(false);
        }}
        onClose={() => setShowTo(false)}
        minDate={fromDate}
      />
    </View>
  );
}

const fb = StyleSheet.create({
  container: {
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: 10,
  },
  chipsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
    gap: 8,
  },
  chip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: colors.muted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.actionTint, borderColor: colors.action },
  chipText: { fontSize: 13, color: colors.textMuted },
  chipTextActive: { color: colors.action, fontWeight: '600' },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  dateBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.muted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dateBtnActive: { backgroundColor: colors.actionTint, borderColor: colors.action },
  dateBtnText: { fontSize: 12, color: colors.textMuted, flexShrink: 1 },
  dateBtnTextActive: { color: colors.action, fontWeight: '600' },
  dateSep: { marginHorizontal: 6, color: colors.textSubtle, fontSize: 13 },
  clearBtn: { marginLeft: 8 },
  clearBtnHidden: { opacity: 0 },
});

// ── UserGroupHeader ───────────────────────────────────────────────────────────

interface UserGroupHeaderProps {
  name: string;
  employeeId: string | null;
  totalCount: number;
  pendingCount: number;
  totalMinutes: number;
  expanded: boolean;
  onToggle: () => void;
}

function UserGroupHeader({ name, employeeId, totalCount, pendingCount, totalMinutes, expanded, onToggle }: UserGroupHeaderProps) {
  const initial = name ? name.charAt(0).toUpperCase() : '?';
  const hasPending = pendingCount > 0;
  const totalHours = (totalMinutes / 60).toFixed(1);

  return (
    <TouchableOpacity
      style={[ugh.container, hasPending && ugh.containerPending]}
      onPress={onToggle}
      activeOpacity={0.7}
    >
      {/* Avatar */}
      <View style={[ugh.avatar, hasPending && ugh.avatarPending]}>
        <Text style={ugh.avatarText}>{initial}</Text>
      </View>

      {/* Name + meta */}
      <View style={ugh.info}>
        <View style={ugh.nameRow}>
          <Text style={ugh.name} numberOfLines={1}>{name}</Text>
          {hasPending ? (
            <Ionicons name="warning" size={14} color={colors.warning} style={{ marginLeft: 5 }} />
          ) : null}
        </View>
        <Text style={ugh.meta}>
          {employeeId ? `${employeeId} · ` : ''}
          {totalCount} pengajuan · {totalHours} jam
        </Text>
      </View>

      {/* Pending badge */}
      {hasPending ? (
        <View style={ugh.pendingBadge}>
          <Ionicons name="time-outline" size={11} color={colors.white} style={{ marginRight: 3 }} />
          <Text style={ugh.pendingBadgeText}>{pendingCount} belum</Text>
        </View>
      ) : null}

      <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} style={{ marginLeft: 6 }} />
    </TouchableOpacity>
  );
}

const ugh = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.actionTint,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  containerPending: {
    backgroundColor: colors.warningTint,
    borderBottomColor: colors.warningBorder,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.action,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarPending: { backgroundColor: colors.warning },
  avatarText: { fontSize: 15, fontWeight: '700', color: colors.white },
  info: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  name: { fontSize: 14, fontWeight: '700', color: colors.ink, flexShrink: 1 },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  pendingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.warning,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginLeft: 8,
  },
  pendingBadgeText: { fontSize: 11, fontWeight: '700', color: colors.white },
});

// ── Grouped team sections ─────────────────────────────────────────────────────

interface TeamSection {
  userId: number;
  name: string;
  employeeId: string | null;
  allItems: OvertimeRequest[];
  data: OvertimeRequest[];  // empty when collapsed
}

// ── Main Screen ───────────────────────────────────────────────────────────────

type Tab = 'my' | 'team';

type OvertimeScreenProps = BottomTabScreenProps<MainTabParamList, 'Overtime'>;

export default function OvertimeScreen({ route }: OvertimeScreenProps) {
  const { data: me } = useMe();
  const tz = me?.site_timezone ?? 'Asia/Jakarta';
  const isSupervisorOrAdmin = me?.role === 'SUPERVISOR' || me?.role === 'ADMIN';

  const [activeTab, setActiveTab] = useState<Tab>('my');

  // Separate filter state per tab
  const [myStatus, setMyStatus] = useState<StatusFilter>(undefined);
  const [teamStatus, setTeamStatus] = useState<StatusFilter>('PENDING');
  const [myFrom, setMyFrom] = useState<string | null>(null);
  const [myTo, setMyTo] = useState<string | null>(null);
  const [teamFrom, setTeamFrom] = useState<string | null>(null);
  const [teamTo, setTeamTo] = useState<string | null>(null);

  // Collapsible user groups (team tab)
  const [expandedUsers, setExpandedUsers] = useState<Set<number>>(new Set());

  const [showSubmit, setShowSubmit] = useState(false);
  const [approveTarget, setApproveTarget] = useState<OvertimeRequest | null>(null);
  const [rejectTarget, setRejectTarget] = useState<OvertimeRequest | null>(null);

  const myQuery = useMyOvertimes(myStatus);
  const teamQuery = useTeamOvertimes(teamStatus, isSupervisorOrAdmin);

  const activeQuery = activeTab === 'my' ? myQuery : teamQuery;

  // When navigated from HistoryScreen, switch to 'my' tab and show PENDING requests
  useEffect(() => {
    if (route?.params?.from === 'history') {
      setActiveTab('my');
      setMyStatus('PENDING');
    }
  }, [route?.params?.from, route?.params?.attendance_id]);

  // Reset expanded groups when team data refreshes
  const prevTeamData = useRef<OvertimeRequest[] | undefined>(undefined);
  useEffect(() => {
    if (teamQuery.data !== prevTeamData.current) {
      prevTeamData.current = teamQuery.data;
      // Auto-expand first user group with pending requests
      if (teamQuery.data) {
        const pendingUserId = teamQuery.data.find((r) => r.status === 'PENDING')?.user_id;
        if (pendingUserId != null) {
          setExpandedUsers(new Set([pendingUserId]));
        }
      }
    }
  }, [teamQuery.data]);

  function toggleUser(uid: number) {
    setExpandedUsers((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid); else next.add(uid);
      return next;
    });
  }

  // Apply date filter client-side
  const filteredMy = useMemo(() => {
    const items = myQuery.data ?? [];
    return items.filter((item) => {
      const ds = fmtDateSv(item.requested_start, tz);
      if (myFrom && ds < myFrom) return false;
      if (myTo && ds > myTo) return false;
      return true;
    });
  }, [myQuery.data, myFrom, myTo, tz]);

  const filteredTeam = useMemo(() => {
    const items = teamQuery.data ?? [];
    return items.filter((item) => {
      const ds = fmtDateSv(item.requested_start, tz);
      if (teamFrom && ds < teamFrom) return false;
      if (teamTo && ds > teamTo) return false;
      return true;
    });
  }, [teamQuery.data, teamFrom, teamTo, tz]);

  // Build SectionList sections for team tab
  const teamSections: TeamSection[] = useMemo(() => {
    const map = new Map<number, TeamSection>();
    for (const item of filteredTeam) {
      const uid = item.user_id ?? 0;
      if (!map.has(uid)) {
        map.set(uid, {
          userId: uid,
          name: item.employee_name ?? `Karyawan #${uid}`,
          employeeId: item.employee_id ?? null,
          allItems: [],
          data: [],
        });
      }
      map.get(uid)!.allItems.push(item);
    }
    // Sort: sections with pending first, then by name
    return Array.from(map.values())
      .sort((a, b) => {
        const aPending = a.allItems.some((r) => r.status === 'PENDING') ? 0 : 1;
        const bPending = b.allItems.some((r) => r.status === 'PENDING') ? 0 : 1;
        if (aPending !== bPending) return aPending - bPending;
        return a.name.localeCompare(b.name);
      })
      .map((s) => ({
        ...s,
        data: expandedUsers.has(s.userId) ? s.allItems : [],
      }));
  }, [filteredTeam, expandedUsers]);

  const isLoading = activeQuery.isLoading;
  const isError = activeQuery.isError;
  const isEmpty = activeTab === 'my' ? filteredMy.length === 0 : teamSections.length === 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Lembur</Text>
      </View>

      <OfflineBanner />

      {/* ── Tab Bar ── */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'my' && styles.tabActive]}
          onPress={() => setActiveTab('my')}
        >
          <Text style={[styles.tabText, activeTab === 'my' && styles.tabTextActive]}>Pengajuan Saya</Text>
        </TouchableOpacity>
        {isSupervisorOrAdmin ? (
          <TouchableOpacity
            style={[styles.tab, activeTab === 'team' && styles.tabActive]}
            onPress={() => setActiveTab('team')}
          >
            <Text style={[styles.tabText, activeTab === 'team' && styles.tabTextActive]}>Tim</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* ── Filter Bar ── */}
      {activeTab === 'my' ? (
        <FilterBar
          statusFilter={myStatus}
          onStatusChange={setMyStatus}
          fromDate={myFrom}
          toDate={myTo}
          onFromDate={setMyFrom}
          onToDate={setMyTo}
          tz={tz}
        />
      ) : (
        <FilterBar
          statusFilter={teamStatus}
          onStatusChange={setTeamStatus}
          fromDate={teamFrom}
          toDate={teamTo}
          onFromDate={setTeamFrom}
          onToDate={setTeamTo}
          tz={tz}
        />
      )}

      {/* ── Content ── */}
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.action} />
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={40} color={colors.danger} />
          <Text style={styles.errorText}>Gagal memuat data.</Text>
          <TouchableOpacity onPress={() => activeQuery.refetch()} style={styles.retryBtn}>
            <Text style={styles.retryBtnText}>Coba Lagi</Text>
          </TouchableOpacity>
        </View>
      ) : isEmpty ? (
        <View style={styles.center}>
          <Ionicons name="time-outline" size={48} color={colors.borderStrong} />
          <Text style={styles.emptyText}>Tidak ada pengajuan lembur.</Text>
        </View>
      ) : activeTab === 'my' ? (
        /* ── My Overtime: flat FlatList ── */
        <FlatList
          data={filteredMy}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={myQuery.isFetching && !myQuery.isLoading}
              onRefresh={() => myQuery.refetch()}
              colors={[colors.action]}
            />
          }
          renderItem={({ item }) => (
            <OvertimeItem
              item={item}
              tz={tz}
              showActions={false}
              onApprove={setApproveTarget}
              onReject={setRejectTarget}
            />
          )}
        />
      ) : (
        /* ── Team Overtime: grouped SectionList ── */
        <SectionList
          sections={teamSections}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled={false}
          refreshControl={
            <RefreshControl
              refreshing={teamQuery.isFetching && !teamQuery.isLoading}
              onRefresh={() => teamQuery.refetch()}
              colors={[colors.action]}
            />
          }
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeaderWrapper}>
              <UserGroupHeader
                name={section.name}
                employeeId={section.employeeId}
                totalCount={section.allItems.length}
                pendingCount={section.allItems.filter((r) => r.status === 'PENDING').length}
                totalMinutes={section.allItems.reduce((sum, r) => sum + r.requested_minutes, 0)}
                expanded={expandedUsers.has(section.userId)}
                onToggle={() => toggleUser(section.userId)}
              />
            </View>
          )}
          renderItem={({ item, section }) =>
            expandedUsers.has(section.userId) ? (
              <View style={styles.sectionItemWrapper}>
                <OvertimeItem
                  item={item}
                  tz={tz}
                  showActions={isSupervisorOrAdmin}
                  onApprove={setApproveTarget}
                  onReject={setRejectTarget}
                />
              </View>
            ) : null
          }
          SectionSeparatorComponent={() => <View style={styles.sectionSep} />}
        />
      )}

      {/* ── FAB ── */}
      <TouchableOpacity style={styles.fab} onPress={() => setShowSubmit(true)}>
        <Ionicons name="add" size={28} color={colors.white} />
      </TouchableOpacity>

      <SubmitModal visible={showSubmit} onClose={() => setShowSubmit(false)} tz={tz} />
      <ApproveModal item={approveTarget} tz={tz} onClose={() => setApproveTarget(null)} />
      <RejectModal item={rejectTarget} onClose={() => setRejectTarget(null)} />
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.muted },

  header: { backgroundColor: colors.action, paddingHorizontal: 20, paddingVertical: 16 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: colors.white },

  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: colors.action },
  tabText: { fontSize: 14, color: colors.textMuted, fontWeight: '500' },
  tabTextActive: { color: colors.action, fontWeight: '700' },

  list: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 100 },

  // Section list wrappers
  sectionHeaderWrapper: { marginBottom: 2, borderRadius: 12, overflow: 'hidden', marginTop: 8 },
  sectionItemWrapper: { paddingLeft: 8 },
  sectionSep: { height: 4 },

  // OvertimeItem card
  card: {
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    shadowColor: colors.black,
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  cardDate: { fontSize: 14, fontWeight: '600', color: colors.ink },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  badgeText: { fontSize: 11, color: colors.white, fontWeight: '600' },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  cardMeta: { fontSize: 13, color: colors.textMuted },
  crossLabel: { color: colors.overtime, fontStyle: 'italic' },

  checkinBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, borderRadius: 8, marginTop: 10 },
  checkinBannerText: { fontSize: 12, fontWeight: '500', flex: 1 },

  actionRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  actionBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  approveBtn: { backgroundColor: colors.success },
  rejectBtn: { backgroundColor: colors.danger },
  actionBtnText: { color: colors.white, fontWeight: '600', fontSize: 13 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { fontSize: 15, color: colors.textSubtle },
  errorText: { color: colors.danger, fontSize: 13, marginTop: 8 },
  retryBtn: { backgroundColor: colors.action, paddingHorizontal: 20, paddingVertical: 8, borderRadius: 8 },
  retryBtnText: { color: colors.white, fontWeight: '600' },

  fab: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.action,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.black,
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },

  // Modals
  modalSafe: { flex: 1, backgroundColor: colors.white },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: colors.ink },
  modalBody: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  modalFooter: { padding: 20, borderTopWidth: 1, borderTopColor: colors.border },

  // Employee badge (in approve/reject modals)
  employeeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.actionTint,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.actionBorder,
  },
  employeeAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.action,
    alignItems: 'center',
    justifyContent: 'center',
  },
  employeeAvatarText: { fontSize: 16, fontWeight: '700', color: colors.white },
  employeeName: { fontSize: 14, fontWeight: '700', color: colors.actionInk },
  employeeId: { fontSize: 12, color: colors.action, marginTop: 1 },

  sectionTitle: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 4 },
  sectionHint: { fontSize: 12, color: colors.textSubtle, marginBottom: 12 },
  calendarBox: {
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 16,
  },

  selectedDateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.actionTint,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 4,
  },
  selectedDateText: { fontSize: 14, fontWeight: '600', color: colors.action, flex: 1 },

  noDateHint: { alignItems: 'center', paddingVertical: 32, gap: 12 },
  noDateHintText: { fontSize: 14, color: colors.textSubtle, textAlign: 'center' },

  crossMidnightWarn: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: colors.overtimeTint,
    borderRadius: 8,
    padding: 10,
    marginTop: 8,
    marginBottom: 4,
  },
  crossMidnightText: { fontSize: 13, color: colors.overtime, flex: 1 },

  label: { fontSize: 13, fontWeight: '600', color: colors.text, marginTop: 16, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.ink,
    backgroundColor: colors.canvas,
    marginBottom: 4,
  },
  textArea: { minHeight: 80, textAlignVertical: 'top' },

  // TimeStepper
  timeStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: colors.canvas,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 4,
  },
  stepperUnit: { alignItems: 'center', gap: 2 },
  stepperBtn: { padding: 8 },
  stepperValueBox: {
    width: 72,
    height: 56,
    borderRadius: 10,
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: colors.action,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValue: { fontSize: 28, fontWeight: '700', color: colors.ink },
  stepperColon: { fontSize: 28, fontWeight: '700', color: colors.textSubtle },
  stepperUnitLabel: { fontSize: 11, color: colors.textSubtle, fontWeight: '500' },

  // ApproveModal info box
  infoBox: {
    backgroundColor: colors.canvas,
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  infoDate: { fontSize: 13, color: colors.textMuted, marginBottom: 2 },
  infoTime: { fontSize: 15, fontWeight: '600', color: colors.ink },
  infoDuration: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  overrideToggle: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, marginBottom: 4 },
  overrideToggleText: { fontSize: 14, color: colors.text, fontWeight: '500' },

  submitBtn: { backgroundColor: colors.action, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  submitBtnDisabled: { opacity: 0.45 },
  submitBtnText: { color: colors.white, fontWeight: '700', fontSize: 15 },
  rejectBtnFull: { backgroundColor: colors.danger },
});
