import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useTeamAttendance } from '../hooks/useAttendance';
import { EmployeeSummary, TeamAttendanceRecord } from '../types/attendance';
import OfflineBanner from '../components/OfflineBanner';
import { DateRangeBar, fmtDateShort } from '../components/DateRangePicker';
import { useAuthState } from '../store/authStore';
import { exportCsv } from '../utils/exportCsv';
import { showError, showSuccess } from '../utils/toast';
import { colors } from '../theme/colors'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: tz, weekday: 'short', day: 'numeric', month: 'short',
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
  return `${h}j ${m}m`;
}

function statusLabel(status: TeamAttendanceRecord['status']): string {
  if (status === 'ONTIME')        return 'Tepat Waktu';
  if (status === 'LATE')          return 'Terlambat';
  if (status === 'OUT_OF_RADIUS') return 'Di Luar Area';
  return '-';
}

function statusColor(status: TeamAttendanceRecord['status']): string {
  if (status === 'ONTIME')        return colors.success;
  if (status === 'LATE')          return colors.warning;
  if (status === 'OUT_OF_RADIUS') return colors.danger;
  return colors.textMuted;
}

function todayFilename(): string {
  return `tim_absensi_${new Date().toISOString().slice(0, 10)}.csv`;
}

// ── DailyRow ──────────────────────────────────────────────────────────────────

function DailyRow({ record }: { record: TeamAttendanceRecord }) {
  const color = statusColor(record.status);
  const tz = record.site_timezone ?? 'Asia/Jakarta';
  return (
    <View style={styles.dailyRow}>
      <View style={styles.dailyLeft}>
        <Text style={styles.dailyDate}>{formatDate(record.checkin_time, tz)}</Text>
        <Text style={styles.dailyTime}>
          {formatTime(record.checkin_time, tz)}
          {record.checkout_time ? ` → ${formatTime(record.checkout_time, tz)}` : ' → —'}
        </Text>
        {record.checkout_time && (
          <Text style={styles.dailyDuration}>{formatDuration(record.work_duration_minutes)}</Text>
        )}
      </View>
      <View style={[styles.statusBadge, { backgroundColor: color }]}>
        <Text style={styles.statusBadgeText}>{statusLabel(record.status)}</Text>
      </View>
    </View>
  );
}

// ── EmployeeCard ──────────────────────────────────────────────────────────────

function EmployeeCard({
  summary, expanded, onToggle,
}: { summary: EmployeeSummary; expanded: boolean; onToggle: () => void }) {
  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.cardHeader} onPress={onToggle} activeOpacity={0.7}>
        <View style={styles.cardHeaderLeft}>
          <Text style={styles.employeeName}>{summary.employee_name}</Text>
          <Text style={styles.employeeId}>{summary.employee_id}</Text>
        </View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
      </TouchableOpacity>

      <View style={styles.statRow}>
        <View style={styles.statBadgesLeft}>
          {summary.ontime_count > 0 && (
            <View style={[styles.statBadge, { backgroundColor: colors.successTintStrong }]}>
              <Text style={[styles.statCount, { color: colors.success }]}>{summary.ontime_count}</Text>
              <Text style={[styles.statLabel, { color: colors.success }]}>Tepat</Text>
            </View>
          )}
          {summary.late_count > 0 && (
            <View style={[styles.statBadge, { backgroundColor: colors.warningTintStrong }]}>
              <Text style={[styles.statCount, { color: colors.warning }]}>{summary.late_count}</Text>
              <Text style={[styles.statLabel, { color: colors.warning }]}>Terlambat</Text>
            </View>
          )}
          {summary.out_of_radius_count > 0 && (
            <View style={[styles.statBadge, { backgroundColor: colors.dangerTintStrong }]}>
              <Text style={[styles.statCount, { color: colors.danger }]}>{summary.out_of_radius_count}</Text>
              <Text style={[styles.statLabel, { color: colors.danger }]}>Di Luar</Text>
            </View>
          )}
        </View>
        <View style={[styles.statBadge, { backgroundColor: colors.muted }]}>
          <Text style={[styles.statCount, { color: colors.text }]}>{summary.total_days}</Text>
          <Text style={[styles.statLabel, { color: colors.text }]}>Hari</Text>
        </View>
      </View>

      {expanded && (
        <View style={styles.dailyList}>
          <View style={styles.divider} />
          {summary.records.map((rec) => (
            <DailyRow key={rec.id} record={rec} />
          ))}
        </View>
      )}
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function SubordinateAttendanceScreen() {
  const { user } = useAuthState();
  const siteTimezone = user?.site_timezone ?? 'Asia/Jakarta';

  const [fromDate, setFromDate] = useState<string | null>(null);
  const [toDate, setToDate] = useState<string | null>(null);
  const [expandedUserId, setExpandedUserId] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  const { data: records, isLoading, isError, refetch, isFetching } =
    useTeamAttendance(fromDate, toDate);

  const summaries = useMemo<EmployeeSummary[]>(() => {
    const map = new Map<number, EmployeeSummary>();
    for (const rec of records ?? []) {
      if (!map.has(rec.user_id)) {
        map.set(rec.user_id, {
          user_id: rec.user_id,
          employee_id: rec.employee_id,
          employee_name: rec.employee_name,
          ontime_count: 0,
          late_count: 0,
          out_of_radius_count: 0,
          total_days: 0,
          records: [],
        });
      }
      const s = map.get(rec.user_id)!;
      s.total_days++;
      s.records.push(rec);
      if (rec.status === 'ONTIME') s.ontime_count++;
      else if (rec.status === 'LATE') s.late_count++;
      else if (rec.status === 'OUT_OF_RADIUS') s.out_of_radius_count++;
    }
    return [...map.values()].sort((a, b) =>
      a.employee_name.localeCompare(b.employee_name, 'id')
    );
  }, [records]);

  const hasFilter = fromDate !== null || toDate !== null;

  // ── Export ──────────────────────────────────────────────────────────────────

  async function handleExport() {
    if (summaries.length === 0) {
      showError('Tidak ada data untuk diekspor.');
      return;
    }
    setExporting(true);
    try {
      const header = ['Karyawan', 'ID Karyawan', 'Tanggal', 'Jam Masuk', 'Jam Keluar', 'Durasi', 'Status'];
      const rows = summaries.flatMap((s) =>
        s.records.map((r) => {
          const tz = r.site_timezone ?? 'Asia/Jakarta';
          return [
            s.employee_name,
            s.employee_id,
            formatDate(r.checkin_time, tz),
            formatTime(r.checkin_time, tz),
            r.checkout_time ? formatTime(r.checkout_time, tz) : '-',
            r.work_duration_minutes > 0 ? formatDuration(r.work_duration_minutes) : '-',
            statusLabel(r.status),
          ];
        })
      );
      await exportCsv([header, ...rows], todayFilename());
      showSuccess('Data berhasil diekspor.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showError(`Gagal mengekspor: ${msg}`);
    } finally {
      setExporting(false);
    }
  }

  function toggleEmployee(userId: number) {
    setExpandedUserId((prev) => (prev === userId ? null : userId));
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Tim Saya</Text>
          <Text style={styles.headerSub}>Rekap kehadiran bawahan</Text>
        </View>
        <TouchableOpacity
          style={[styles.exportBtn, (exporting || summaries.length === 0) && styles.exportBtnDisabled]}
          onPress={handleExport}
          disabled={exporting || summaries.length === 0}
        >
          {exporting
            ? <ActivityIndicator size="small" color={colors.action} />
            : <Ionicons name="download-outline" size={20} color={colors.action} />}
        </TouchableOpacity>
      </View>

      <OfflineBanner />

      {/* ── Date range filter ── */}
      <View style={styles.filterBar}>
        <DateRangeBar
          fromDate={fromDate}
          toDate={toDate}
          onFromDate={(d) => { setFromDate(d); setExpandedUserId(null); }}
          onToDate={(d) => { setToDate(d); setExpandedUserId(null); }}
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
            : `Menampilkan ${(records?.length ?? 0) > 0 ? records!.length : '–'} data terbaru`}
        </Text>
        {summaries.length > 0 && !isLoading && (
          <Text style={styles.infoCount}>{summaries.length} karyawan</Text>
        )}
      </View>

      {/* ── Content ── */}
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.action} />
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.textSubtle} />
          <Text style={styles.infoTextGray}>Gagal memuat data.</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => refetch()}>
            <Text style={styles.retryText}>Coba Lagi</Text>
          </TouchableOpacity>
        </View>
      ) : summaries.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="people-outline" size={48} color={colors.borderStrong} />
          <Text style={styles.emptyTitle}>Tidak ada data</Text>
          <Text style={styles.emptySubtitle}>
            {hasFilter
              ? 'Tidak ada kehadiran pada periode yang dipilih.'
              : 'Tidak ada bawahan terdaftar atau belum ada kehadiran terbaru.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={summaries}
          keyExtractor={(item) => String(item.user_id)}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={isFetching && !isLoading}
              onRefresh={() => refetch()}
              tintColor={colors.action}
            />
          }
          renderItem={({ item }) => (
            <EmployeeCard
              summary={item}
              expanded={expandedUserId === item.user_id}
              onToggle={() => toggleEmployee(item.user_id)}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: colors.ink },
  headerSub: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  exportBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.actionTint,
    borderWidth: 1,
    borderColor: colors.actionBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exportBtnDisabled: { opacity: 0.4 },

  // Filter
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
  infoTextGray: { fontSize: 14, color: colors.textMuted },
  infoCount: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },

  list: { padding: 12, gap: 10 },

  // Employee card
  card: {
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginBottom: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 4,
  },
  cardHeaderLeft: { flex: 1 },
  employeeName: { fontSize: 15, fontWeight: '600', color: colors.ink },
  employeeId: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingBottom: 12,
    paddingTop: 8,
  },
  statBadgesLeft: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    flex: 1,
  },
  statBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  statCount: { fontSize: 13, fontWeight: '700' },
  statLabel: { fontSize: 12, fontWeight: '500' },
  divider: { height: 1, backgroundColor: colors.muted },
  dailyList: { paddingBottom: 4 },

  // Daily row
  dailyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.canvas,
  },
  dailyLeft: { flex: 1 },
  dailyDate: { fontSize: 13, fontWeight: '600', color: colors.text },
  dailyTime: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  dailyDuration: { fontSize: 11, color: colors.textSubtle, marginTop: 1 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, marginLeft: 8 },
  statusBadgeText: { fontSize: 11, fontWeight: '600', color: colors.white },

  // States
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: colors.text, marginTop: 4 },
  emptySubtitle: { fontSize: 13, color: colors.textSubtle, textAlign: 'center', lineHeight: 20 },
  retryBtn: {
    marginTop: 4, paddingHorizontal: 20, paddingVertical: 10,
    backgroundColor: colors.action, borderRadius: 8,
  },
  retryText: { fontSize: 14, fontWeight: '600', color: colors.white },
});
