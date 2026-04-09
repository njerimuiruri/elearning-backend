/**
 * Seed a test fellow assigned to "AI for Climate Resilience".
 *
 * Usage on the production server:
 *   cd /path/to/elearning-backend
 *   npx ts-node -r tsconfig-paths/register src/seeds/fellow.seed.ts
 *
 * Re-running is safe — it skips creation if the email already exists
 * and still updates the category assignment.
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import * as bcrypt from 'bcrypt';
import { Model, Types } from 'mongoose';
import { getModelToken } from '@nestjs/mongoose';
import { User, UserRole, FellowshipStatus } from '../schemas/user.schema';
import { Category } from '../schemas/category.schema';

// ── Credentials ───────────────────────────────────────────────────────────────
const FELLOW_EMAIL     = 'testfellow@arin-africa.org';
const FELLOW_PASSWORD  = 'Fellow@2024!';
const FELLOW_FIRST     = 'Test';
const FELLOW_LAST      = 'Fellow';
const CATEGORY_NAME    = 'AI for Climate Resilience';
// ──────────────────────────────────────────────────────────────────────────────

async function seedFellow() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });

  const userModel     = app.get<Model<User>>(getModelToken(User.name));
  const categoryModel = app.get<Model<Category>>(getModelToken(Category.name));

  // ── 1. Find the category ───────────────────────────────────────────────────
  const category = await categoryModel.findOne({
    name: { $regex: new RegExp(CATEGORY_NAME, 'i') },
  });

  if (!category) {
    console.error(`\n❌  Category "${CATEGORY_NAME}" not found in the database.`);
    console.error(`   Run the categories seed first:`);
    console.error(`   npx ts-node -r tsconfig-paths/register src/seeds/categories.seed.ts\n`);
    await app.close();
    process.exit(1);
  }

  console.log(`✅  Category found: "${category.name}" (${category._id})`);

  // ── 2. Hash password ───────────────────────────────────────────────────────
  const hashedPassword = await bcrypt.hash(FELLOW_PASSWORD, 10);

  // Quick sanity-check — confirm bcrypt works before saving
  const check = await bcrypt.compare(FELLOW_PASSWORD, hashedPassword);
  if (!check) {
    console.error('❌  bcrypt sanity check failed — password will not match at login. Aborting.');
    await app.close();
    process.exit(1);
  }

  // ── 3. Create or update fellow ─────────────────────────────────────────────
  const categoryId  = new Types.ObjectId(String(category._id));
  let   fellow      = await userModel.findOne({ email: FELLOW_EMAIL.toLowerCase() });

  if (fellow) {
    console.log(`ℹ️   Fellow already exists — updating password + category assignment.`);
    await userModel.findByIdAndUpdate(fellow._id, {
      password: hashedPassword,
      mustSetPassword: false,
      isActive: true,
      purchasedCategories: [categoryId],
      'fellowData.assignedCategories': [categoryId],
    });
    fellow = await userModel.findById(fellow._id);
  } else {
    fellow = await userModel.create({
      firstName:  FELLOW_FIRST,
      lastName:   FELLOW_LAST,
      fullName:   `${FELLOW_FIRST} ${FELLOW_LAST}`,
      email:      FELLOW_EMAIL.toLowerCase(),
      password:   hashedPassword,
      role:       UserRole.STUDENT,
      userType:   'fellow',
      isActive:   true,
      emailVerified:     true,
      mustSetPassword:   false,
      invitationEmailSent: false,
      purchasedCategories: [categoryId],
      fellowData: {
        fellowId:          `FELLOW-SEED-${Date.now()}`,
        cohort:            new Date().getFullYear().toString(),
        deadline:          new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        requiredCourses:   [],
        fellowshipStatus:  FellowshipStatus.ACTIVE,
        assignedCategories: [categoryId],
        region: 'Test Region',
        track:  'Test Track',
      },
    });
  }

  // ── 4. Verify the saved password matches before reporting success ──────────
  const saved = await userModel.findById(fellow!._id).select('+password');
  const loginWorks = await bcrypt.compare(FELLOW_PASSWORD, saved!.password);

  if (!loginWorks) {
    console.error('\n❌  Password saved to DB does NOT match — login will fail!');
    console.error('   This usually means another pre-save hook is re-hashing the password.');
    await app.close();
    process.exit(1);
  }

  // ── 5. Report ──────────────────────────────────────────────────────────────
  console.log('');
  console.log('✅  Fellow seeded and verified successfully');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📧  Email      : ${FELLOW_EMAIL}`);
  console.log(`🔐  Password   : ${FELLOW_PASSWORD}`);
  console.log(`📂  Category   : ${category.name}`);
  console.log(`🆔  User ID    : ${fellow!._id}`);
  console.log(`✔️   Login test : password verified against DB hash ✓`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  await app.close();
}

seedFellow().catch((err) => {
  console.error('❌  Seed crashed:', err);
  process.exit(1);
});
