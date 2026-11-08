import { db } from '../backend/src/lib/db';
import { seedPracticeRoster } from '../backend/src/lib/practice-roster';
try {
  const result = await seedPracticeRoster(db);
  console.log(`Seeded ${result.count} missing simulated practice personas; real ranked players and results were unchanged.`);
} finally { await db.$disconnect(); }
