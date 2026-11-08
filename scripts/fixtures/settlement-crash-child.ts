import { readLiveRoom } from '../../backend/src/lib/live-rooms';
import { db } from '../../backend/src/lib/db';
import { isolatedDatabaseUrl } from '../lib/test-database.mjs';
isolatedDatabaseUrl(process.env.DATABASE_URL);
if (process.env.ELO_TEST_DATABASE !== '1') throw new Error('Isolated fixture only.');
try { await readLiveRoom(process.argv[2], process.argv[3]); }
finally { await db.$disconnect(); }
