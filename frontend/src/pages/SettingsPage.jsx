// ─────────────────────────────────────────────────────────────────────────────
// SettingsPage.jsx — account, the mailbox being scanned, and when Barb
// reaches out. One column of sections; on wide screens each section puts its
// title and purpose on the left and its controls on the right.
//
// Switches commit immediately. Anything typed or picked shows a Save button
// the moment it differs from what is stored, and hides it again on save.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Minus, Plus } from 'lucide-react';

import { ConnectGmailButton } from '@/components/common/states';
import { PagePanel } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/hooks/useAuth';
import { useMailAccount } from '@/context/MailAccountContext';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { deleteMe, updateAiSettings, updateMe, updateNotificationSettings } from '@/api/usersApi';
import { disconnectMailAccount, updateMailAccountSettings } from '@/api/mailAccountsApi';
import { formatDateTime } from '@/utils/formatDate';
import { cn } from '@/lib/utils';

const accountId = (account) => account?.id || account?._id;

// The digest hour is stored in UTC; the picker shows local time.
const TZ_NAME = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const OFFSET_HOURS = Math.round(-new Date().getTimezoneOffset() / 60);
const utcToLocalHour = (utc) => (((Number(utc) + OFFSET_HOURS) % 24) + 24) % 24;
const localToUtcHour = (local) => (((Number(local) - OFFSET_HOURS) % 24) + 24) % 24;
const hourLabel = (h) => `${String(h).padStart(2, '0')}:00`;
const offsetLabel = OFFSET_HOURS === 0 ? 'UTC' : `UTC${OFFSET_HOURS > 0 ? '+' : '−'}${Math.abs(OFFSET_HOURS)}`;

/* ─── scaffolding ─────────────────────────────────────────────────────────── */

function Section({ title, purpose, danger = false, children }) {
  return (
    <section className={cn('card grid gap-4 p-5 md:grid-cols-[15rem_minmax(0,1fr)] md:gap-10 md:px-7 md:py-6', danger && 'shadow-[inset_0_0_0_1px_rgb(241_103_125_/_0.25)]')}>
      <div>
        <h2 className={cn('text-[0.9375rem] font-semibold', danger && 'text-destructive')}>{title}</h2>
        {purpose && <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted-foreground">{purpose}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function Row({ label, hint, children, first = false }) {
  return (
    <div className={cn('flex items-start justify-between gap-6 py-3', !first && 'border-t border-border')}>
      <div className="min-w-0">
        <p className="text-[0.9375rem]">{label}</p>
        {hint && <p className="mt-0.5 max-w-[48ch] text-[0.8125rem] leading-relaxed text-muted-foreground-subtle">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function ToggleRow({ id, label, hint, checked, disabled, onCheckedChange, first }) {
  return (
    <label htmlFor={id} className={cn('flex cursor-pointer items-start justify-between gap-6 py-3', !first && 'border-t border-border')}>
      <span className="min-w-0">
        <span className="block text-[0.9375rem]">{label}</span>
        {hint && <span className="mt-0.5 block max-w-[48ch] text-[0.8125rem] leading-relaxed text-muted-foreground-subtle">{hint}</span>}
      </span>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} className="mt-0.5 shrink-0" />
    </label>
  );
}

function SaveButton({ dirty, loading, onSave, children = 'Save' }) {
  if (!dirty) return null;
  return (
    <Button variant="primary" size="sm" onClick={onSave} disabled={loading}>
      {loading && <Loader2 className="animate-spin" />}
      {children}
    </Button>
  );
}

function NumberStepper({ id, value, onChange, min = 1, max = 50 }) {
  const num = Number(value);
  const step = 'focus-ring flex h-9 w-9 items-center justify-center rounded-[0.625rem] text-muted-foreground shadow-[inset_0_0_0_1px_var(--color-input)] hover:text-foreground disabled:opacity-35';
  return (
    <div className="flex items-center gap-1">
      <button type="button" aria-label="Fewer" className={step} disabled={num <= min} onClick={() => onChange(Math.max(num - 1, min))}>
        <Minus className="h-3.5 w-3.5" />
      </button>
      <Input id={id} type="number" min={min} max={max} value={value} onChange={(e) => onChange(e.target.value)} className="data w-14 text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
      <button type="button" aria-label="More" className={step} disabled={num >= max} onClick={() => onChange(Math.min(num + 1, max))}>
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/* ─── page ────────────────────────────────────────────────────────────────── */

export function SettingsPage() {
  const { user, patchUser, logout } = useAuth();
  const { account, isConnected, reload } = useMailAccount();

  const [name, setName] = useState(user?.name || '');
  const [maxResults, setMaxResults] = useState(account?.syncMaxResults ?? 10);
  const [digestHour, setDigestHour] = useState(user?.settings?.digestHour ?? 8);

  useEffect(() => {
    if (account?.syncMaxResults != null) setMaxResults(account.syncMaxResults);
  }, [account?.syncMaxResults]);
  useEffect(() => {
    if (user?.settings?.digestHour != null) setDigestHour(user.settings.digestHour);
  }, [user?.settings?.digestHour]);

  const aiEnabled = Boolean(user?.settings?.aiEnabled);
  const alertsEnabled = Boolean(user?.settings?.alertsEnabled);
  const digestEnabled = user?.settings?.digestEnabled !== false;
  const nameDirty = name.trim() !== (user?.name || '') && name.trim().length >= 2;
  const syncDirty = isConnected && Number(maxResults) !== account?.syncMaxResults;
  const digestHourDirty = digestHour !== (user?.settings?.digestHour ?? 8);

  const fail = (message) => (e) => toast.error(e?.message || message);

  const saveName = useAsyncAction(async () => {
    const updated = await updateMe({ name: name.trim() });
    patchUser({ name: updated.name });
    toast.success('Name saved');
  });
  const toggleAi = useAsyncAction(async (next) => {
    const result = await updateAiSettings(next);
    patchUser({ settings: { ...user?.settings, aiEnabled: result.aiEnabled } });
    toast.success(result.aiEnabled ? 'AI explanations on' : 'AI explanations off');
  });
  const toggleAlerts = useAsyncAction(async (next) => {
    const result = await updateNotificationSettings({ alertsEnabled: next });
    patchUser({ settings: { ...user?.settings, alertsEnabled: result.alertsEnabled } });
    toast.success(result.alertsEnabled ? 'Instant alerts on' : 'Instant alerts off');
  });
  const toggleDigest = useAsyncAction(async (next) => {
    const result = await updateNotificationSettings({ digestEnabled: next });
    patchUser({ settings: { ...user?.settings, digestEnabled: result.digestEnabled } });
    toast.success(result.digestEnabled ? 'Daily digest on' : 'Daily digest off');
  });
  const saveDigestHour = useAsyncAction(async () => {
    const result = await updateNotificationSettings({ digestHour });
    patchUser({ settings: { ...user?.settings, digestHour: result.digestHour } });
    toast.success('Digest time saved');
  });
  const saveSync = useAsyncAction(async () => {
    await updateMailAccountSettings(accountId(account), Number(maxResults));
    await reload();
    toast.success('Sync settings saved');
  });
  const disconnect = useAsyncAction(async () => {
    await disconnectMailAccount(accountId(account));
    await reload();
    toast.success('Gmail disconnected');
  });
  const deleteAccount = useAsyncAction(async () => {
    await deleteMe();
    toast.success('Your account has been deleted');
    logout();
  });

  const address = account?.accountEmail || account?.email;

  return (
    <PagePanel>
      <div className="mx-auto w-full max-w-[64rem] px-5 pb-12 pt-6 md:px-11 md:pt-9">
        <header>
          <h1 className="text-h1 font-medium">Settings</h1>
          <p className="mt-1 text-[0.9375rem] text-muted-foreground">Your account, your mailbox, and when Barb writes to you.</p>
        </header>

        <div className="mt-7 grid gap-4">
          <Section title="Profile" purpose="How Barb addresses you in the emails it sends.">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid content-start gap-1.5">
                <Label htmlFor="name">Name</Label>
                <div className="flex items-center gap-2">
                  <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
                  <SaveButton dirty={nameDirty} loading={saveName.loading} onSave={() => saveName.run().catch(fail('Could not save the name.'))} />
                </div>
              </div>
              <div className="grid content-start gap-1.5">
                <Label htmlFor="email">Sign-in email</Label>
                <Input id="email" value={user?.email || ''} disabled />
                <p className="text-[0.6875rem] text-muted-foreground-subtle">Set when the account was created.</p>
              </div>
            </div>
          </Section>

          <Section title="Gmail" purpose="The mailbox Barb scans. It never sends mail from your account; marking a message as phishing moves it to Spam.">
            {isConnected ? (
              <>
                <Row first label={address} hint={`Connected. Last synced ${formatDateTime(account.lastSyncedAt)}.`}>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="danger" size="sm" disabled={disconnect.loading}>
                        {disconnect.loading && <Loader2 className="animate-spin" />}
                        Disconnect
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Disconnect Gmail?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Stops syncing <span className="text-foreground">{address}</span> and deletes its stored Google tokens. Messages already synced stay here until you delete your account. You can reconnect at any time.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Keep connected</AlertDialogCancel>
                        <AlertDialogAction className="bg-destructive-strong text-destructive-foreground hover:bg-destructive-strong/90" onClick={() => disconnect.run().catch(fail('Could not disconnect.'))}>
                          Disconnect
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </Row>
                <Row label="Backfill page size" hint="Messages fetched per page while catching up on history. Ongoing sync does not use it. 1 to 50.">
                  <div className="flex items-center gap-2">
                    <NumberStepper id="maxResults" value={maxResults} onChange={setMaxResults} />
                    <SaveButton dirty={syncDirty} loading={saveSync.loading} onSave={() => saveSync.run().catch(fail('Could not save.'))} />
                  </div>
                </Row>
              </>
            ) : (
              <Row first label="No mailbox connected" hint="The briefing and the inbox stay empty until there is a mailbox to scan.">
                <ConnectGmailButton size="sm" />
              </Row>
            )}
          </Section>

          <Section title="Detection" purpose="Every message is scored by the built-in checks regardless. This only changes whether the reasoning is written out by the local model.">
            <ToggleRow first id="ai-toggle" label="AI explanations" hint="Adds a plain-language reading of each message on top of the deterministic rules. The model alone can never declare a message phishing." checked={aiEnabled} disabled={toggleAi.loading} onCheckedChange={(next) => toggleAi.run(next).catch(fail('Could not update.'))} />
          </Section>

          <Section title="Notifications" purpose="When Barb emails you.">
            <ToggleRow first id="alerts-toggle" label="Instant phishing alerts" hint="Sent the moment a sync turns up a likely phishing message." checked={alertsEnabled} disabled={toggleAlerts.loading} onCheckedChange={(next) => toggleAlerts.run(next).catch(fail('Could not update.'))} />
            <ToggleRow id="digest-toggle" label="Daily digest" hint="One summary a day. Nothing urgent waits for it." checked={digestEnabled} disabled={toggleDigest.loading} onCheckedChange={(next) => toggleDigest.run(next).catch(fail('Could not update.'))} />
            {digestEnabled && (
              <div className="border-t border-border py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p id="digest-hour-label" className="text-[0.8125rem]">
                    Digest arrives at <span className="data font-medium">{hourLabel(utcToLocalHour(digestHour))}</span>
                    <span className="text-[0.8125rem] text-muted-foreground-subtle"> · {TZ_NAME} ({offsetLabel})</span>
                  </p>
                  <SaveButton dirty={digestHourDirty} loading={saveDigestHour.loading} onSave={() => saveDigestHour.run().catch(fail('Could not save.'))}>
                    Save time
                  </SaveButton>
                </div>
                <div role="radiogroup" aria-labelledby="digest-hour-label" className="mt-3 grid grid-cols-8 gap-1 sm:grid-cols-12">
                  {Array.from({ length: 24 }, (_, h) => {
                    const isActive = utcToLocalHour(digestHour) === h;
                    return (
                      <button
                        key={h}
                        type="button"
                        role="radio"
                        aria-checked={isActive}
                        aria-label={hourLabel(h)}
                        onClick={() => setDigestHour(localToUtcHour(h))}
                        className={cn(
                          'data focus-ring flex h-8 items-center justify-center rounded-lg text-[0.8125rem] transition-colors',
                          isActive ? 'bg-primary font-medium text-primary-foreground' : 'text-muted-foreground hover:bg-white/[0.07] hover:text-foreground'
                        )}
                      >
                        {String(h).padStart(2, '0')}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </Section>

          <Section danger title="Delete account" purpose="Removes your profile, every synced message, every scan and your sender rules. No undo, no export. To withdraw Google access as well, remove Barb from your Google Account permissions.">
            <Row first label="You will be signed out immediately.">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="danger" size="sm" disabled={deleteAccount.loading}>
                    {deleteAccount.loading && <Loader2 className="animate-spin" />}
                    Delete account
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete your account?</AlertDialogTitle>
                    <AlertDialogDescription>This is permanent. Your profile, messages and scan results are deleted and cannot be recovered.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep my account</AlertDialogCancel>
                    <AlertDialogAction className="bg-destructive-strong text-destructive-foreground hover:bg-destructive-strong/90" onClick={() => deleteAccount.run().catch(fail('Could not delete the account.'))}>
                      Delete account
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </Row>
          </Section>
        </div>
      </div>
    </PagePanel>
  );
}

export default SettingsPage;
