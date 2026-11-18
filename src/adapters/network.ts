import type { NetworkMonitor } from '../components/customization';

type NetInfoState = { isConnected: boolean | null; isInternetReachable?: boolean | null };
type NetInfoModule = { addEventListener: (listener: (state: NetInfoState) => void) => () => void };

const online = (s: NetInfoState) => s.isConnected !== false && s.isInternetReachable !== false;

/**
 * Online/offline status from @react-native-community/netinfo (included in Expo Go).
 *
 *   import NetInfo from '@react-native-community/netinfo';
 *   <ChatView network={createNetInfoMonitor(NetInfo)} />
 */
export function createNetInfoMonitor(NetInfo: NetInfoModule): NetworkMonitor {
  let last: boolean | undefined;
  return {
    subscribe(onChange) {
      return NetInfo.addEventListener((state) => {
        const next = online(state);
        if (next !== last) {
          last = next;
          onChange(next);
        }
      });
    },
    isOnline: () => last,
  };
}

/** Online/offline status from the browser (Expo web). */
export function createWebNetworkMonitor(): NetworkMonitor {
  const g = globalThis as { navigator?: { onLine?: boolean }; addEventListener?: Function; removeEventListener?: Function };
  return {
    subscribe(onChange) {
      if (!g.addEventListener || !g.removeEventListener) return () => {};
      const on = () => onChange(true);
      const off = () => onChange(false);
      g.addEventListener('online', on);
      g.addEventListener('offline', off);
      return () => {
        g.removeEventListener!('online', on);
        g.removeEventListener!('offline', off);
      };
    },
    isOnline: () => g.navigator?.onLine,
  };
}

/** True for errors caused by no connection (as opposed to e.g. a 401 from the server). */
export function isNetworkError(message?: string): boolean {
  return !!message && /network request failed|failed to fetch|network ?error|internet connection|timed out|could not reach/i.test(message);
}
