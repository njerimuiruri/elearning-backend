/**
 * Quick script to reset a fellow's password directly in MongoDB.
 * Usage: node scripts/reset-fellow-password.js <email> [newPassword]
 * Example: node scripts/reset-fellow-password.js siabisarah372@gmail.com
 */

const { MongoClient } = require('mongodb');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27018/elearning';

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: node scripts/reset-fellow-password.js <email> [newPassword]');
    process.exit(1);
  }

  const customPassword = process.argv[3];
  const tempPassword = customPassword || crypto.randomBytes(8).toString('hex');

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db();

  const user = await db.collection('users').findOne({ email: email.toLowerCase() });
  if (!user) {
    console.error(`No user found with email: ${email}`);
    await client.close();
    process.exit(1);
  }

  const hashedPassword = await bcrypt.hash(tempPassword, 10);
  await db.collection('users').updateOne(
    { _id: user._id },
    { $set: { password: hashedPassword, mustSetPassword: true } }
  );

  await client.close();

  console.log('\n✅ Password reset successfully');
  console.log('─────────────────────────────────');
  console.log(`Email:             ${email}`);
  console.log(`Temporary password: ${tempPassword}`);
  console.log('─────────────────────────────────');
  console.log('Share this password with the fellow.');
  console.log('They will be prompted to change it on first login.\n');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
