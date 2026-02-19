import 'dotenv/config';
import mongoose from 'mongoose';

/**
 * Script to rebuild MongoDB indexes for the enrollment collection
 * This is needed after schema changes to ensure indexes match the schema
 */

async function rebuildIndexes() {
  try {
    // Connect to MongoDB
    const mongoURI = process.env.MONGODB_URI;
    
    if (!mongoURI) {
      throw new Error('MONGODB_URI is not defined in environment variables');
    }

    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(mongoURI);
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;
    
    if (!db) {
      throw new Error('Database connection failed');
    }

    // Drop existing indexes on enrollments collection
    console.log('\n🗑️  Dropping existing indexes on enrollments collection...');
    try {
      const collection = db.collection('enrollments');
      const existingIndexes = await collection.indexes();
      console.log('Existing indexes:', existingIndexes.map((idx: any) => idx.name));
      
      // Drop only the certificatePublicId index
      const certIndexName = existingIndexes.find((idx: any) => idx.key?.certificatePublicId === 1)?.name;
      if (certIndexName) {
        await collection.dropIndex(certIndexName);
        console.log(`✅ Dropped ${certIndexName} index`);
      } else {
        console.log('ℹ️  certificatePublicId index does not exist, skipping drop');
      }
    } catch (err: any) {
      if (err.message.includes('index not found')) {
        console.log('ℹ️  Index does not exist, skipping drop');
      } else {
        throw err;
      }
    }

    // Rebuild indexes
    console.log('\n📝 Rebuilding indexes...');
    const collection = db.collection('enrollments');
    
    // Create indexes with updated options
    await collection.createIndex({ certificatePublicId: 1 }, { 
      unique: true, 
      sparse: true,
      partialFilterExpression: { certificatePublicId: { $ne: null } }
    });
    console.log('✅ Created certificatePublicId index with sparse and partial filter');

    // Verify indexes
    console.log('\n✅ Verifying indexes...');
    const indexes = await collection.indexes();
    console.log('Current indexes:', indexes.map((idx: any) => idx.name));

    // Check for duplicate null values
    console.log('\n📊 Checking for duplicate null certificatePublicId values...');
    const nullCount = await collection.countDocuments({ certificatePublicId: null });
    console.log(`Found ${nullCount} documents with null certificatePublicId`);

    if (nullCount > 1) {
      console.log('\n⚠️  Multiple null values found. This is expected with sparse index.');
      console.log('The sparse index prevents violations for null values.');
    }

    console.log('\n✅ Index rebuild completed successfully!');
    
  } catch (error) {
    console.error('❌ Error rebuilding indexes:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Disconnected from MongoDB');
  }
}

// Run the script
rebuildIndexes();
