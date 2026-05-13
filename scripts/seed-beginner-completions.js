/**
 * seed-beginner-completions.js
 *
 * Marks all beginner modules as completed for a specific student so that
 * the intermediate level unlock can be tested.
 *
 * Run: node scripts/seed-beginner-completions.js
 */

const { MongoClient, ObjectId } = require('mongodb');

const MONGO_URI = 'mongodb://localhost:27018';
const DB_NAME   = 'elearning';
const TARGET_EMAIL = 'faith.muiruri@strathmore.edu';

async function main() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  console.log('Connected to MongoDB at', MONGO_URI);

  const db = client.db(DB_NAME);
  const usersCol       = db.collection('users');
  const modulesCol     = db.collection('modules');
  const enrollCol      = db.collection('moduleenrollments');
  const progressionCol = db.collection('studentprogressions');

  // ── 1. Find the student ────────────────────────────────────────────────────
  const user = await usersCol.findOne({ email: TARGET_EMAIL });
  if (!user) {
    console.error(`❌ No user found with email: ${TARGET_EMAIL}`);
    await client.close();
    process.exit(1);
  }
  console.log(`\n✅ Found user: ${user.firstName} ${user.lastName} (${user._id})`);

  // ── 2. Find all published+active beginner modules ─────────────────────────
  const beginnerModules = await modulesCol
    .find({ level: 'beginner', status: 'published', isActive: true })
    .project({ _id: 1, title: 1, categoryId: 1, order: 1 })
    .sort({ categoryId: 1, order: 1 })
    .toArray();

  if (beginnerModules.length === 0) {
    console.error('❌ No published+active beginner modules found.');
    await client.close();
    process.exit(1);
  }

  console.log(`\nFound ${beginnerModules.length} beginner module(s):`);
  beginnerModules.forEach(m =>
    console.log(`  - [${m._id}] order=${m.order ?? '?'} "${m.title}" (category: ${m.categoryId})`)
  );

  // ── 3. Upsert completed enrollment for each beginner module ───────────────
  console.log('\nUpserting enrollments...');
  const now = new Date();

  for (const mod of beginnerModules) {
    const filter = {
      studentId: user._id,
      moduleId:  mod._id,
    };

    const existing = await enrollCol.findOne(filter);

    if (existing) {
      if (existing.isCompleted) {
        console.log(`  ⏭  Already completed: "${mod.title}"`);
      } else {
        await enrollCol.updateOne(filter, {
          $set: {
            isCompleted:          true,
            completedAt:          now,
            progress:             100,
            finalAssessmentPassed: true,
          },
        });
        console.log(`  ✏️  Updated to completed: "${mod.title}"`);
      }
    } else {
      await enrollCol.insertOne({
        studentId:             user._id,
        moduleId:              mod._id,
        isCompleted:           true,
        completedAt:           now,
        progress:              100,
        totalLessons:          0,
        completedLessons:      0,
        lessonProgress:        [],
        finalAssessmentPassed: true,
        createdAt:             now,
        updatedAt:             now,
      });
      console.log(`  ➕ Created completed enrollment: "${mod.title}"`);
    }
  }

  // ── 4. Repair/upsert progression document ─────────────────────────────────
  // Group modules by category (there may be multiple categories)
  const categoryIds = [...new Set(beginnerModules.map(m => m.categoryId.toString()))];
  console.log(`\nRepairing progression for ${categoryIds.length} category(ies)...`);

  for (const catIdStr of categoryIds) {
    const catId = new ObjectId(catIdStr);
    const catBeginnerModules = beginnerModules.filter(m => m.categoryId.toString() === catIdStr);

    const progression = await progressionCol.findOne({
      studentId:  user._id,
      categoryId: catId,
    });

    if (progression) {
      // Update in place
      const levelProgress = progression.levelProgress || [];

      const begEntry = levelProgress.find(lp => lp.level === 'beginner');
      const intEntry = levelProgress.find(lp => lp.level === 'intermediate');

      if (begEntry) {
        begEntry.completedModules = catBeginnerModules.length;
        begEntry.totalModules     = catBeginnerModules.length;
        begEntry.isCompleted      = true;
        begEntry.completedAt      = now;
      }
      if (intEntry) {
        intEntry.isUnlocked  = true;
        intEntry.unlockedAt  = now;
      }

      await progressionCol.updateOne(
        { _id: progression._id },
        {
          $set: {
            currentLevel:  'intermediate',
            levelProgress,
          },
        }
      );
      console.log(`  ✏️  Updated progression for category ${catIdStr}`);
    } else {
      // Create a fresh progression document
      const intModCount = await modulesCol.countDocuments({
        categoryId: catId, level: 'intermediate', status: 'published', isActive: true,
      });
      const advModCount = await modulesCol.countDocuments({
        categoryId: catId, level: 'advanced', status: 'published', isActive: true,
      });

      await progressionCol.insertOne({
        studentId:  user._id,
        categoryId: catId,
        currentLevel: 'intermediate',
        totalModulesCompleted: catBeginnerModules.length,
        totalModulesInCategory: catBeginnerModules.length + intModCount + advModCount,
        overallProgress: Math.round((catBeginnerModules.length / (catBeginnerModules.length + intModCount + advModCount)) * 100),
        completedModuleIds: catBeginnerModules.map(m => m._id),
        levelProgress: [
          {
            level:            'beginner',
            totalModules:     catBeginnerModules.length,
            completedModules: catBeginnerModules.length,
            isUnlocked:       true,
            isCompleted:      true,
            unlockedAt:       now,
            completedAt:      now,
          },
          {
            level:            'intermediate',
            totalModules:     intModCount,
            completedModules: 0,
            isUnlocked:       true,
            isCompleted:      false,
            unlockedAt:       now,
          },
          {
            level:            'advanced',
            totalModules:     advModCount,
            completedModules: 0,
            isUnlocked:       false,
            isCompleted:      false,
          },
        ],
        createdAt: now,
        updatedAt: now,
      });
      console.log(`  ➕ Created progression for category ${catIdStr}`);
    }
  }

  // ── 5. Summary ─────────────────────────────────────────────────────────────
  console.log('\n─────────────────────────────────────────────');
  console.log(`✅ Done. Student: ${user.firstName} ${user.lastName} (${TARGET_EMAIL})`);
  console.log(`   ${beginnerModules.length} beginner module(s) marked as completed`);
  console.log(`   Intermediate level is now unlocked`);
  console.log('   You can now log in and test enrolling in any intermediate module.');
  console.log('─────────────────────────────────────────────\n');

  await client.close();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
