// ─────────────────────────────────────────────────────────────────────────────
// MailAccountContext.jsx — contul Gmail conectat și starea sincronizării.
//
// Ce face, pe scurt: ține lista conturilor de mail conectate (în acest proiect,
// practic un singur cont Gmail), starea de sincronizare (`syncing`,
// `lastSync`) și expune funcția `sync()` pentru butonul "Sync now".
//
// Mecanismul "syncVersion": după un sync manual, sau după un poll în fundal
// care a găsit schimbări în cutia poștală, se incrementează `syncVersion`.
// Paginile (Dashboard, Inbox etc.) pun
// `syncVersion` în array-ul de dependențe al lui `useApi`, deci atunci când
// crește, TOATE se reîncarcă automat cu emailurile noi — un singur semnal
// reîmprospătează tot UI-ul, fără să fie nevoie ca paginile să comunice
// direct între ele.
//
// MailAccountProvider înfășoară doar zona logată (din AppShell), nu toată
// aplicația ca AuthProvider.
//
// Detalii: docs/architecture.md.
// ─────────────────────────────────────────────────────────────────────────────

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { getMailAccounts, syncMailAccount } from '@/api/mailAccountsApi';

// Contextul propriu-zis — accesat de obicei prin hook-ul useMailAccount() de mai jos.
const MailAccountContext = createContext(null);

// Backend-ul poate trimite id-ul fie ca `id`, fie ca `_id` (Mongo) — funcția
// de mai jos îl normalizează indiferent de formă.
const accountId = (account) => account?.id || account?._id;

// MailAccountProvider — furnizor: ține conturile de mail și starea sincronizării.
export function MailAccountProvider({ children }) {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  // Crescut după fiecare sincronizare cu succes, ca paginile să-și
  // reîncarce datele (vezi explicația "syncVersion" de mai sus).
  const [syncVersion, setSyncVersion] = useState(0);

  // reload — (re)încarcă lista conturilor de mail conectate din backend.
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getMailAccounts();
      const nextAccounts = Array.isArray(result) ? result : result?.items || [];
      setAccounts(nextAccounts);
      setError(null);
      return nextAccounts;
    } catch (err) {
      setError(err.message || 'Failed to load mail accounts.');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // La montarea Provider-ului, încărcăm o dată lista de conturi.
  // [reload] e stabil (memorat cu useCallback([])), deci efectul rulează o singură dată.
  useEffect(() => {
    reload();
  }, [reload]);

  // Pentru acest proiect există cel mult un cont Gmail conectat -> primul din listă.
  const account = accounts[0] || null;
  const isConnected = Boolean(account);

  // sync — singurul mod corect de a sincroniza: cheamă API-ul de sync pentru
  // contul curent, salvează rezultatul ca `lastSync`, reîncarcă lista de
  // conturi și incrementează `syncVersion` (reîncărcarea automată a paginilor).
  // `silent` is for the background poll below: it must not flip the Refresh
  // button into its busy state every 45 seconds, and it bumps `syncVersion`
  // only when the mailbox changed. Gmail's history id moves on any mailbox
  // change, including mail the server's own cron synced between two polls, so
  // an idle inbox no longer reruns every dashboard aggregation each tick.
  const sync = useCallback(async ({ silent = false } = {}) => {
    if (!account) return null;
    if (!silent) setSyncing(true);
    try {
      const result = await syncMailAccount(accountId(account));
      setLastSync(result);
      const refreshed = await reload();
      const mailboxChanged =
        refreshed?.[0]?.lastHistoryId !== account.lastHistoryId ||
        result?.insertedCount > 0 ||
        result?.updatedCount > 0;
      if (!silent || mailboxChanged) setSyncVersion((v) => v + 1);
      return result;
    } finally {
      if (!silent) setSyncing(false);
    }
  }, [account, reload]);

  // Auto-poll: acum că sincronizarea incrementală e ieftină (doar diff-ul de
  // istoric Gmail, nu tot inbox-ul), verificăm periodic dacă au apărut
  // emailuri noi, ca userul să nu mai fie nevoit să dea Refresh manual.
  // Se oprește când tab-ul e ascuns (economisește la baterie/rețea) și când
  // nu există un cont conectat.
  useEffect(() => {
    if (!isConnected) return undefined;

    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      sync({ silent: true }).catch(() => {});
    };

    const intervalId = setInterval(tick, 45_000);
    document.addEventListener('visibilitychange', tick);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [isConnected, sync]);

  // value e memorat cu useMemo: se recalculează doar când se schimbă efectiv
  // unul din câmpurile listate, ca să evităm re-render-uri inutile la
  // componentele care citesc acest context.
  const value = useMemo(
    () => ({
      accounts,
      account,
      isConnected,
      loading,
      error,
      syncing,
      lastSync,
      syncVersion,
      sync,
      reload,
    }),
    [accounts, account, isConnected, loading, error, syncing, lastSync, syncVersion, sync, reload]
  );

  return <MailAccountContext.Provider value={value}>{children}</MailAccountContext.Provider>;
}

// useMailAccount — hook pentru a citi contextul de mai sus. Aruncă o eroare
// clară dacă e folosit într-o componentă care nu e înfășurată în
// MailAccountProvider (ajută la depanare în timpul dezvoltării).
export function useMailAccount() {
  const context = useContext(MailAccountContext);
  if (!context) {
    throw new Error('useMailAccount must be used inside MailAccountProvider.');
  }
  return context;
}
