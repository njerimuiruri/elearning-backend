import 'dotenv/config';
import mongoose from 'mongoose';

/**
 * Script to fix achievement indexes after schema changes
 * Drops old problematic indexes and rebuilds with correct ones
 */

async function fixAchievementIndexes() {
  try {
    const mongoURI = process.env.MONGODB_URI;
    
    if (!mongoURI) {
      throw new Error('MONGODB_URI is not defined in environment variables');
    }

    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(mongoURI);
    console.log('✅ Connected to MongoDB');

    // Use the database name from the connection string or default to 'elearning'
    const dbName = mongoose.connection.db?.databaseName || 'elearning';
    console.log(`📊 Using database: ${dbName}`);
    
    const db = mongoose.connection.db;
    
    if (!db) {
      throw new Error('Database connection failed');
    }

    const collection = db.collection('achievements');

    // List existing indexes
    console.log('\n📋 Listing existing indexes...');
    const existingIndexes = await collection.indexes();
    console.log('Current indexes:');
    existingIndexes.forEach((idx: any) => {
      console.log(`  - ${idx.name}:`, JSON.stringify(idx.key));
    });

    // Drop old problematic indexes
    const indexesToDrop = [
      'studentId_1_courseId_1_type_1',
      'studentId_1_courseId_1_type_1_moduleIndex_1'
    ];

    for (const indexName of indexesToDrop) {
      try {
        console.log(`\n🗑️  Attempting to drop index: ${indexName}`);
        await collection.dropIndex(indexName);
        console.log(`✅ Successfully dropped ${indexName}`);
      } catch (error: any) {
        if (error.code === 27 || error.message.includes('index not found')) {
          console.log(`ℹ️  Index ${indexName} does not exist, skipping`);
        } else {
          console.error(`❌ Error dropping ${indexName}:`, error.message);
        }
      }
    }

    // Create new correct index with enrollmentId
    console.log('\n📝 Creating new indexes...');
    
    try {
      await collection.createIndex(
        { studentId: 1, courseId: 1, enrollmentId: 1, type: 1, moduleIndex: 1 },
        { unique: true, sparse: true, name: 'achievement_unique_per_enrollment' }
      );
      console.log('✅ Created achievement_unique_per_enrollment index');
    } catch (error: any) {
      if (error.code === 85 || error.message.includes('already exists')) {
        console.log('ℹ️  Index already exists, skipping creation');
      } else {
        throw error;
      }
    }

    try {
      await collection.createIndex(
        { enrollmentId: 1 },
        { name: 'enrollmentId_1' }
      );
      console.log('✅ Created enrollmentId index');
    } catch (error: any) {
      if (error.code === 85 || error.message.includes('already exists')) {
        console.log('ℹ️  enrollmentId index already exists, skipping creation');
      } else {
        throw error;
      }
    }

    // Verify final indexes
    console.log('\n✅ Verifying final indexes...');
    const finalIndexes = await collection.indexes();
    console.log('Final indexes:');
    finalIndexes.forEach((idx: any) => {
      console.log(`  - ${idx.name}:`, JSON.stringify(idx.key));
    });

    // Check for duplicate achievements
    console.log('\n📊 Checking for duplicate achievements...');
    const pipeline = [
      {
        $group: {
          _id: {
            studentId: '$studentId',
            courseId: '$courseId',
            enrollmentId: '$enrollmentId',
            type: '$type',
            moduleIndex: '$moduleIndex'
          },
          count: { $sum: 1 },
          ids: { $push: '$_id' }
        }
      },
      {
        $match: { count: { $gt: 1 } }
      }
    ];

    const duplicates = await collection.aggregate(pipeline).toArray();
    
    if (duplicates.length > 0) {
      console.log(`⚠️  Found ${duplicates.length} duplicate achievement(s):`);
      duplicates.forEach((dup: any, idx: number) => {
        console.log(`\n  Duplicate ${idx + 1}:`, dup._id);
        console.log(`  Count: ${dup.count}`);
        console.log(`  IDs: ${dup.ids.join(', ')}`);
      });
      
      console.log('\n🔧 To fix duplicates, you can:');
      console.log('   1. Manually delete duplicate achievements in MongoDB Compass');
      console.log('   2. Keep only the most recent achievement for each duplicate group');
    } else {
      console.log('✅ No duplicate achievements found');
    }

    console.log('\n✅ Achievement index fix completed successfully!');
    console.log('\nℹ️  Note: If you see duplicate key errors in the future:');
    console.log('   - This index now includes enrollmentId');
    console.log('   - Each enrollment can have separate achievements');
    console.log('   - Multiple course attempts are now supported');
    
  } catch (error) {
    console.error('❌ Error fixing achievement indexes:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 Database connection closed');
    process.exit(0);
  }
}

fixAchievementIndexes();
