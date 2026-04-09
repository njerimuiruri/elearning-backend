/**
 * Run this ONCE on the production server to create the first admin user.
 *
 * Usage:
 *   cd /path/to/elearning-backend
 *   npx ts-node scripts/seed-admin.ts
 *
 * It reads MONGODB_URI, ADMIN_EMAIL, and ADMIN_PASSWORD from the .env file.
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import * as bcrypt from 'bcrypt';

const MONGODB_URI = process.env.MONGODB_URI;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@arin-africa.org';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ChangeMe@2024!';

if (!MONGODB_URI) {
  console.error('❌  MONGODB_URI is not set');
  process.exit(1);
}

const UserSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    firstName: { type: String, default: 'Admin' },
    lastName: { type: String, default: 'User' },
    role: { type: String, default: 'admin' },
    isActive: { type: Boolean, default: true },
    mustSetPassword: { type: Boolean, default: false },
  },
  { timestamps: true },
);

async function run() {
  await mongoose.connect(MONGODB_URI!, { dbName: 'elearning' });
  console.log('✅  Connected to MongoDB');

  const User = mongoose.model('User', UserSchema);

  const existing = await User.findOne({ email: ADMIN_EMAIL });
  if (existing) {
    console.log(`ℹ️  Admin with email "${ADMIN_EMAIL}" already exists — skipping.`);
    await mongoose.disconnect();
    return;
  }

  const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);
  await User.create({
    email: ADMIN_EMAIL,
    password: hashedPassword,
    firstName: 'Admin',
    lastName: 'User',
    role: 'admin',
    isActive: true,
    mustSetPassword: false,
  });

  console.log(`✅  Admin user created: ${ADMIN_EMAIL}`);
  console.log(`⚠️  Change this password immediately after logging in!`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('❌  Seed failed:', err);
  process.exit(1);
});
