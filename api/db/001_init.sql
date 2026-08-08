create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists users_email_lower_unique
  on users (lower(email));

create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists groups_created_by_idx
  on groups (created_by);

create table if not exists group_members (
  group_id uuid not null references groups(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  role text not null default 'member',
  primary key (group_id, user_id)
);

-- If the table existed before this migration, ensure the new column exists
alter table group_members add column if not exists role text not null default 'member';

create index if not exists group_members_user_id_idx
  on group_members (user_id);

-- Ensure only one owner per group
create unique index if not exists group_owner_unique
  on group_members (group_id)
  where role = 'owner';


create table if not exists resources (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  uploaded_by uuid null references users(id) on delete set null,
  url_or_file_ref text not null,
  title text not null,
  note text,
  status text not null default 'processed',
  created_at timestamptz not null default now(),
  constraint resources_status_check check (status = 'processed')
);

create index if not exists resources_group_created_at_idx
  on resources (group_id, created_at desc);

create index if not exists resources_uploaded_by_idx
  on resources (uploaded_by);

create or replace function app_current_user_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

alter table groups enable row level security;
alter table group_members enable row level security;
alter table group_join_requests enable row level security;
alter table resources enable row level security;

alter table groups force row level security;
alter table group_members force row level security;
alter table group_join_requests force row level security;
alter table resources force row level security;

drop policy if exists groups_select_member on groups;
create policy groups_select_member
  on groups for select
  using (
    created_by = app_current_user_id()
    or exists (
      select 1
      from group_members gm
      where gm.group_id = groups.id
        and gm.user_id = app_current_user_id()
    )
  );

drop policy if exists groups_insert_creator on groups;
create policy groups_insert_creator
  on groups for insert
  with check (created_by = app_current_user_id());

drop policy if exists group_members_select_member on group_members;
create policy group_members_select_member
  on group_members for select
  using (
    exists (
      select 1
      from group_members gm2
      where gm2.group_id = group_members.group_id
        and gm2.user_id = app_current_user_id()
    )
  );

drop policy if exists group_members_insert_self on group_members;
drop policy if exists group_members_insert_control on group_members;
create policy group_members_insert_control
  on group_members for insert
  with check (
    -- allow the group creator to insert themselves as owner during group creation
    (role = 'owner' and user_id = app_current_user_id())
    -- or allow an existing admin/owner to insert approved members (member or admin)
    or (
      role in ('member','admin') and exists (
        select 1 from group_members gm
        where gm.group_id = group_members.group_id
          and gm.user_id = app_current_user_id()
          and gm.role in ('owner','admin')
      )
    )
  );

drop policy if exists resources_select_member on resources;
create policy resources_select_member
  on resources for select
  using (
    exists (
      select 1
      from group_members gm
      where gm.group_id = resources.group_id
        and gm.user_id = app_current_user_id()
    )
  );

drop policy if exists resources_insert_member on resources;
create policy resources_insert_member
  on resources for insert
  with check (
    uploaded_by = app_current_user_id()
    and exists (
      select 1
      from group_members gm
      where gm.group_id = resources.group_id
        and gm.user_id = app_current_user_id()
    )
  );

drop policy if exists resources_update_owner on resources;
create policy resources_update_owner
  on resources for update
  using (
    uploaded_by = app_current_user_id()
    or exists (
      select 1
      from group_members gm
      where gm.group_id = resources.group_id
        and gm.user_id = app_current_user_id()
        and gm.role in ('owner', 'admin')
    )
  )
  with check (
    uploaded_by is null
    or uploaded_by = app_current_user_id()
    or exists (
      select 1
      from group_members gm
      where gm.group_id = resources.group_id
        and gm.user_id = app_current_user_id()
        and gm.role in ('owner', 'admin')
    )
  );

drop policy if exists resources_delete_owner on resources;
create policy resources_delete_owner
  on resources for delete
  using (
    exists (
      select 1
      from group_members gm
      where gm.group_id = resources.group_id
        and gm.user_id = app_current_user_id()
        and gm.role in ('owner', 'admin')
    )
  );

-- -------------------------------
-- Join requests table + policies
-- -------------------------------
create table if not exists group_join_requests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  status text not null default 'pending', -- pending | approved | rejected
  requested_at timestamptz not null default now(),
  decided_by uuid null references users(id) on delete set null,
  decided_at timestamptz null
);

-- prevent duplicate pending requests for same user/group
create unique index if not exists group_join_requests_pending_unique
  on group_join_requests (group_id, user_id)
  where status = 'pending';

alter table group_join_requests enable row level security;
alter table group_join_requests force row level security;

drop policy if exists join_requests_insert_self on group_join_requests;
create policy join_requests_insert_self
  on group_join_requests for insert
  with check (user_id = app_current_user_id() and status = 'pending');

drop policy if exists join_requests_select_admin on group_join_requests;
create policy join_requests_select_admin
  on group_join_requests for select
  using (
    -- admins or owner of the group can view requests
    exists (
      select 1
      from group_members gm
      where gm.group_id = group_join_requests.group_id
        and gm.user_id = app_current_user_id()
        and gm.role in ('owner','admin')
    )
    or user_id = app_current_user_id() -- allow users to see their own requests
  );

drop policy if exists join_requests_update_admin on group_join_requests;
create policy join_requests_update_admin
  on group_join_requests for update
  using (
    exists (
      select 1
      from group_members gm
      where gm.group_id = group_join_requests.group_id
        and gm.user_id = app_current_user_id()
        and gm.role in ('owner','admin')
    )
  )
  with check (decided_by = app_current_user_id() and status in ('approved','rejected'));

drop policy if exists group_members_delete_self on group_members;
create policy group_members_delete_self
  on group_members for delete
  using (user_id = app_current_user_id());

drop policy if exists group_members_delete_admin on group_members;
create policy group_members_delete_admin
  on group_members for delete
  using (
    exists (
      select 1
      from group_members gm
      where gm.group_id = group_members.group_id
        and gm.user_id = app_current_user_id()
        and gm.role in ('owner', 'admin')
    )
  );

drop policy if exists group_members_update_admin on group_members;
create policy group_members_update_admin
  on group_members for update
  using (
    exists (
      select 1
      from group_members gm
      where gm.group_id = group_members.group_id
        and gm.user_id = app_current_user_id()
        and gm.role in ('owner', 'admin')
    )
  )
  with check (
    exists (
      select 1
      from group_members gm
      where gm.group_id = group_members.group_id
        and gm.user_id = app_current_user_id()
        and gm.role in ('owner', 'admin')
    )
  );

-- -------------------------------
-- Owner protection trigger
-- -------------------------------
create or replace function prevent_owner_demote_or_delete()
returns trigger
language plpgsql
stable
as $$
begin
  if (tg_op = 'UPDATE') then
    if (old.role = 'owner' and new.role <> 'owner' and current_setting('app.owner_transfer', true) is distinct from 'true') then
      raise exception 'the group owner cannot be demoted or removed';
    end if;
    return new;
  elsif (tg_op = 'DELETE') then
    if (old.role = 'owner') then
      raise exception 'the group owner cannot be demoted or removed';
    end if;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists prevent_owner_change on group_members;
create trigger prevent_owner_change
  before update or delete on group_members
  for each row execute function prevent_owner_demote_or_delete();
