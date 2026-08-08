export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

export type AuthPayload = {
  email: string;
  password: string;
};

export type Group = {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
};

export type Resource = {
  id: string;
  group_id: string;
  uploaded_by: string;
  url_or_file_ref: string;
  title: string;
  note: string | null;
  status: string;
  created_at: string;
};

export type GroupMember = {
  group_id: string;
  user_id: string;
  email: string;
  joined_at: string;
};

export function getToken() {
  if (typeof window === 'undefined') {
    return '';
  }
  return window.localStorage.getItem('crp_token') ?? '';
}

export function setAuth(accessToken: string, user: unknown) {
  window.localStorage.setItem('crp_token', accessToken);
  window.localStorage.setItem('crp_user', JSON.stringify(user));
}

export function clearAuth() {
  window.localStorage.removeItem('crp_token');
  window.localStorage.removeItem('crp_user');
}

export async function apiFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const token = getToken();
  headers.set('Content-Type', 'application/json');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
}