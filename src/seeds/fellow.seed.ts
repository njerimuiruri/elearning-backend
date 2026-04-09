/**
 * Seed a test fellow (admin-created student) for production login testing.
 *
 * Usage — run once on the production server:
 *   cd /path/to/elearning-backend
 *   npx ts-node -r tsconfig-paths/register src/seeds/fellow.seed.ts
 *
 * Credentials printed to console after success. Change password after first login.
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import * as bcrypt from 'bcrypt';
import { Model } from 'mongoose';
import { getModelToken } from '@nestjs/mongoose';
import { User, UserRole, FellowshipStatus } from '../schemas/user.schema';

// ── Customise these before running ────────────────────────────────────────────
const FELLOW_EMAIL = 'testfellow@arin-africa.org';
const FELLOW_PASSWORD = 'Fellow@2024!';
const FELLOW_FIRST_NAME = 'Test';
const FELLOW_LAST_NAME = 'Fellow';
// ──────────────────────────────────────────────────────────────────────────────

async function seedFellow() {
  const app = await NestFactory.create(AppModule, { logger: ['error'] });

  let userModel: Model<User>;
  try {
    userModel = app.get<Model<User>>(getModelToken(User.name));
  } catch {
    console.error('❌  Could not get User model — check AppModule imports.');
    await app.close();
    process.exit(1);
  }

  try {
    const existing = await userModel.findOne({ email: FELLOW_EMAIL });
    if (existing) {
      console.log(`ℹ️  Fellow already exists: ${FELLOW_EMAIL}`);
      console.log(`   Role      : ${existing.role}`);
      console.log(`   userType  : ${existing.userType}`);
      console.log(`   isActive  : ${existing.isActive}`);
      await app.close();
      return;
    }

    const hashedPassword = await bcrypt.hash(FELLOW_PASSWORD, 10);
    const fellowId = `FELLOW-SEED-${Date.now()}`;

    const fellow = await userModel.create({
      firstName: FELLOW_FIRST_NAME,
      lastName: FELLOW_LAST_NAME,
      fullName: `${FELLOW_FIRST_NAME} ${FELLOW_LAST_NAME}`,
      email: FELLOW_EMAIL,
      password: hashedPassword,
      role: UserRole.STUDENT,
      userType: 'fellow',
      isActive: true,
      emailVerified: true,
      mustSetPassword: false,   // set true if you want to test forced-password-change flow
      invitationEmailSent: false,
      fellowData: {
        fellowId,
        cohort: new Date().getFullYear().toString(),
        deadline: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        requiredCourses: [],
        fellowshipStatus: FellowshipStatus.ACTIVE,
        assignedCategories: [],
        region: 'Test Region',
        track: 'Test Track',
      },
    });

    console.log('');
    console.log('✅  Fellow created successfully');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📧  Email    : ${FELLOW_EMAIL}`);
    console.log(`🔐  Password : ${FELLOW_PASSWORD}`);
    console.log(`🆔  User ID  : ${fellow._id}`);
    console.log(`👤  Role     : ${fellow.role}  (userType: fellow)`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('⚠️   Change the password after your first login.');
    console.log('');
  } catch (error) {
    console.error('❌  Seeding failed:', error.message);
  } finally {
    await app.close();
  }
}

seedFellow().catch((err) => {
  console.error(err);
  process.exit(1);
});
