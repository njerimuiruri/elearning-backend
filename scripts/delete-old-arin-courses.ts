// Run this script with: npx ts-node scripts/delete-old-arin-courses.ts
import { connect, connection } from 'mongoose';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/elearning'; // Update if needed

async function deleteOldArinCourses() {
  await connect(MONGO_URI);
  const Course = connection.collection('courses');
  const result = await Course.deleteMany({ category: 'Arin Publishing Academy' });
  console.log(`Deleted ${result.deletedCount} old Arin Publishing Academy courses.`);
  await connection.close();
}

deleteOldArinCourses().catch((err) => {
  console.error('Error deleting old courses:', err);
  process.exit(1);
});
