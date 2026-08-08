import { Client } from 'pg';

async function run() {
  const dbUrl = 'postgresql://app_user:app_password@localhost:5432/community_resource_db';
  const migUrl = 'postgresql://postgres:postgres@localhost:5432/community_resource_db';

  const migDb = new Client({ connectionString: migUrl });
  await migDb.connect();
  
  console.log("Checking group_members with migration client...");
  const res = await migDb.query('SELECT count(*) FROM group_members');
  console.log("Count:", res.rows[0].count);

  await migDb.end();
}

run().catch(console.error);
