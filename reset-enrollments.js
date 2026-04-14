/**
 * reset-enrollments.js
 * Run: node reset-enrollments.js
 *
 * Deletes ALL module enrollments so you can re-test the enrollment flow from scratch.
 * Safe to run multiple times — idempotent.
 */

const { MongoClient, ObjectId } = require('mongodb');

const MONGO_URI = 'mongodb://localhost:27018';
const DB_NAME   = 'elearning';

async function main() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  console.log('Connected to MongoDB at', MONGO_URI);

  const db = client.db(DB_NAME);
  const enrollCol   = db.collection('moduleenrollments');
  const moduleCol   = db.collection('modules');

  // Show what we're about to delete
  const existing = await enrollCol.find({}).project({ _id: 1, studentId: 1, moduleId: 1, isCompleted: 1 }).toArray();
  console.log(`\nFound ${existing.length} enrollment(s):`);
  existing.forEach(e => {
    console.log(`  - enrollmentId: ${e._id}  student: ${e.studentId}  module: ${e.moduleId}  completed: ${e.isCompleted}`);
  });

  if (existing.length === 0) {
    console.log('\nNothing to delete. Already clean.');
    await client.close();
    return;
  }

  // Reset enrollmentCount on each affected module
  const moduleIds = [...new Set(existing.map(e => e.moduleId?.toString()).filter(Boolean))];
  for (const mid of moduleIds) {
    try {
      await moduleCol.updateOne(
        { _id: new ObjectId(mid) },
        { $set: { enrollmentCount: 0 } }
      );
    } catch (_) {}
  }

  // Delete all enrollments
  const result = await enrollCol.deleteMany({});
  console.log(`\n✅ Deleted ${result.deletedCount} enrollment(s). Database is now clean.`);
  console.log('You can now re-enroll as a student to test the full flow.\n');

  await client.close();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
