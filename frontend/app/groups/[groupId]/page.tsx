"use client";

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch, getToken, Group, GroupMember, Resource } from '@/lib/api';

type Props = {
  params: { groupId: string };
};

export default function GroupDetailPage({ params }: Props) {
  const router = useRouter();
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [urlOrFileRef, setUrlOrFileRef] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    void refreshAll();
  }, [router, params.groupId]);

  async function refreshAll() {
    try {
      const [groupData, memberData, resourceData] = await Promise.all([
        apiFetch(`/api/groups/${params.groupId}`),
        apiFetch(`/api/groups/${params.groupId}/members`),
        apiFetch(`/api/groups/${params.groupId}/resources`),
      ]);
      setGroup(groupData);
      setMembers(memberData);
      setResources(resourceData);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to load group');
    }
  }

  async function submitResource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    try {
      await apiFetch(`/api/groups/${params.groupId}/resources`, {
        method: 'POST',
        body: JSON.stringify({ url_or_file_ref: urlOrFileRef, title, note: note || null })
      });
      setUrlOrFileRef('');
      setTitle('');
      setNote('');
      await refreshAll();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to upload resource');
    }
  }

  return (
    <main className="page row">
      <Link href="/groups">Back to groups</Link>
      {error ? <p className="error">{error}</p> : null}
      <section className="card row">
        <h1>{group?.name ?? 'Group'}</h1>
        <div className="muted">Group ID: {params.groupId}</div>
      </section>
      <div className="two-col">
        <section className="card row">
          <h2>Upload resource</h2>
          <form className="row" onSubmit={submitResource}>
            <label className="field">
              <span>URL or file reference</span>
              <input value={urlOrFileRef} onChange={(event) => setUrlOrFileRef(event.target.value)} required />
            </label>
            <label className="field">
              <span>Title</span>
              <input value={title} onChange={(event) => setTitle(event.target.value)} required />
            </label>
            <label className="field">
              <span>Note</span>
              <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={4} />
            </label>
            <button type="submit">Add resource</button>
          </form>
        </section>
        <section className="card row">
          <h2>Members</h2>
          {members.map((member) => (
            <div key={member.user_id} className="card">
              <strong>{member.email}</strong>
              <div className="muted">Joined {new Date(member.joined_at).toLocaleString()}</div>
            </div>
          ))}
        </section>
      </div>
      <section className="card row">
        <h2>Resources</h2>
        {resources.length === 0 ? <p className="muted">No resources yet.</p> : null}
        {resources.map((resource) => (
          <article key={resource.id} className="card">
            <strong>{resource.title}</strong>
            <div>{resource.url_or_file_ref}</div>
            {resource.note ? <p>{resource.note}</p> : null}
            <div className="muted">Status: {resource.status}</div>
          </article>
        ))}
      </section>
    </main>
  );
}