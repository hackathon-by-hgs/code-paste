'use client';

import { useState, type FormEvent } from 'react';
import { useAuth } from '../features/auth/AuthProvider';
import { isApiError, messageFor } from '../lib/errors';

const MIN_PASSWORD_LENGTH = 12;

type Mode = 'signin' | 'signup';

const inputClass =
  'bg-neutral-900 border border-white/40 text-white px-3 py-2 text-sm focus:outline-none focus:border-white w-full';

export const SignInPanel = () => {
  const { signIn, signUp, pending } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    try {
      if (mode === 'signin') {
        await signIn(email, password);
      } else {
        await signUp(email, password);
      }
    } catch (err) {
      if (isApiError(err)) {
        // `invalid_request` carries field-level detail; surface it on the field.
        if (err.code === 'invalid_request' && err.details.length > 0) {
          setFieldErrors(Object.fromEntries(err.details.map((d) => [d.path, d.message])));
          setError(null);
          return;
        }
        // The API will not say which half of the credentials was wrong. Do not guess.
        if (err.code === 'invalid_credentials') {
          setError('Email or password is incorrect.');
          return;
        }
        if (err.code === 'conflict') {
          setError('That email is already registered. Sign in instead.');
          return;
        }
        if (err.code === 'rate_limited') {
          const wait = err.retryAfter ? ` Try again in ${err.retryAfter}s.` : '';
          setError(`Too many attempts.${wait}`);
          return;
        }
      }
      setError(messageFor(err));
    }
  };

  const switchMode = () => {
    setMode((m) => (m === 'signin' ? 'signup' : 'signin'));
    setError(null);
    setFieldErrors({});
  };

  return (
    <div className="flex-1 flex items-center justify-center px-4 sm:px-8 py-16">
      <div className="w-full max-w-sm flex flex-col gap-6">
        <div className="border-b border-white/20 pb-3">
          <h2 className="text-sm font-bold uppercase tracking-widest text-neutral-400">
            {mode === 'signin' ? 'Sign In' : 'Create Account'}
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs uppercase tracking-widest text-neutral-400">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className={inputClass}
            />
            {fieldErrors.email && (
              <span className="text-xs text-red-400">{fieldErrors.email}</span>
            )}
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs uppercase tracking-widest text-neutral-400">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === 'signup' ? MIN_PASSWORD_LENGTH : undefined}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              className={inputClass}
            />
            {fieldErrors.password ? (
              <span className="text-xs text-red-400">{fieldErrors.password}</span>
            ) : (
              mode === 'signup' && (
                <span className="text-xs text-neutral-500">
                  At least {MIN_PASSWORD_LENGTH} characters. Length is the only rule.
                </span>
              )
            )}
          </label>

          {error && (
            <p role="alert" className="text-sm text-red-400 border-l-2 border-red-400 pl-3">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="bg-white hover:bg-neutral-200 text-black px-4 py-2 text-sm font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
          >
            {pending ? 'Working…' : mode === 'signin' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <button
          type="button"
          onClick={switchMode}
          className="text-xs text-neutral-400 hover:text-white underline underline-offset-4 self-start"
        >
          {mode === 'signin' ? 'Need an account? Create one' : 'Already have an account? Sign in'}
        </button>

        <p className="text-xs text-neutral-600 border-t border-white/10 pt-4">
          Sessions are held in memory only and are not written to browser storage, so reloading
          this page signs you out.
        </p>
      </div>
    </div>
  );
};
