"use client";

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, setAuth } from '@/lib/api';

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    try {
      const result = await apiFetch('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      setAuth(result.access_token, result.user);
      router.push('/groups');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Signup failed');
    }
  }

  return (
    <main className="page">
      <div className="card row">
        <h1>Sign up</h1>
        <form className="row" onSubmit={onSubmit}>
          <label className="field">
            <span>Email</span>
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
          </label>
          <label className="field">
            <span>Password</span>
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" required />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <button type="submit">Create account</button>
        </form>
        <a href="/login">Back to login</a>
      </div>
    </main>
  );
}