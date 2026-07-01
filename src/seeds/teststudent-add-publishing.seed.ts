/**
 * Seed: Add ARIN Publishing Academy (paid) access to the existing teststudent@arin.test account.
 *
 * This user is already enrolled in AI for Climate Resilience as a fellow.
 * This seed adds Publishing Academy to their purchasedCategories so they
 * can test both categories from one login.
 *
 * Tier  : student  →  $100 full payment
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/seeds/teststudent-add-publishing.seed.ts
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { Model, Types } from 'mongoose';
import * as crypto from 'crypto';
import { getModelToken } from '@nestjs/mongoose';
import { User } from '../schemas/user.schema';
import { Category } from '../schemas/category.schema';
import { Payment, PaymentStatus, PurchaseType } from '../payments/entities/payment.entity';

const TEST_EMAIL     = 'teststudent@arin.test';
const CATEGORY_NAME  = 'Arin Publishing Academy';
const PAYMENT_AMOUNT = 100;   // student full price
const USER_TIER      = 'student';

async function seed() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });

  const userModel     = app.get<Model<User>>(getModelToken(User.name));
  const categoryModel = app.get<Model<Category>>(getModelToken(Category.name));
  const paymentModel  = app.get<Model<Payment>>(getModelToken(Payment.name));

  // ── 1. Find the active Publishing Academy category ─────────────────────────
  const category = await categoryModel.findOne({
    name: { $regex: new RegExp(CATEGORY_NAME, 'i') },
    isActive: true,
  }).sort({ createdAt: -1 });

  if (!category) {
    console.error(`❌  Category "${CATEGORY_NAME}" not found or inactive.`);
    await app.close(); process.exit(1);
  }
  console.log(`✅  Category found: "${category.name}" (${category._id})`);

  // Ensure the category has tiered pricing configured
  await categoryModel.findByIdAndUpdate(category._id, {
    hasTieredPricing: true, isPaid: true, accessType: 'paid',
    studentPrice: 100, nonStudentPrice: 200,
  });
  console.log(`✅  Category pricing confirmed: student=$100 / non-student=$200`);

  // ── 2. Find the existing test student ──────────────────────────────────────
  const user = await userModel.findOne({ email: TEST_EMAIL.toLowerCase() });
  if (!user) {
    console.error(`❌  User "${TEST_EMAIL}" not found. Run the original seed first.`);
    await app.close(); process.exit(1);
  }
  console.log(`✅  User found: ${user.firstName} ${user.lastName} (${user._id})`);

  const categoryId = new Types.ObjectId(String(category._id));
  const userId     = new Types.ObjectId(String(user._id));

  // ── 3. Add Publishing Academy to purchasedCategories (if not already there) ─
  const alreadyPurchased = (user.purchasedCategories || []).some(
    (id) => id?.toString() === categoryId.toString(),
  );

  if (alreadyPurchased) {
    console.log(`ℹ️   Publishing Academy already in purchasedCategories — skipping update.`);
  } else {
    await userModel.findByIdAndUpdate(userId, {
      $addToSet: { purchasedCategories: categoryId },
    });
    console.log(`✅  Publishing Academy added to purchasedCategories.`);
  }

  // ── 4. Create payment record if one doesn't exist ─────────────────────────
  const existingPayment = await paymentModel.findOne({
    userId, categoryId, status: PaymentStatus.COMPLETED, isFullPayment: true,
  });

  if (existingPayment) {
    console.log(`ℹ️   Full payment record already exists — skipping.`);
  } else {
    const ref = `SEED-TS-PUB-${crypto.randomUUID().replace(/-/g, '').toUpperCase().slice(0, 10)}`;
    await paymentModel.create({
      userId, categoryId, amount: PAYMENT_AMOUNT,
      status: PaymentStatus.COMPLETED, paystackReference: ref,
      purchaseType: PurchaseType.CATEGORY_ACCESS,
      isFullPayment: true, isInstallment: false, userTier: USER_TIER,
      metadata: {
        seeded: true,
        note: 'teststudent-add-publishing.seed.ts',
        createdAt: new Date().toISOString(),
      },
    });
    console.log(`✅  Payment record created: $${PAYMENT_AMOUNT} full payment (${USER_TIER})`);
  }

  // ── 5. Summary ─────────────────────────────────────────────────────────────
  const updated = await userModel.findById(userId);
  console.log('');
  console.log('✅  teststudent updated successfully');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📧  Email               : ${TEST_EMAIL}`);
  console.log(`🔐  Password            : Test@1234`);
  console.log(`🆔  User ID             : ${user._id}`);
  console.log(`📂  fellowData category : AI for Climate Resilience (unchanged)`);
  console.log(`💳  Publishing Academy  : $${PAYMENT_AMOUNT} PAID ✓  (student tier)`);
  console.log(`📋  purchasedCategories : ${(updated?.purchasedCategories || []).map(id => id.toString()).join(', ')}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  await app.close();
}

seed().catch((err) => { console.error('❌  Seed crashed:', err); process.exit(1); });
