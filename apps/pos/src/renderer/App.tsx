import { useEffect, useState, type ReactElement } from 'react';

import type { PosApi } from '../shared/pos-api';
import { RecordingPrinter } from '../main/hardware/fakes/recording-printer';

type AppInfoState = { status: 'loading' } | { status: 'ready'; version: string } | { status: 'failed' };

interface AppProps {
  readonly posApi: PosApi;
}

/**
 * Register screen. It receives the bridge as a prop, so it never touches what lies behind it.
 *
 * @param props.posApi bridge to the main process
 * @returns the screen
 */
export function App({ posApi }: AppProps): ReactElement {
  const [appInfo, setAppInfo] = useState<AppInfoState>({ status: 'loading' });

  useEffect(() => {
    posApi.getAppInfo().then(
      ({ version }) => setAppInfo({ status: 'ready', version }),
      () => setAppInfo({ status: 'failed' }),
    );
  }, [posApi]);

  return (
    <main className="register">
      <h1>Caja</h1>
      {appInfo.status === 'ready' && <p>Versión {appInfo.version}</p>}
      {appInfo.status === 'failed' && <p role="alert">No se pudo leer la versión de la caja.</p>}
    </main>
  );
}
