/**
 * Diagnostic: check enrollment + progression status for brendahmichira@gmail.com
 * READ-ONLY  makes no changes to the database.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/seeds/diagnose-student.seed.ts
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { Model, Types } from 'mongoose';
import { getModelToken } from '@nestjs/mongoose';
import { User } from '../schemas/user.schema';
import { Module, ModuleLevel, ModuleStatus } from '../schemas/module.schema';
import { ModuleEnrollment } from '../schemas/module-enrollment.schema';
import { StudentProgression } from '../schemas/student-progression.schema';
import { Category } from '../schemas/category.schema';

const TARGET_EMAIL   = 'brendahmichira@gmail.com';
const CATEGORY_NAME  = 'AI for Climate Resilience';

async function diagnose() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });

  const userModel        = app.get<Model<User>>(getModelToken(User.name));
  const moduleModel      = app.get<Model<Module>>(getModelToken(Module.name));
  const enrollmentModel  = app.get<Model<ModuleEnrollment>>(getModelToken(ModuleEnrollment.name));
  const progressionModel = app.get<Model<StudentProgression>>(getModelToken(StudentProgression.name));
  const categoryModel    = app.get<Model<Category>>(getModelToken(Category.name));

  // ── 1. Find user ──────────────────────────────────────────────────────────
  const user = await userModel.findOne({ email: TARGET_EMAIL.toLowerCase() }).lean();
  if (!user) {
    console.error(`❌  User "${TARGET_EMAIL}" not found.`);
    await app.close(); process.exit(1);
  }
  const userId = new Types.ObjectId(String(user._id));

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  USER');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`  Name    : ${(user as any).firstName} ${(user as any).lastName}`);
  console.log(`  Email   : ${(user as any).email}`);
  console.log(`  Role    : ${(user as any).role}`);
  console.log(`  Active  : ${(user as any).isActive}`);
  console.log(`  User ID : ${user._id}`);

  // ── 2. Find category ──────────────────────────────────────────────────────
  const category = await categoryModel.findOne({
    name: { $regex: new RegExp(CATEGORY_NAME, 'i') },
    isActive: true,
  }).sort({ createdAt: -1 }).lean();

  if (!category) {
    console.error(`❌  Category "${CATEGORY_NAME}" not found.`);
    await app.close(); process.exit(1);
  }
  const categoryId = new Types.ObjectId(String(category._id));
  console.log(`\n  Category: ${(category as any).name} (${category._id})`);

  // ── 3. Beginner modules published in this category ────────────────────────
  const beginnerModules = await moduleModel.find({
    categoryId,
    level: ModuleLevel.BEGINNER,
    status: ModuleStatus.PUBLISHED,
    isActive: true,
  }).select('_id title order').sort({ order: 1 }).lean();

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`  BEGINNER MODULES IN CATEGORY  (${beginnerModules.length} published)`);
  console.log('══════════════════════════════════════════════════════════════');
  for (const m of beginnerModules) {
    console.log(`  [${(m as any).order}] ${(m as any).title}  (${m._id})`);
  }

  // ── 4. Her enrollments on those beginner modules ──────────────────────────
  const beginnerIds = beginnerModules.map((m) => m._id);
  const enrollments = await enrollmentModel.find({
    studentId: userId,
    moduleId: { $in: beginnerIds },
  }).lean();

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`  BRENDAH'S BEGINNER ENROLLMENTS  (${enrollments.length} of ${beginnerModules.length})`);
  console.log('══════════════════════════════════════════════════════════════');

  let completedCount = 0;
  for (const bm of beginnerModules) {
    const enr = enrollments.find((e) => e.moduleId?.toString() === bm._id?.toString());
    if (!enr) {
      console.log(`  ❌  NOT ENROLLED : ${(bm as any).title}`);
    } else {
      const done = (enr as any).isCompleted;
      if (done) completedCount++;
      console.log(`  ${done ? '✅' : '🔄'}  ${done ? 'COMPLETED' : 'IN PROGRESS'} : ${(bm as any).title}  (progress=${(enr as any).progressPercentage ?? '?'}%)`);
    }
  }

  const allBeginnerDone = completedCount >= beginnerModules.length;
  console.log(`\n  Result: ${completedCount}/${beginnerModules.length} beginner modules completed`);
  console.log(`  Should have intermediate access? ${allBeginnerDone ? '✅ YES' : '❌ NO  not all beginner modules completed'}`);

  // ── 5. Progression document ───────────────────────────────────────────────
  const progression = await progressionModel.findOne({ studentId: userId, categoryId }).lean();

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  PROGRESSION DOCUMENT');
  console.log('══════════════════════════════════════════════════════════════');
  if (!progression) {
    console.log('  ⚠️   No progression document found for this student+category.');
    console.log('       This means intermediate will appear locked on the frontend.');
  } else {
    const lp: any[] = (progression as any).levelProgress || [];
    for (const l of lp) {
      console.log(`  ${l.level.padEnd(14)}: unlocked=${l.isUnlocked} | completed=${l.isCompleted} | completedModules=${l.completedModules}/${l.totalModules}`);
    }
    const intLevel = lp.find((l) => l.level === 'intermediate');
    if (intLevel && !intLevel.isUnlocked && allBeginnerDone) {
      console.log('\n  ⚠️   MISMATCH DETECTED:');
      console.log('       She has completed all beginner modules in the DB but the');
      console.log('       progression document still shows intermediate as LOCKED.');
      console.log('       → FIX: run the repair-progression seed for her account.');
    } else if (intLevel?.isUnlocked) {
      console.log('\n  ✅  Progression document correctly shows intermediate as UNLOCKED.');
      console.log('      The block may be on the frontend side  check UI lock logic.');
    }
  }

  console.log('\n══════════════════════════════════════════════════════════════\n');
  await app.close();
}

diagnose().catch((err) => { console.error('❌  Diagnostic crashed:', err); process.exit(1); });
