"use client";

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch, clearAuth, getToken, Group } from '@/lib/api';

export default function GroupsPage() {
  const router = useRouter();
  const [groups, setGroups] = useState<Group[]>([]);
  const [name, setName] = useState('');
  const [joinGroupId, setJoinGroupId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    void refreshGroups();
  }, [router]);

  async function refreshGroups() {
    try {
      const data = await apiFetch('/api/groups/mine');
      setGroups(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to load groups');
    }
  }

  async function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    try {
      await apiFetch('/api/groups', {
        method: 'POST',
        body: JSON.stringify({ name })
      });
      setName('');
      await refreshGroups();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to create group');
    }
  }

  async function joinGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    try {
      await apiFetch(`/api/groups/${joinGroupId}/join`, { method: 'POST' });
      setJoinGroupId('');
      await refreshGroups();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to join group');
    }
  }

  function logout() {
    clearAuth();
    router.push('/login');
  }

  return (
    <main className="page">
      <div className="nav">
        <h1>My groups</h1>
        <button className="secondary" onClick={logout}>Log out</button>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <div className="two-col">
        <section className="card row">
          <h2>Create group</h2>
          <form className="row" onSubmit={createGroup}>
            <label className="field">
              <span>Name</span>
              <input value={name} onChange={(event) => setName(event.target.value)} required />
            </label>
            <button type="submit">Create</button>
          </form>
        </section>
        <section className="card row">
          <h2>Join group</h2>
          <form className="row" onSubmit={joinGroup}>
            <label className="field">
              <span>Group ID</span>
              <input value={joinGroupId} onChange={(event) => setJoinGroupId(event.target.value)} required />
            </label>
            <button type="submit">Join</button>
          </form>
        </section>
      </div>
      <section className="card row">
        <h2>Memberships</h2>
        {groups.length === 0 ? <p className="muted">No groups yet.</p> : null}
        {groups.map((group) => (
          <div key={group.id} className="card">
            <Link href={`/groups/${group.id}`}><strong>{group.name}</strong></Link>
            <div className="muted">{group.id}</div>
          </div>
        ))}
      </section>
    </main>
  );
}