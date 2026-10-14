import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTodayAttendance } from '../hooks/useAttendance';
import { useAuthState } from '../store/authStore';
import { AttendanceRecord } from '../types/attendance';
import CheckinModal from '../components/CheckinModal';
import CheckoutModal from '../components/CheckoutModal';
import OfflineBanner from '../components/OfflineBanner';
import OutboxStatus from '../components/OutboxStatus';
import { useOutbox } from '../offline/outbox';
import { colors } from '../theme/colors'

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_TIMEZONES = new Set(['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura']);

function getSafeTimezone(tz: string | null | undefined): string {
  return tz && VALID_TIMEZONES.has(tz) ? tz : 'Asia/Jakarta';
}

function isValidIsoDate(iso: string | null | undefined): iso is string {
  if (!iso) return false;
  return Number.isFinite(new Date(iso).getTime());
}

function formatTime(iso: string | null | undefined, tz: string | null | undefined): string {
  if (!isValidIsoDate(iso)) return '-';

  return new Intl.DateTimeFormat('id-ID', {
    timeZone: getSafeTimezone(tz),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

function formatDuration(minutes: number | null | undefined): string {
  if (!Number.isFinite(minutes) || minutes == null || minutes < 0) return '-';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}j`;
  return `${h}j ${m}m`;
}

function formatDate(): string {
  const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
    'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
  ];
  const now = new Date();
  return `${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
}

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

function localDay(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusCard({
  record,
  siteTimezone,
  pendingCheckinAt,
}: {
  record: AttendanceRecord | null | undefined;
  siteTimezone: string;
  pendingCheckinAt?: string;
}) {
  if (!record && pendingCheckinAt) {
    // Checked in while offline; the outbox will deliver it.
    return (
      <View style={[styles.card, styles.cardGreen]}>
        <Ionicons name="cloud-upload-outline" size={32} color={colors.success} />
        <Text style={styles.cardTitle}>Check In Tersimpan di HP</Text>
        <Text style={styles.cardTime}>{formatTime(pendingCheckinAt, siteTimezone)}</Text>
        <Text style={styles.cardSubtitle}>Akan dikirim otomatis saat ada sinyal</Text>
      </View>
    );
  }

  if (record === undefined) {
    // Loading
    return (
      <View style={[styles.card, styles.cardGrey]}>
        <ActivityIndicator color={colors.textMuted} />
      </View>
    );
  }

  if (record === null) {
    // Not checked in yet
    return (
      <View style={[styles.card, styles.cardGrey]}>
        <Ionicons name="time-outline" size={32} color={colors.textSubtle} />
        <Text style={styles.cardTitle}>Belum Absen</Text>
        <Text style={styles.cardSubtitle}>Anda belum melakukan absensi hari ini</Text>
      </View>
    );
  }

  if (!isValidIsoDate(record.checkout_time)) {
    // Checked in, not yet checked out
    return (
      <View style={[styles.card, styles.cardGreen]}>
        <Ionicons name="checkmark-circle" size={32} color={colors.success} />
        <Text style={styles.cardTitle}>Sudah Check In</Text>
        <Text style={styles.cardTime}>{formatTime(record.checkin_time, siteTimezone)}</Text>
        <View style={[styles.badge, { backgroundColor: getStatusColor(record.status) + '20' }]}>
          <Text style={[styles.badgeText, { color: getStatusColor(record.status) }]}>
            {getStatusLabel(record.status)}
          </Text>
        </View>
        <Text style={styles.cardSubtitle}>Jangan lupa absen pulang!</Text>
      </View>
    );
  }

  // Fully completed
  return (
    <View style={[styles.card, styles.cardBlue]}>
      <Ionicons name="checkmark-done-circle" size={32} color={colors.action} />
      <Text style={styles.cardTitle}>Absensi Selesai</Text>
      <View style={styles.timeRow}>
        <View style={styles.timeItem}>
          <Text style={styles.timeLabel}>Masuk</Text>
          <Text style={styles.timeValue}>{formatTime(record.checkin_time, siteTimezone)}</Text>
        </View>
        <Ionicons name="arrow-forward" size={16} color={colors.textSubtle} />
        <View style={styles.timeItem}>
          <Text style={styles.timeLabel}>Keluar</Text>
          <Text style={styles.timeValue}>{formatTime(record.checkout_time, siteTimezone)}</Text>
        </View>
      </View>
      <Text style={styles.durationText}>
        {formatDuration(record.work_duration_minutes)}
      </Text>
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const { user } = useAuthState();
  const siteTimezone = getSafeTimezone(user?.site_timezone);
  const { data: todayRecord, isLoading, isError, refetch, isRefetching } = useTodayAttendance(siteTimezone);
  const outbox = useOutbox(user?.id);
  const [checkinVisible, setCheckinVisible] = useState(false);
  const [checkoutVisible, setCheckoutVisible] = useState(false);

  // Check-ins and check-outs captured today that are still on the phone
  const today = localDay(new Date().toISOString(), siteTimezone);
  const queuedToday = outbox.filter(
    (i) => i.state === 'pending' && localDay(i.capturedAt, siteTimezone) === today,
  );
  const pendingCheckin = queuedToday.find((i) => i.kind === 'checkin');
  const pendingCheckout = queuedToday.find((i) => i.kind === 'checkout');

  const serverOpen =
    todayRecord !== null &&
    todayRecord !== undefined &&
    !isValidIsoDate(todayRecord.checkout_time);

  const isCompleted =
    (todayRecord !== null &&
      todayRecord !== undefined &&
      isValidIsoDate(todayRecord.checkout_time)) ||
    ((serverOpen || pendingCheckin !== undefined) && pendingCheckout !== undefined);

  const isCheckedIn = !isCompleted && (serverOpen || (todayRecord === null && pendingCheckin !== undefined));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>HadirOps</Text>
        <Text style={styles.headerDate}>{formatDate()}</Text>
      </View>
      <OfflineBanner />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Welcome Card */}
        <View style={styles.welcomeCard}>
          <View style={styles.welcomeRow}>
            <View style={styles.welcomeAvatar}>
              <Text style={styles.welcomeAvatarText}>
                {(user?.name ?? 'U')[0]?.toUpperCase()}
              </Text>
            </View>
            <View style={styles.welcomeInfo}>
              <Text style={styles.welcomeGreeting}>Selamat datang,</Text>
              <Text style={styles.welcomeName}>{user?.name ?? '-'}</Text>
            </View>
          </View>
          <View style={styles.roleBadge}>
            <Text style={styles.roleBadgeText}>{user?.role ?? '-'}</Text>
          </View>
        </View>

        {/* Status Section */}
        <Text style={styles.sectionLabel}>Status Absensi Hari Ini</Text>
        {isError ? (
          <View style={[styles.card, styles.cardGrey, { gap: 12 }]}>
            <Ionicons name="alert-circle-outline" size={32} color={colors.textSubtle} />
            <Text style={{ fontSize: 14, color: colors.textMuted, textAlign: 'center' }}>
              Status hari ini belum bisa dimuat. Absen tetap bisa dilakukan dan
              akan dikirim saat ada sinyal.
            </Text>
            <Pressable
              style={[styles.ctaButton, styles.ctaCheckin, { alignSelf: 'stretch', marginTop: 0 }]}
              onPress={() => refetch()}
            >
              <Ionicons name="refresh-outline" size={18} color={colors.white} />
              <Text style={styles.ctaText}>Muat Ulang</Text>
            </Pressable>
          </View>
        ) : (
          <StatusCard
            record={isLoading ? undefined : (todayRecord ?? null)}
            siteTimezone={siteTimezone}
            pendingCheckinAt={pendingCheckin?.capturedAt}
          />
        )}

        <OutboxStatus items={outbox} siteTimezone={siteTimezone} />

        {/* Status unknown (no signal): offer the next likely action. The server
            settles it when the item syncs, e.g. refuses a second check-in. */}
        {isError && !pendingCheckout && (
          <Pressable
            style={[styles.ctaButton, pendingCheckin ? styles.ctaCheckout : styles.ctaCheckin]}
            onPress={() => (pendingCheckin ? setCheckoutVisible(true) : setCheckinVisible(true))}
          >
            <Ionicons name={pendingCheckin ? 'log-out-outline' : 'log-in-outline'} size={20} color={colors.white} />
            <Text style={styles.ctaText}>{pendingCheckin ? 'Check Out' : 'Check In'}</Text>
          </Pressable>
        )}
        {isError && !pendingCheckin && (
          <Pressable style={[styles.ctaButton, styles.ctaCheckout]} onPress={() => setCheckoutVisible(true)}>
            <Ionicons name="log-out-outline" size={20} color={colors.white} />
            <Text style={styles.ctaText}>Check Out</Text>
          </Pressable>
        )}

        {/* CTA Button */}
        {!isError && (isCompleted ? (
          <View style={[styles.ctaButton, styles.ctaDisabled]}>
            <Ionicons name="checkmark-done" size={20} color={colors.white} />
            <Text style={styles.ctaText}>Sudah Absen</Text>
          </View>
        ) : isCheckedIn ? (
          <Pressable
            style={[styles.ctaButton, styles.ctaCheckout]}
            onPress={() => setCheckoutVisible(true)}
          >
            <Ionicons name="log-out-outline" size={20} color={colors.white} />
            <Text style={styles.ctaText}>Check Out</Text>
          </Pressable>
        ) : (
          <Pressable
            style={[styles.ctaButton, styles.ctaCheckin, isLoading && styles.ctaDisabled]}
            onPress={() => setCheckinVisible(true)}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <>
                <Ionicons name="log-in-outline" size={20} color={colors.white} />
                <Text style={styles.ctaText}>Check In</Text>
              </>
            )}
          </Pressable>
        ))}
      </ScrollView>

      <CheckinModal
        visible={checkinVisible}
        onClose={() => setCheckinVisible(false)}
        userId={user?.id}
        siteTimezone={siteTimezone}
      />
      <CheckoutModal
        visible={checkoutVisible}
        onClose={() => setCheckoutVisible(false)}
        userId={user?.id}
        siteTimezone={siteTimezone}
      />
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.muted,
  },
  header: {
    backgroundColor: colors.action,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.white,
  },
  headerDate: {
    fontSize: 13,
    color: colors.actionBorder,
    marginTop: 2,
  },
  scrollContent: {
    padding: 16,
    gap: 12,
  },
  welcomeCard: {
    backgroundColor: colors.white,
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  welcomeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  welcomeAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.action,
    alignItems: 'center',
    justifyContent: 'center',
  },
  welcomeAvatarText: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.white,
  },
  welcomeInfo: {
    flex: 1,
  },
  welcomeGreeting: {
    fontSize: 12,
    color: colors.textMuted,
  },
  welcomeName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.ink,
  },
  roleBadge: {
    backgroundColor: colors.actionTint,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  roleBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.action,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 4,
  },
  card: {
    borderRadius: 14,
    padding: 20,
    alignItems: 'center',
    gap: 8,
  },
  cardGrey: {
    backgroundColor: colors.canvas,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardGreen: {
    backgroundColor: colors.successTint,
    borderWidth: 1,
    borderColor: colors.successBorder,
  },
  cardBlue: {
    backgroundColor: colors.actionTint,
    borderWidth: 1,
    borderColor: colors.actionBorder,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.ink,
  },
  cardSubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
  },
  cardTime: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.ink,
  },
  badge: {
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
    alignSelf: 'stretch',
  },
  timeItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  timeLabel: {
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'center',
  },
  timeValue: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.ink,
    textAlign: 'center',
  },
  durationText: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
  },
  ctaButton: {
    height: 56,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4,
  },
  ctaCheckin: {
    backgroundColor: colors.success,
  },
  ctaCheckout: {
    backgroundColor: colors.warning,
  },
  ctaDisabled: {
    backgroundColor: colors.textSubtle,
  },
  ctaText: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.white,
  },
});
