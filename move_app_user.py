import re

with open('api/db/001_init.sql', 'r') as f:
    content = f.read()

# Extract the app_user role block
role_block_regex = r"-- -------------------------------\n-- Application Runtime Role\n-- -------------------------------\n-- Explicitly DO NOT grant SUPERUSER or BYPASSRLS \(these are defaults for a new role,\n-- but stated here for unambiguous security intent\).\nDO \$\$\nBEGIN\n  IF NOT EXISTS \(SELECT FROM pg_catalog\.pg_roles WHERE rolname = 'app_user'\) THEN\n    CREATE ROLE app_user LOGIN PASSWORD 'app_password';\n  END IF;\nEND\n\$\$;\n\ngrant connect on database community_resource_db to app_user;\ngrant usage on schema public to app_user;\ngrant select, insert, update, delete on users, groups, group_members, group_join_requests, resources to app_user;\n"

match = re.search(role_block_regex, content)
if match:
    role_block = match.group(0)
    # Remove from original
    content = content.replace(role_block, "")
    # Insert right after `create extension if not exists pgcrypto;`
    content = content.replace("create extension if not exists pgcrypto;\n", "create extension if not exists pgcrypto;\n\n" + role_block)
    
    with open('api/db/001_init.sql', 'w') as f:
        f.write(content)
    print("Successfully moved app_user block")
else:
    print("Could not find app_user block")
