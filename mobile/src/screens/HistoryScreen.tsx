import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { MainTabParamList } from '../navigation/MainNavigator';

import { useAttendanceHistory } from '../hooks/useAttendance';
import { useAuthState } from '../store/authStore';
import { AttendanceRecord } from '../types/attendance';
import OfflineBanner from '../components/OfflineBanner';
import { DateRangeBar, fmtDateShort } from '../components/DateRangePicker';
import { exportCsv } from '../utils/exportCsv';
import { showError, showSuccess } from '../utils/toast';
import { colors } from '../theme/colors'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  }).format(new Date(iso));
}

function formatTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso));
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}j`;
  return `${h}j ${m}m`;
}

function getStatusColor(status: AttendanceRecord['status']): string {
  switch (status) {
    case 'ONTIME':        return colors.success;
    case 'EARLY':         return colors.action;
    case 'LATE':          return colors.warning;
    case 'OUT_OF_RADIUS': return colors.danger;
    default:              return colors.textSubtle;
  }
}

function getStatusLabel(status: AttendanceRecord['status']): string {
  switch (status) {
    case 'ONTIME':        return 'Tepat Waktu';
    case 'EARLY':         return 'Lebih Awal';
    case 'LATE':          return 'Terlambat';
    case 'OUT_OF_RADIUS': return 'Luar Area';
    default:              return '-';
  }
}

function todayFilename(): string {
  return `absensi_${new Date().toISOString().slice(0, 10)}.csv`;
}

// ── AttendanceCard ────────────────────────────────────────────────────────────

function AttendanceCard({
  record,
  onAjukanOvertime,
}: {
  record: AttendanceRecord;
  onAjukanOvertime: (attendanceId: number) => void;
}) {
  const statusColor = getStatusColor(record.status);
  const tz = record.site_timezone ?? 'Asia/Jakarta';

  const showAjukanBtn =
    record.overtime_minutes > 0 &&
    record.overtime_request_status === 'PENDING';
  const otApproved = record.overtime_request_status === 'APPROVED';
  const otRejected = record.overtime_request_status === 'REJECTED';

  return (
    <View style={styles.card}>
      {/* Row 1: date + status badge */}
      <View style={styles.cardHeader}>
        <Text style={styles.cardDate}>{formatDate(record.checkin_time, tz)}</Text>
        <View style={[styles.statusBadge, { backgroundColor: statusColor + '20' }]}>
          <Text style={[styles.statusBadgeText, { color: statusColor }]}>
            {getStatusLabel(record.status)}
          </Text>
        </View>
      </View>

      <View style={styles.cardDivider} />

      {/* Row 2: times + duration */}
      <View style={styles.cardBody}>
        <View style={styles.timesRow}>
          <View style={styles.timeItem}>
            <Text style={styles.timeLabel}>Masuk</Text>
            <Text style={styles.timeValue}>{formatTime(record.checkin_time, tz)}</Text>
          </View>
          <Ionicons name="arrow-forward" size={14} color={colors.borderStrong} />
          <View style={styles.timeItem}>
            <Text style={styles.timeLabel}>Keluar</Text>
            <Text style={styles.timeValue} numberOfLines={1}>
              {record.checkout_time
                ? `${formatTime(record.checkout_time, tz)}${record.auto_checkout ? ' (auto)' : ''}`
                : '–'}
            </Text>
          </View>
        </View>

        <View style={styles.durationBlock}>
          <Text style={styles.durationLabel}>Durasi</Text>
          <Text style={styles.durationValue}>
            {record.work_duration_minutes > 0 ? formatDuration(record.work_duration_minutes) : '–'}
          </Text>
        </View>
      </View>

      {/* Row 3: overtime badge (conditional) */}
      {record.overtime_minutes > 0 && (
        <View style={styles.overtimeBadge}>
          <Ionicons name="time-outline" size={12} color={colors.warning} />
          <Text style={styles.overtimeBadgeText}>
            Lembur {formatDuration(record.overtime_minutes)}
          </Text>
        </View>
      )}

      {/* Row 4: overtime request action / status */}
      {showAjukanBtn && (
        <TouchableOpacity
          style={styles.ajukanOtBtn}
          onPress={() => onAjukanOvertime(record.id)}
          activeOpacity={0.75}
        >
          <Ionicons name="document-text-outline" size={14} color={colors.white} />
          <Text style={styles.ajukanOtBtnText}>Ajukan Overtime</Text>
        </TouchableOpacity>
      )}
      {otApproved && !showAjukanBtn && record.overtime_minutes > 0 && (
        <View style={styles.otStatusBadge}>
          <Ionicons name="checkmark-circle-outline" size={13} color={colors.success} />
          <Text style={[styles.otStatusText, { color: colors.success }]}>Overtime Disetujui</Text>
        </View>
      )}
      {otRejected && !showAjukanBtn && record.overtime_minutes > 0 && (
        <View style={styles.otStatusBadge}>
          <Ionicons name="close-circle-outline" size={13} color={colors.danger} />
          <Text style={[styles.otStatusText, { color: colors.danger }]}>Overtime Ditolak</Text>
        </View>
      )}
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function HistoryScreen() {
  const { user } = useAuthState();
  const siteTimezone = user?.site_timezone ?? 'Asia/Jakarta';
  const navigation = useNavigation<BottomTabNavigationProp<MainTabParamList>>();

  function handleAjukanOvertime(attendanceId: number) {
    navigation.navigate('Overtime', { from: 'history', attendance_id: attendanceId });
  }

  const [fromDate, setFromDate] = useState<string | null>(null);
  const [toDate, setToDate] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const {
    data,
    isLoading,
    isError,
    refetch,
    isRefetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useAttendanceHistory(fromDate, toDate, siteTimezone);

  const records: AttendanceRecord[] = useMemo(() => data?.pages.flat() ?? [], [data]);
  const hasFilter = fromDate !== null || toDate !== null;

  // ── Export ──────────────────────────────────────────────────────────────────

  async function handleExport() {
    if (records.length === 0) {
      showError('Tidak ada data untuk diekspor.');
      return;
    }
    setExporting(true);
    try {
      const header = ['Tanggal', 'Jam Masuk', 'Jam Keluar', 'Durasi', 'Lembur', 'Status'];
      const rows = records.map((r) => {
        const tz = r.site_timezone ?? 'Asia/Jakarta';
        return [
          formatDate(r.checkin_time, tz),
          formatTime(r.checkin_time, tz),
          r.checkout_time ? `${formatTime(r.checkout_time, tz)}${r.auto_checkout ? ' (auto)' : ''}` : '-',
          r.work_duration_minutes > 0 ? formatDuration(r.work_duration_minutes) : '-',
          r.overtime_minutes > 0 ? formatDuration(r.overtime_minutes) : '-',
          getStatusLabel(r.status),
        ];
      });
      await exportCsv([header, ...rows], todayFilename());
      showSuccess('Data berhasil diekspor.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showError(`Gagal mengekspor: ${msg}`);
    } finally {
      setExporting(false);
    }
  }

  // ── Footer ──────────────────────────────────────────────────────────────────

  function renderFooter() {
    if (isFetchingNextPage) {
      return <ActivityIndicator style={styles.footerSpinner} color={colors.action} />;
    }
    if (hasNextPage) {
      return (
        <Pressable style={styles.loadMoreBtn} onPress={() => fetchNextPage()}>
          <Text style={styles.loadMoreText}>Muat Lebih Banyak</Text>
        </Pressable>
      );
    }
    if (records.length > 0) {
      return <Text style={styles.endText}>Semua data ditampilkan</Text>;
    }
    return null;
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Riwayat Absensi</Text>
        <TouchableOpacity
          style={[styles.exportBtn, exporting && styles.exportBtnDisabled]}
          onPress={handleExport}
          disabled={exporting || records.length === 0}
        >
          {exporting
            ? <ActivityIndicator size="small" color={colors.white} />
            : <Ionicons name="download-outline" size={20} color={colors.white} />}
        </TouchableOpacity>
      </View>

      <OfflineBanner />

      {/* ── Date range filter ── */}
      <View style={styles.filterBar}>
        <DateRangeBar
          fromDate={fromDate}
          toDate={toDate}
          onFromDate={setFromDate}
          onToDate={setToDate}
          tz={siteTimezone}
        />
      </View>

      {/* ── Info strip ── */}
      <View style={styles.infoStrip}>
        <Ionicons
          name={hasFilter ? 'funnel' : 'time-outline'}
          size={13}
          color={hasFilter ? colors.action : colors.textSubtle}
        />
        <Text style={[styles.infoText, hasFilter && styles.infoTextActive]}>
          {hasFilter
            ? `Periode: ${fromDate ? fmtDateShort(fromDate) : '…'}  –  ${toDate ? fmtDateShort(toDate) : '…'}`
            : `Menampilkan ${records.length > 0 ? records.length : '–'} data terbaru`}
        </Text>
        {records.length > 0 && !isLoading && (
          <Text style={styles.infoCount}>{records.length} data</Text>
        )}
      </View>

      {/* ── Content ── */}
      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.action} />
        </View>
      ) : isError ? (
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={52} color={colors.borderStrong} />
          <Text style={styles.errorTitle}>Gagal memuat data</Text>
          <Pressable style={styles.retryBtn} onPress={() => refetch()}>
            <Ionicons name="refresh-outline" size={16} color={colors.action} />
            <Text style={styles.retryText}>Coba Lagi</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={records}
          keyExtractor={(item) => item.id.toString()}
          renderItem={({ item }) => (
            <AttendanceCard record={item} onAjukanOvertime={handleAjukanOvertime} />
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} tintColor={colors.action} />
          }
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) fetchNextPage();
          }}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="calendar-outline" size={64} color={colors.borderStrong} />
              <Text style={styles.emptyTitle}>Belum ada data</Text>
              <Text style={styles.emptySubtitle}>Tidak ada riwayat absensi untuk periode ini.</Text>
            </View>
          }
          ListFooterComponent={renderFooter()}
        />
      )}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.muted },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.action,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: colors.white },
  exportBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  exportBtnDisabled: { opacity: 0.5 },

  // Filter bar (white card below header)
  filterBar: {
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },

  // Info strip
  infoStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 7,
    backgroundColor: colors.canvas,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  infoText: { flex: 1, fontSize: 12, color: colors.textSubtle },
  infoTextActive: { color: colors.action, fontWeight: '500' },
  infoCount: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },

  // List
  listContent: { padding: 16, gap: 10, flexGrow: 1 },

  // Card
  card: { backgroundColor: colors.white, borderRadius: 12, padding: 14, gap: 10 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardDate: { fontSize: 13, fontWeight: '600', color: colors.text, flex: 1, marginRight: 8 },
  statusBadge: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  statusBadgeText: { fontSize: 11, fontWeight: '600' },
  cardDivider: { height: 1, backgroundColor: colors.muted },
  cardBody: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  timesRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  timeItem: { alignItems: 'center', gap: 2, minWidth: 50 },
  timeLabel: { fontSize: 10, color: colors.textSubtle },
  timeValue: { fontSize: 15, fontWeight: '600', color: colors.ink, fontVariant: ['tabular-nums'] },
  durationBlock: { alignItems: 'flex-end', gap: 2, paddingLeft: 10, minWidth: 56 },
  durationLabel: { fontSize: 10, color: colors.textSubtle },
  durationValue: { fontSize: 14, fontWeight: '600', color: colors.text },
  overtimeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    alignSelf: 'flex-start', backgroundColor: colors.warningTintStrong,
    borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3,
  },
  overtimeBadgeText: { fontSize: 11, fontWeight: '600', color: colors.warning },
  ajukanOtBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.action, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 8, marginTop: 4,
  },
  ajukanOtBtnText: { fontSize: 13, fontWeight: '600', color: colors.white },
  otStatusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    alignSelf: 'flex-start', marginTop: 4,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 8, backgroundColor: colors.canvas,
  },
  otStatusText: { fontSize: 12, fontWeight: '600' },

  // States
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 48 },
  emptyTitle: { fontSize: 17, fontWeight: '600', color: colors.text },
  emptySubtitle: { fontSize: 14, color: colors.textSubtle, textAlign: 'center', lineHeight: 20 },
  errorTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 20, paddingVertical: 10,
    borderRadius: 10, borderWidth: 1.5, borderColor: colors.action, marginTop: 4,
  },
  retryText: { fontSize: 14, fontWeight: '600', color: colors.action },

  // Footer
  footerSpinner: { paddingVertical: 16 },
  loadMoreBtn: { alignItems: 'center', paddingVertical: 14, marginTop: 4 },
  loadMoreText: { fontSize: 14, fontWeight: '600', color: colors.action },
  endText: { textAlign: 'center', fontSize: 12, color: colors.textSubtle, paddingVertical: 16 },
});
