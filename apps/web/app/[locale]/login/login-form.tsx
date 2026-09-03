'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../../lib/supabase/client';

export default function LoginForm({
  locale,
  labels,
}: {
  locale: string;
  labels: { email: string; password: string; submit: string };
}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }
    router.push(`/${locale}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-lg border border-[var(--color-line)] bg-white p-5">
      <label className="block text-sm">
        <span className="text-[var(--color-muted)]">{labels.email}</span>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded border border-[var(--color-line)] px-2 py-1.5"
        />
      </label>
      <label className="block text-sm">
        <span className="text-[var(--color-muted)]">{labels.password}</span>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded border border-[var(--color-line)] px-2 py-1.5"
        />
      </label>
      {error ? <p className="text-sm text-[#b42318]">{error}</p> : null}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded bg-[var(--color-brand)] px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {labels.submit}
      </button>
    </form>
  );
}
