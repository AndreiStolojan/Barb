import { useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  User,
  X,
} from 'lucide-react';

import { useAuth } from '@/hooks/useAuth';
import { ease } from '@/lib/motion';
import { cn } from '@/lib/utils';
import './LoginPage.css';

const THEME = {
  id: 'graphite',
  description: 'Your inbox should feel simple and safe. SecureInbox highlights what deserves your attention before you open, click, or reply.',
  loginKicker: 'Protected session',
  loginTitle: 'Return to your inbox',
  loginIntro: 'Continue to an AI-reviewed, sanitized view of every message.',
  submitLabel: 'Open protected inbox',
  registerLabel: 'Create protected account',
};

const SECURITY_BENEFITS = [
  'Spot suspicious emails before they catch you off guard',
  'Know which links and senders you can trust',
  'Stay focused with a clear next step for every message',
];

const PASSWORD_RULES = [
  { label: '8+ characters', test: (value) => value.length >= 8 },
  { label: 'Lowercase letter', test: (value) => /[a-z]/.test(value) },
  { label: 'Uppercase letter', test: (value) => /[A-Z]/.test(value) },
  { label: 'One number', test: (value) => /\d/.test(value) },
  { label: 'Special character', test: (value) => /[^A-Za-z\d]/.test(value) },
];

const modeTransition = {
  initial: { opacity: 0, y: 8, filter: 'blur(4px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  exit: { opacity: 0, y: -6, filter: 'blur(4px)' },
  transition: { duration: 0.24, ease },
};

const collapse = {
  initial: { opacity: 0, height: 0, y: -6 },
  animate: { opacity: 1, height: 'auto', y: 0 },
  exit: { opacity: 0, height: 0, y: -6 },
  transition: { duration: 0.28, ease },
};

function Field({ icon: Icon, id, label, type = 'text', trailing, ...props }) {
  return (
    <label className="si-field" htmlFor={id}>
      <span className="si-label">{label}</span>
      <span className="si-input-wrap">
        <Icon className="si-field-icon" aria-hidden="true" />
        <input id={id} type={type} {...props} />
        {trailing}
      </span>
    </label>
  );
}

export function LoginPage() {
  const { login, register, isAuthenticated, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || '/dashboard';

  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const theme = THEME;
  const passwordChecks = useMemo(
    () => PASSWORD_RULES.map((rule) => ({ ...rule, ok: rule.test(password) })),
    [password]
  );
  const passwordValid = passwordChecks.every((rule) => rule.ok);
  const strength = passwordChecks.filter((rule) => rule.ok).length;

  if (!loading && isAuthenticated) {
    return <Navigate to={from} replace />;
  }

  const toggleMode = () => {
    setIsRegistering((value) => !value);
    setPassword('');
    setConfirmPassword('');
    setError(null);
  };

  const updateField = (setter) => (event) => {
    setter(event.target.value);
    setError(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);

    if (!email.trim()) {
      setError('Enter your email.');
      return;
    }

    if (isRegistering) {
      if (name.trim().length < 2) {
        setError('Enter your full name.');
        return;
      }
      if (!passwordValid) {
        setError('Complete the password checks.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
    } else if (!password) {
      setError('Enter your password.');
      return;
    }

    setSubmitting(true);
    try {
      if (isRegistering) {
        await register({ name: name.trim(), email: email.trim(), password });
      } else {
        await login({ email: email.trim(), password });
      }
      navigate(from, { replace: true });
    } catch (authError) {
      const message = authError.message || '';

      if (/invalid (email|password)/i.test(message)) {
        setError('Email or password is incorrect.');
      } else if (/already|exists|duplicate/i.test(message)) {
        setError('An account already uses this email.');
      } else {
        setError(isRegistering ? 'Could not create the account.' : 'Could not sign you in.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main
      className={cn('si-auth', isRegistering && 'is-registering')}
      data-theme="graphite"
    >
      <div className="si-noise" aria-hidden="true" />
      <div className="si-theme-scene" aria-hidden="true">
        <div className="si-grid-layer" />
        <div className="si-orb si-orb-one" />
        <div className="si-orb si-orb-two" />
      </div>

      <header className="si-topbar">
        <div className="si-brand si-brand-code">
          <span className="si-code-logo">
            <strong>SecureInbox</strong>
          </span>
        </div>
      </header>

      <section className="si-stage">
        <div className="si-story">
          <h1>
            <span className="si-title-line">See the risk.</span>
            <span className="si-title-line">Keep moving.</span>
          </h1>
          <p className="si-description">{theme.description}</p>
          <ul className="si-benefits">
            {SECURITY_BENEFITS.map((benefit) => (
              <li key={benefit}>
                <Check aria-hidden="true" />
                <span>{benefit}</span>
              </li>
            ))}
          </ul>

        </div>

        <motion.section
          className="si-panel"
          initial={false}
          aria-labelledby="auth-title"
        >
          <div className="si-mode-tabs" role="group" aria-label="Authentication mode">
            <button
              type="button"
              aria-pressed={!isRegistering}
              className={!isRegistering ? 'is-active' : ''}
              onClick={() => isRegistering && toggleMode()}
            >
              Sign in
            </button>
            <button
              type="button"
              aria-pressed={isRegistering}
              className={isRegistering ? 'is-active' : ''}
              onClick={() => !isRegistering && toggleMode()}
            >
              Create account
            </button>
          </div>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={isRegistering ? 'register-copy' : 'login-copy'}
              className="si-panel-copy"
              {...modeTransition}
            >
              <p className="si-panel-kicker">
                {isRegistering ? 'Start a protected workspace' : theme.loginKicker}
              </p>
              <h2 id="auth-title">{isRegistering ? 'Create your account' : theme.loginTitle}</h2>
              <p className="si-panel-intro">
                {isRegistering
                  ? 'Set up your SecureInbox profile in a few seconds.'
                  : theme.loginIntro}
              </p>
            </motion.div>
          </AnimatePresence>

          <form className="si-form" onSubmit={handleSubmit}>
            <AnimatePresence initial={false}>
              {isRegistering && (
                <motion.div {...collapse} className="si-collapsible">
                  <Field
                    icon={User}
                    id="name"
                    label="Full name"
                    value={name}
                    onChange={updateField(setName)}
                    placeholder="Alex Morgan"
                    autoComplete="name"
                    disabled={submitting}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <Field
              icon={Mail}
              id="email"
              label="Email address"
              type="email"
              value={email}
              onChange={updateField(setEmail)}
              placeholder="name@company.com"
              autoComplete="email"
              disabled={submitting}
            />

            <Field
              icon={Lock}
              id="password"
              label="Password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={updateField(setPassword)}
              placeholder="Enter your password"
              autoComplete={isRegistering ? 'new-password' : 'current-password'}
              disabled={submitting}
              trailing={(
                <button
                  type="button"
                  className="si-reveal"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  disabled={submitting}
                >
                  {showPassword ? <EyeOff /> : <Eye />}
                </button>
              )}
            />

            <AnimatePresence initial={false}>
              {isRegistering && (
                <motion.div {...collapse} className="si-collapsible">
                  <Field
                    icon={Lock}
                    id="confirm-password"
                    label="Confirm password"
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={updateField(setConfirmPassword)}
                    placeholder="Repeat your password"
                    autoComplete="new-password"
                    disabled={submitting}
                    trailing={(
                      <button
                        type="button"
                        className="si-reveal"
                        onClick={() => setShowConfirmPassword((value) => !value)}
                        aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                        disabled={submitting}
                      >
                        {showConfirmPassword ? <EyeOff /> : <Eye />}
                      </button>
                    )}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence initial={false}>
              {isRegistering && (
                <motion.div {...collapse} className="si-collapsible">
                  <div className="si-password-status">
                    <div className="si-strength-head">
                      <span>Strong password</span>
                      <span>{strength}/5 checks</span>
                    </div>
                    <div className="si-strength-bars" aria-hidden="true">
                      {PASSWORD_RULES.map((rule, index) => (
                        <span key={rule.label} className={index < strength ? 'is-complete' : ''} />
                      ))}
                    </div>
                    <ul>
                      {passwordChecks.map((rule) => (
                        <li key={rule.label} className={rule.ok ? 'is-complete' : ''}>
                          <span aria-hidden="true">
                            {rule.ok ? <Check aria-hidden="true" /> : <X aria-hidden="true" />}
                          </span>
                          {rule.label}
                        </li>
                      ))}
                    </ul>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <motion.button
              className={cn('si-submit', !isRegistering && 'si-submit-login')}
              type="submit"
              whileTap={submitting ? undefined : { scale: 0.985 }}
              disabled={submitting || loading}
            >
              <span>
                {submitting
                  ? (isRegistering ? 'Creating account…' : 'Signing in…')
                  : (isRegistering ? theme.registerLabel : theme.submitLabel)}
              </span>
              {submitting && <Loader2 className="si-spinner" aria-hidden="true" />}
            </motion.button>

            <AnimatePresence>
              {error && (
                <motion.p
                  className="si-auth-error"
                  role="alert"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <span aria-hidden="true" />
                  <span>{error}</span>
                </motion.p>
              )}
            </AnimatePresence>
          </form>
        </motion.section>
      </section>

      <footer className="si-footer">
        <span>© {new Date().getFullYear()} SecureInbox</span>
        <span className="si-footer-line" />
        <span>Designed for clarity under pressure</span>
      </footer>
    </main>
  );
}
