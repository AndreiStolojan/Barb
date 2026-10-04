// ─────────────────────────────────────────────────────────────────────────────
// LoginPage.jsx — sign in / create account.
//
// Two columns. The left one shows what the product does with a single rendered
// verdict: one address, one score, three reasons. No slogans. The right one is
// the form. On narrow screens the verdict moves above the form.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Check, Eye, EyeOff, Loader2 } from 'lucide-react';

import { Mark } from '@/components/layout/Rail';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

const PASSWORD_RULES = [
  { label: 'At least 8 characters', test: (v) => v.length >= 8 },
  { label: 'A lowercase letter', test: (v) => /[a-z]/.test(v) },
  { label: 'An uppercase letter', test: (v) => /[A-Z]/.test(v) },
  { label: 'A number', test: (v) => /\d/.test(v) },
  { label: 'A symbol', test: (v) => /[^A-Za-z\d]/.test(v) },
];

/* A static rendering of one verdict: the product in one glance. */
function VerdictSample() {
  return (
    <figure className="w-full max-w-sm">
      <div className="border-t border-border-strong pt-4">
        <p className="text-[0.9375rem] font-medium leading-snug">Your account access has been limited</p>
        <p className="data mt-1.5 text-xs text-muted-foreground">security@paypa1-alerts.com</p>
      </div>

      <div className="mt-5 flex items-baseline gap-3">
        <span className="data text-[2.75rem] font-semibold leading-none text-risk-quarantine">87</span>
        <div>
          <p className="text-sm font-semibold text-risk-quarantine">Likely phishing</p>
          <p className="text-xs text-muted-foreground">3 rules fired · sender unverified</p>
        </div>
      </div>

      <ul className="mt-5 grid gap-2 text-[0.8125rem] leading-relaxed text-foreground/85">
        {[
          ['Lookalike domain', 'paypa1 uses the digit 1 where paypal has the letter l.'],
          ['Sender authentication failed', 'The domain rejects mail it did not send. This one failed.'],
          ['Pressures to act', 'A 24-hour deadline to “confirm billing details”.'],
        ].map(([rule, detail]) => (
          <li key={rule} className="grid grid-cols-[0.5rem_minmax(0,1fr)] items-baseline gap-2.5">
            <span aria-hidden="true" className="h-1.5 w-1.5 translate-y-[-1px] rounded-full bg-risk-quarantine" />
            <span>
              <span className="font-medium text-foreground">{rule}</span>
              <span className="block text-xs text-muted-foreground">{detail}</span>
            </span>
          </li>
        ))}
      </ul>
      <figcaption className="mt-5 border-t border-border pt-3 text-xs text-muted-foreground">
        Every verdict ships with its evidence. The link is disabled until you decide.
      </figcaption>
    </figure>
  );
}

function Field({ id, label, trailing, hint, ...props }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input id={id} className={cn('h-10 text-sm', trailing && 'pr-10')} {...props} />
        {trailing}
      </div>
      {hint}
    </div>
  );
}

function RevealButton({ shown, onToggle, disabled }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-label={shown ? 'Hide password' : 'Show password'}
      className="focus-ring absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
    >
      {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  );
}

export function LoginPage() {
  const { login, register, isAuthenticated, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || '/inbox';

  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const registering = mode === 'register';
  const checks = useMemo(() => PASSWORD_RULES.map((r) => ({ ...r, ok: r.test(password) })), [password]);
  const passwordValid = checks.every((r) => r.ok);

  if (!loading && isAuthenticated) return <Navigate to={from} replace />;

  const switchMode = (next) => {
    setMode(next);
    setPassword('');
    setConfirm('');
    setError(null);
  };

  const bind = (setter) => (e) => {
    setter(e.target.value);
    setError(null);
  };

  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    if (!email.trim()) return setError('Enter your email.');
    if (registering) {
      if (name.trim().length < 2) return setError('Enter your name.');
      if (!passwordValid) return setError('The password does not meet every rule yet.');
      if (password !== confirm) return setError('The passwords do not match.');
    } else if (!password) {
      return setError('Enter your password.');
    }

    setSubmitting(true);
    try {
      if (registering) await register({ name: name.trim(), email: email.trim(), password });
      else await login({ email: email.trim(), password });
      navigate(from, { replace: true });
    } catch (err) {
      const message = err.message || '';
      if (/invalid (email|password)/i.test(message)) setError('Email or password is incorrect.');
      else if (/already|exists|duplicate/i.test(message)) setError('An account already uses this email.');
      else setError(registering ? 'Could not create the account.' : 'Could not sign you in.');
    } finally {
      setSubmitting(false);
    }
    return undefined;
  };

  return (
    <main className="grid min-h-dvh grid-rows-[auto_1fr_auto] bg-background">
      <header className="flex items-center gap-2 px-6 py-5 md:px-10">
        <Mark className="h-5 w-5" />
        <span className="text-sm font-semibold">SecureInbox</span>
      </header>

      <div className="mx-auto grid w-full max-w-5xl items-center gap-12 px-6 py-8 md:grid-cols-[minmax(0,1fr)_22rem] md:gap-20 md:px-10">
        <section>
          <h1 className="max-w-md text-display font-semibold">Read the evidence before you read the mail.</h1>
          <p className="mt-4 max-w-md text-[0.9375rem] leading-relaxed text-muted-foreground">
            SecureInbox scans every Gmail message for sender identity, link and attachment risk, and
            manipulation patterns, then explains each verdict so you can decide in seconds.
          </p>
          <div className="mt-10">
            <VerdictSample />
          </div>
        </section>

        <section aria-labelledby="auth-title">
          <div role="tablist" aria-label="Sign in or create an account" className="mb-6 flex gap-5 border-b border-border">
            {[
              ['login', 'Sign in'],
              ['register', 'Create account'],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={mode === key}
                onClick={() => switchMode(key)}
                className={cn(
                  'focus-ring -mb-px border-b-2 pb-2.5 text-sm transition-colors',
                  mode === key ? 'border-foreground font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <h2 id="auth-title" className="sr-only">
            {registering ? 'Create account' : 'Sign in'}
          </h2>

          <form onSubmit={submit} className="grid gap-4" noValidate>
            {registering && (
              <Field id="name" label="Name" value={name} onChange={bind(setName)} autoComplete="name" placeholder="Your name" disabled={submitting} />
            )}
            <Field id="email" label="Email" type="email" value={email} onChange={bind(setEmail)} autoComplete="email" placeholder="you@example.com" disabled={submitting} />
            <Field
              id="password"
              label="Password"
              type={show ? 'text' : 'password'}
              value={password}
              onChange={bind(setPassword)}
              autoComplete={registering ? 'new-password' : 'current-password'}
              placeholder={registering ? 'Choose a password' : 'Your password'}
              disabled={submitting}
              trailing={<RevealButton shown={show} onToggle={() => setShow((v) => !v)} disabled={submitting} />}
              hint={
                registering && (
                  <ul className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    {checks.map((rule) => (
                      <li key={rule.label} className={cn('flex items-center gap-1.5', rule.ok ? 'text-foreground' : 'text-muted-foreground-subtle')}>
                        <Check className={cn('h-3 w-3', rule.ok ? 'opacity-100' : 'opacity-30')} aria-hidden="true" />
                        {rule.label}
                      </li>
                    ))}
                  </ul>
                )
              }
            />
            {registering && (
              <Field id="confirm" label="Confirm password" type={show ? 'text' : 'password'} value={confirm} onChange={bind(setConfirm)} autoComplete="new-password" placeholder="Repeat the password" disabled={submitting} />
            )}

            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}

            <Button type="submit" variant="primary" size="lg" className="mt-1 w-full" disabled={submitting || loading}>
              {submitting && <Loader2 className="animate-spin" />}
              {submitting ? (registering ? 'Creating account…' : 'Signing in…') : registering ? 'Create account' : 'Sign in'}
            </Button>
          </form>
        </section>
      </div>

      <footer className="flex items-center gap-3 px-6 py-5 text-xs text-muted-foreground-subtle md:px-10">
        <span>© {new Date().getFullYear()} SecureInbox</span>
        <span aria-hidden="true">·</span>
        <span>Read-only access to Gmail. Nothing is sent on your behalf.</span>
      </footer>
    </main>
  );
}
