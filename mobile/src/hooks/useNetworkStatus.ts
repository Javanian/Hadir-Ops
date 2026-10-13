import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

export function useNetworkStatus() {
  const [isConnected, setIsConnected] = useState(true);

  useEffect(() => {
    if (Platform.OS === 'web') {
      setIsConnected(navigator.onLine ?? true);
      const goOnline = () => setIsConnected(true);
      const goOffline = () => setIsConnected(false);
      window.addEventListener('online', goOnline);
      window.addEventListener('offline', goOffline);
      return () => {
        window.removeEventListener('online', goOnline);
        window.removeEventListener('offline', goOffline);
      };
    }

    let unsub: (() => void) | undefined;
    try {
      const NetInfo = require('@react-native-community/netinfo');
      unsub = NetInfo.addEventListener((state: { isConnected: boolean | null }) => {
        setIsConnected(state.isConnected ?? true);
      });
    } catch {
      setIsConnected(true);
    }
    return () => { if (unsub) unsub(); };
  }, []);

  return { isConnected };
}
