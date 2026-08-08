import re

with open('api/db/001_init.sql', 'r') as f:
    content = f.read()

# 1. Insert the functions before RLS enabling
functions_sql = """
-- -------------------------------
-- SECURITY DEFINER functions to avoid RLS recursion
-- 
-- These functions are created to prevent infinite recursion (42P17) when evaluating RLS 
-- policies that need to check group_members. By running as SECURITY DEFINER, they 
-- execute with the privileges of their creator (postgres, a superuser), safely bypassing 
-- the RLS checks on group_members while checking if a user has a specific role.
-- -------------------------------
create or replace function is_group_member(check_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from group_members
    where group_id = check_group_id
      and user_id = app_current_user_id()
  );
$$;

create or replace function is_group_admin_or_owner(check_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from group_members
    where group_id = check_group_id
      and user_id = app_current_user_id()
      and role in ('owner', 'admin')
  );
$$;

revoke execute on function is_group_member(uuid) from public;
revoke execute on function is_group_admin_or_owner(uuid) from public;
grant execute on function is_group_member(uuid) to app_user;
grant execute on function is_group_admin_or_owner(uuid) to app_user;

"""

# Insert before "alter table groups enable row level security;"
content = content.replace("alter table groups enable row level security;", functions_sql + "alter table groups enable row level security;")


# 2. Replace policies
# groups_select_member
content = re.sub(
    r"create policy groups_select_member\s*on groups for select\s*using \([\s\S]*?\);\n",
    "create policy groups_select_member\n  on groups for select\n  using (created_by = app_current_user_id() or is_group_member(groups.id));\n",
    content
)

# group_members_select_member
content = re.sub(
    r"create policy group_members_select_member\s*on group_members for select\s*using \([\s\S]*?\);\n",
    "create policy group_members_select_member\n  on group_members for select\n  using (is_group_member(group_members.group_id));\n",
    content
)

# group_members_insert_control
new_insert = """create policy group_members_insert_control
  on group_members for insert
  with check (
    -- allow the group creator to insert themselves as owner during group creation
    (role = 'owner' and user_id = app_current_user_id())
    -- or allow an existing admin/owner to insert approved members (member or admin)
    or (
      role in ('member','admin') and is_group_admin_or_owner(group_members.group_id)
    )
  );
"""
content = re.sub(
    r"create policy group_members_insert_control\s*on group_members for insert\s*with check \([\s\S]*?\);\n",
    new_insert,
    content
)

# resources_select_member
content = re.sub(
    r"create policy resources_select_member\s*on resources for select\s*using \([\s\S]*?\);\n",
    "create policy resources_select_member\n  on resources for select\n  using (is_group_member(resources.group_id));\n",
    content
)

# resources_insert_member
new_res_insert = """create policy resources_insert_member
  on resources for insert
  with check (
    uploaded_by = app_current_user_id()
    and is_group_member(resources.group_id)
  );
"""
content = re.sub(
    r"create policy resources_insert_member\s*on resources for insert\s*with check \([\s\S]*?\);\n",
    new_res_insert,
    content
)

# resources_update_owner
new_res_update = """create policy resources_update_owner
  on resources for update
  using (
    uploaded_by = app_current_user_id()
    or is_group_admin_or_owner(resources.group_id)
  )
  with check (
    uploaded_by is null
    or uploaded_by = app_current_user_id()
    or is_group_admin_or_owner(resources.group_id)
  );
"""
content = re.sub(
    r"create policy resources_update_owner\s*on resources for update\s*using \([\s\S]*?with check \([\s\S]*?\);\n",
    new_res_update,
    content
)

# resources_delete_owner
content = re.sub(
    r"create policy resources_delete_owner\s*on resources for delete\s*using \([\s\S]*?\);\n",
    "create policy resources_delete_owner\n  on resources for delete\n  using (is_group_admin_or_owner(resources.group_id));\n",
    content
)

# join_requests_select_admin
new_jr_select = """create policy join_requests_select_admin
  on group_join_requests for select
  using (
    -- admins or owner of the group can view requests
    is_group_admin_or_owner(group_join_requests.group_id)
    or user_id = app_current_user_id() -- allow users to see their own requests
  );
"""
content = re.sub(
    r"create policy join_requests_select_admin\s*on group_join_requests for select\s*using \([\s\S]*?\);\n",
    new_jr_select,
    content
)

# join_requests_update_admin
new_jr_update = """create policy join_requests_update_admin
  on group_join_requests for update
  using (is_group_admin_or_owner(group_join_requests.group_id))
  with check (decided_by = app_current_user_id() and status in ('approved','rejected'));
"""
content = re.sub(
    r"create policy join_requests_update_admin\s*on group_join_requests for update\s*using \([\s\S]*?with check \([\s\S]*?\);\n",
    new_jr_update,
    content
)

# group_members_delete_admin
content = re.sub(
    r"create policy group_members_delete_admin\s*on group_members for delete\s*using \([\s\S]*?\);\n",
    "create policy group_members_delete_admin\n  on group_members for delete\n  using (is_group_admin_or_owner(group_members.group_id));\n",
    content
)

# group_members_update_admin
new_gm_update = """create policy group_members_update_admin
  on group_members for update
  using (is_group_admin_or_owner(group_members.group_id))
  with check (is_group_admin_or_owner(group_members.group_id));
"""
content = re.sub(
    r"create policy group_members_update_admin\s*on group_members for update\s*using \([\s\S]*?with check \([\s\S]*?\);\n",
    new_gm_update,
    content
)

with open('api/db/001_init.sql', 'w') as f:
    f.write(content)
