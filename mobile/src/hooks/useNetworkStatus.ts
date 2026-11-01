import { useNetInfo } from '@react-native-community/netinfo';

/** Connectivity as NetInfo reports it; unknown (null) counts as connected. */
export function useNetworkStatus() {
  const { isConnected } = useNetInfo();
  return { isConnected: isConnected ?? true };
}
