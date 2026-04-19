/**
 * Migration: Migrate Lesson Completions to Append-Only Collection
 * Date: 2026-04-15
 *
 * The lesson progression system was redesigned to store completions in a
 * dedicated `lessoncompletions` collection instead of a mutable flag inside
 * the `moduleenrollments` document.
 *
 * This script reads every enrollment's `lessonProgress[].isCompleted` flag
 * and creates the corresponding `LessonCompletion` record so existing
 * students don't lose their progress.
 *
 * Safe to run multiple times — uses upsert so it won't duplicate records.
 *
 * Run with:
 *   npx ts-node -r tsconfig-paths/register src/migrations/002-migrate-lesson-completions.ts
 */

import { config } from 'dotenv';
import { MongoClient, ObjectId } from 'mongodb';

config();

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');

  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db('elearning');

    const enrollments = db.collection('moduleenrollments');
    const completions = db.collection('lessoncompletions');

    // Ensure the unique index exists before inserting
    await completions.createIndex(
      { enrollmentId: 1, lessonIndex: 1, repeatGeneration: 1 },
      { unique: true },
    );

    let totalMigrated = 0;
    let totalSkipped = 0;
    let totalEnrollments = 0;

    const cursor = enrollments.find(
      { 'lessonProgress.0': { $exists: true } }, // only enrollments that have lesson progress
    );

    for await (const enrollment of cursor) {
      totalEnrollments++;
      const generation = enrollment.moduleRepeatGeneration ?? 0;

      for (const lp of enrollment.lessonProgress || []) {
        if (!lp.isCompleted) continue;

        try {
          await completions.updateOne(
            {
              enrollmentId: enrollment._id,
              lessonIndex: lp.lessonIndex,
              repeatGeneration: generation,
            },
            {
              $setOnInsert: {
                enrollmentId: enrollment._id,
                studentId: enrollment.studentId,
                moduleId: enrollment.moduleId,
                lessonIndex: lp.lessonIndex,
                repeatGeneration: generation,
                completedAt: lp.completedAt ?? enrollment.updatedAt ?? new Date(),
                createdAt: new Date(),
              },
            },
            { upsert: true },
          );
          totalMigrated++;
        } catch (err: any) {
          if (err.code === 11000) {
            // Duplicate key — record already exists, skip
            totalSkipped++;
          } else {
            console.error(
              `  ✗ Failed for enrollment ${enrollment._id}, lesson ${lp.lessonIndex}:`,
              err.message,
            );
          }
        }
      }
    }

    console.log('\n✅ Migration complete');
    console.log(`   Enrollments processed : ${totalEnrollments}`);
    console.log(`   Completion records created : ${totalMigrated}`);
    console.log(`   Already existed (skipped) : ${totalSkipped}`);
  } finally {
    await client.close();
  }
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
