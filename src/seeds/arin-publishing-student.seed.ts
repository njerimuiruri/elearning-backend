/**
 * Seed a test student who has paid for "Arin Publishing Academy".
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/seeds/arin-publishing-student.seed.ts
 *
 * Re-running is safe — skips creation if email already exists
 * and still updates the purchasedCategories assignment.
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import * as bcrypt from 'bcrypt';
import { Model, Types } from 'mongoose';
import { getModelToken } from '@nestjs/mongoose';
import { User, UserRole, UserType } from '../schemas/user.schema';
import { Category } from '../schemas/category.schema';

// ── Credentials ───────────────────────────────────────────────────────────────
const STUDENT_EMAIL    = 'testpublishing@arin-africa.org';
const STUDENT_PASSWORD = 'Publishing@2024!';
const STUDENT_FIRST    = 'Test';
const STUDENT_LAST     = 'Publishing';
const CATEGORY_NAME    = 'Arin Publishing Academy';
// ──────────────────────────────────────────────────────────────────────────────

async function seedPublishingStudent() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });

  const userModel     = app.get<Model<User>>(getModelToken(User.name));
  const categoryModel = app.get<Model<Category>>(getModelToken(Category.name));

  // ── 1. Find the Arin Publishing Academy category ───────────────────────────
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

  // ── 1b. Ensure category is configured as a paid/tiered category ────────────
  if (!category.hasTieredPricing || !category.isPaid || category.accessType !== 'paid') {
    await categoryModel.findByIdAndUpdate(category._id, {
      hasTieredPricing: true,
      isPaid: true,
      accessType: 'paid',
    });
    console.log(`✅  Category updated: hasTieredPricing=true, isPaid=true, accessType=paid`);
  }

  // ── 2. Hash password ───────────────────────────────────────────────────────
  const hashedPassword = await bcrypt.hash(STUDENT_PASSWORD, 10);

  const check = await bcrypt.compare(STUDENT_PASSWORD, hashedPassword);
  if (!check) {
    console.error('❌  bcrypt sanity check failed — aborting.');
    await app.close();
    process.exit(1);
  }

  // ── 3. Create or update student ────────────────────────────────────────────
  const categoryId = new Types.ObjectId(String(category._id));
  let student      = await userModel.findOne({ email: STUDENT_EMAIL.toLowerCase() });

  if (student) {
    console.log(`ℹ️   Student already exists — updating password + category access.`);
    await userModel.findByIdAndUpdate(student._id, {
      password: hashedPassword,
      mustSetPassword: false,
      isActive: true,
      purchasedCategories: [categoryId],
    });
    student = await userModel.findById(student._id);
  } else {
    student = await userModel.create({
      firstName:           STUDENT_FIRST,
      lastName:            STUDENT_LAST,
      fullName:            `${STUDENT_FIRST} ${STUDENT_LAST}`,
      email:               STUDENT_EMAIL.toLowerCase(),
      password:            hashedPassword,
      role:                UserRole.STUDENT,
      userType:            UserType.PUBLIC,
      isActive:            true,
      emailVerified:       true,
      mustSetPassword:     false,
      purchasedCategories: [categoryId],
    });
  }

  // ── 4. Verify saved password matches ──────────────────────────────────────
  const saved      = await userModel.findById(student!._id).select('+password');
  const loginWorks = await bcrypt.compare(STUDENT_PASSWORD, saved!.password);

  if (!loginWorks) {
    console.error('\n❌  Password saved to DB does NOT match — login will fail!');
    await app.close();
    process.exit(1);
  }

  // ── 5. Report ──────────────────────────────────────────────────────────────
  console.log('');
  console.log('✅  Arin Publishing Academy test student seeded successfully');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📧  Email      : ${STUDENT_EMAIL}`);
  console.log(`🔐  Password   : ${STUDENT_PASSWORD}`);
  console.log(`📂  Category   : ${category.name}`);
  console.log(`🆔  User ID    : ${student!._id}`);
  console.log(`✔️   Login test : password verified against DB hash ✓`);
  console.log(`💳  Access     : purchasedCategories includes "${category.name}"`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  await app.close();
}

seedPublishingStudent().catch((err) => {
  console.error('❌  Seed crashed:', err);
  process.exit(1);
});
