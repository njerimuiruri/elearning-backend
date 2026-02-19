import mongoose from 'mongoose';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function fixAchievementIndex() {
  try {
    console.log('Connecting to database...');
    
    const mongoURI = process.env.MONGODB_URI;
    if (!mongoURI) {
      throw new Error('MONGODB_URI is not defined in environment variables');
    }

    await mongoose.connect(mongoURI);
    console.log('✓ Connected to MongoDB');
    
      const db = mongoose.connection.db;
      if (!db) {
        throw new Error('Database connection not established');
      }
    
      const achievementsCollection = db.collection('achievements');
    
    console.log('Listing existing indexes...');
    const indexes = await achievementsCollection.indexes();
    console.log('Current indexes:', JSON.stringify(indexes, null, 2));
    
    // Drop the problematic index that doesn't include moduleIndex
    try {
      console.log('\nDropping index: studentId_1_courseId_1_type_1');
      await achievementsCollection.dropIndex('studentId_1_courseId_1_type_1');
      console.log('✓ Successfully dropped conflicting index');
    } catch (error: any) {
      if (error.code === 27 || error.message.includes('index not found')) {
        console.log('Index already removed or does not exist');
      } else {
        throw error;
      }
    }
    
    // Verify remaining indexes
    console.log('\nVerifying final indexes...');
    const finalIndexes = await achievementsCollection.indexes();
    console.log('Final indexes:', JSON.stringify(finalIndexes, null, 2));
    
    console.log('\n✓ Achievement index fix completed successfully');
    
    // Close the connection
    await mongoose.connection.close();
    console.log('✓ Database connection closed');
    
    process.exit(0);
  } catch (error) {
    console.error('Error fixing achievement index:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

fixAchievementIndex();
