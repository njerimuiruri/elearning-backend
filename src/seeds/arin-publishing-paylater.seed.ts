/**
 * Seed pay-later test users for "ARIN Publishing Academy".
 *
 * Creates three users to cover all pay-later scenarios:
 *   1. Student    – pay-later enrolled, ID pending admin approval
 *   2. Non-Student – pay-later enrolled, no ID required
 *   3. Locked User – pay-later enrolled but locked by admin (access blocked)
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/seeds/arin-publishing-paylater.seed.ts
 *
 * Re-running is safe  updates existing users, does NOT create duplicate enrollments.
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import * as bcrypt from 'bcrypt';
import { Model, Types } from 'mongoose';
import { getModelToken } from '@nestjs/mongoose';
import { User, UserRole, UserType, StudentVerificationStatus } from '../schemas/user.schema';
import { Category } from '../schemas/category.schema';

const CATEGORY_NAME = 'Arin Publishing Academy';

const USERS = [
  {
    email:     'testpaylater-student@arin-africa.org',
    password:  'PayLater@Student1!',
    firstName: 'PayLater',
    lastName:  'Student',
    tier:      'student' as const,
    locked:    false,
    label:     'Student – pay-later, ID pending',
  },
  {
    email:     'testpaylater-nonstudent@arin-africa.org',
    password:  'PayLater@NonStudent1!',
    firstName: 'PayLater',
    lastName:  'NonStudent',
    tier:      'non-student' as const,
    locked:    false,
    label:     'Non-Student – pay-later, no ID required',
  },
  {
    email:     'testpaylater-locked@arin-africa.org',
    password:  'PayLater@Locked1!',
    firstName: 'PayLater',
    lastName:  'Locked',
    tier:      'non-student' as const,
    locked:    true,
    label:     'Locked User – pay-later, admin has blocked access',
  },
];

async function seedPayLaterUsers() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });

  const userModel     = app.get<Model<User>>(getModelToken(User.name));
  const categoryModel = app.get<Model<Category>>(getModelToken(Category.name));

  // ── 1. Find category ────────────────────────────────────────────────────────
  const category = await categoryModel.findOne({
    name: { $regex: new RegExp(CATEGORY_NAME, 'i') },
    isActive: true,
  }).sort({ createdAt: -1 });

  if (!category) {
    console.error(`\n❌  Category "${CATEGORY_NAME}" not found. Run categories.seed.ts first.\n`);
    await app.close();
    process.exit(1);
  }

  console.log(`✅  Category: "${category.name}" (${category._id})\n`);

  // ── 1b. Ensure category is configured ──────────────────────────────────────
  await categoryModel.findByIdAndUpdate(category._id, {
    hasTieredPricing: true,
    isPaid:           true,
    accessType:       'paid',
    studentPrice:     100,
    nonStudentPrice:  200,
  });

  const catObjId = new Types.ObjectId(String(category._id));

  // ── 2. Seed each user ───────────────────────────────────────────────────────
  for (const u of USERS) {
    console.log(`── Seeding: ${u.label}`);

    const hashedPassword = await bcrypt.hash(u.password, 10);

    // Verify bcrypt sanity
    if (!(await bcrypt.compare(u.password, hashedPassword))) {
      console.error(`❌  bcrypt sanity check failed for ${u.email}  aborting.`);
      await app.close();
      process.exit(1);
    }

    const payLaterEntry = {
      categoryId: catObjId,
      tier:       u.tier,
      enrolledAt: new Date(),
    };

    // Build the update: clear purchasedCategories, set payLaterEnrollments
    const update: Record<string, any> = {
      password:            hashedPassword,
      mustSetPassword:     false,
      isActive:            true,
      // Pay-later users have NO purchased access
      purchasedCategories: [],
    };

    // Student: set ID as pending so admin can see it in the verification queue
    if (u.tier === 'student') {
      update.studentVerification = {
        status:      StudentVerificationStatus.PENDING,
        submittedAt: new Date(),
        idUploadUrl: null,
        reviewedAt:  null,
        rejectionReason: null,
      };
      update.pendingStudentCategoryId = catObjId;
    }

    let user = await userModel.findOne({ email: u.email.toLowerCase() });

    if (user) {
      console.log(`   ℹ️  User exists  resetting to pay-later state.`);
      await userModel.findByIdAndUpdate(user._id, {
        $set: {
          ...update,
          // Replace payLaterEnrollments entirely for idempotency
          payLaterEnrollments: [payLaterEntry],
          // Apply or clear lock
          lockedFromCategories: u.locked ? [catObjId] : [],
        },
      });
      user = await userModel.findById(user._id);
    } else {
      user = await userModel.create({
        firstName:           u.firstName,
        lastName:            u.lastName,
        fullName:            `${u.firstName} ${u.lastName}`,
        email:               u.email.toLowerCase(),
        role:                UserRole.STUDENT,
        userType:            UserType.PUBLIC,
        emailVerified:       true,
        payLaterEnrollments: [payLaterEntry],
        lockedFromCategories: u.locked ? [catObjId] : [],
        ...update,
      });
      console.log(`   ✅  User created.`);
    }

    // Verify password saved correctly
    const saved = await userModel.findById(user!._id).select('+password');
    const loginWorks = await bcrypt.compare(u.password, saved!.password);
    if (!loginWorks) {
      console.error(`   ❌  Password mismatch for ${u.email}  login will fail!`);
    }

    console.log(`   📧  Email    : ${u.email}`);
    console.log(`   🔐  Password : ${u.password}`);
    console.log(`   🎓  Tier     : ${u.tier}`);
    console.log(`   🔒  Locked   : ${u.locked}`);
    console.log(`   🆔  User ID  : ${user!._id}`);
    console.log(`   ✔️   Password  : verified ✓`);
    console.log('');
  }

  // ── 3. Summary ──────────────────────────────────────────────────────────────
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅  Pay-Later seed complete');
  console.log('');
  console.log('Test accounts:');
  console.log('');
  for (const u of USERS) {
    const icon = u.locked ? '🔒' : u.tier === 'student' ? '🎓' : '💼';
    console.log(`  ${icon}  ${u.email}  /  ${u.password}`);
    console.log(`     → ${u.label}`);
  }
  console.log('');
  console.log('What to verify after seeding:');
  console.log('  • Student pay-later:     Module 1 accessible, Modules 2+ locked, ID "pending" in admin verification queue');
  console.log('  • Non-student pay-later: Module 1 accessible, Modules 2+ show "Pay to Unlock" modal');
  console.log('  • Locked user:           All modules blocked (admin locked), even Module 1');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  await app.close();
}

seedPayLaterUsers().catch((err) => {
  console.error('❌  Seed crashed:', err);
  process.exit(1);
});
