import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { OutboxItem, removeItem } from '../offline/outbox';
import { flush } from '../offline/sync';
import { colors } from '../theme/colors';

const LABEL: Record<string, string> = {
  checkin: 'Check in',
  checkout: 'Check out',
};

function formatTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: tz,
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

/**
 * What is still on the phone: check-ins and check-outs waiting for signal,
 * and the ones the server refused (with its reason). Failed-attempt reports
 * and photos sync quietly and are not listed.
 */
export default function OutboxStatus({ items, siteTimezone }: { items: OutboxItem[]; siteTimezone: string }) {
  const [sending, setSending] = useState(false);
  const visible = items.filter((i) => i.kind === 'checkin' || i.kind === 'checkout');
  if (visible.length === 0) return null;

  const pending = visible.filter((i) => i.state === 'pending');
  const failed = visible.filter((i) => i.state === 'failed');

  async function sendNow() {
    setSending(true);
    try {
      // A manual press should not wait for the backoff timer.
      await flush(true);
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={styles.wrap}>
      {pending.length > 0 && (
        <View style={[styles.card, styles.pendingCard]}>
          <View style={styles.row}>
            <Ionicons name="cloud-upload-outline" size={20} color={colors.warningStrong} />
            <Text style={styles.title}>
              {pending.length} absen tersimpan di HP, menunggu sinyal
            </Text>
          </View>
          {pending.map((i) => (
            <Text key={i.id} style={styles.line}>
              {LABEL[i.kind]} · {formatTime(i.capturedAt, siteTimezone)}
            </Text>
          ))}
          <Text style={styles.hint}>
            Jam absen sudah tercatat. Data dikirim otomatis, tidak perlu absen ulang.
          </Text>
          <Pressable style={styles.button} onPress={sendNow} disabled={sending}>
            {sending ? (
              <ActivityIndicator size="small" color={colors.warningStrong} />
            ) : (
              <Text style={styles.buttonText}>Kirim sekarang</Text>
            )}
          </Pressable>
        </View>
      )}

      {failed.map((i) => (
        <View key={i.id} style={[styles.card, styles.failedCard]}>
          <View style={styles.row}>
            <Ionicons name="alert-circle-outline" size={20} color={colors.danger} />
            <Text style={styles.title}>
              {LABEL[i.kind]} {formatTime(i.capturedAt, siteTimezone)} ditolak server
            </Text>
          </View>
          <Text style={styles.line}>{i.lastError}</Text>
          <Text style={styles.hint}>Percobaan ini sudah dilaporkan ke supervisor.</Text>
          <Pressable style={styles.button} onPress={() => removeItem(i.id)}>
            <Text style={styles.buttonText}>Tutup</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  card: { borderRadius: 14, padding: 14, gap: 6, borderWidth: 1 },
  pendingCard: { backgroundColor: colors.warningTint, borderColor: colors.warningBorder },
  failedCard: { backgroundColor: colors.dangerTint, borderColor: colors.dangerBorder },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 14, fontWeight: '700', color: colors.ink, flexShrink: 1 },
  line: { fontSize: 13, color: colors.text, fontVariant: ['tabular-nums'] },
  hint: { fontSize: 12, color: colors.textMuted },
  button: {
    alignSelf: 'flex-start',
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 4,
  },
  buttonText: { fontSize: 13, fontWeight: '600', color: colors.ink },
});
