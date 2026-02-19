/**
 * Migration: Add Category Access Fields
 * Date: 2025-02-11
 *
 * This migration adds the purchasedCategories field to all users
 * and initializes assignedCategories for existing fellows.
 */

import { config } from 'dotenv';
import { MongoClient } from 'mongodb';

// Load environment variables from .env file
config();

export async function up(db: any) {
  console.log('Running migration: 001-add-category-access');

  try {
    // Add purchasedCategories field to all users (defaults to empty array)
    const updateAllUsersResult = await db.collection('users').updateMany(
      {},
      {
        $set: {
          purchasedCategories: [],
        },
      },
    );

    console.log(`✓ Added purchasedCategories to ${updateAllUsersResult.modifiedCount} users`);

    // Initialize assignedCategories for existing fellows
    const updateFellowsResult = await db.collection('users').updateMany(
      {
        'fellowData.fellowId': { $exists: true },
        'fellowData.assignedCategories': { $exists: false },
      },
      {
        $set: {
          'fellowData.assignedCategories': [],
        },
      },
    );

    console.log(`✓ Initialized assignedCategories for ${updateFellowsResult.modifiedCount} fellows`);

    // Create index on purchasedCategories for faster queries
    await db.collection('users').createIndex({ purchasedCategories: 1 });
    console.log('✓ Created index on purchasedCategories');

    // Create index on fellowData.assignedCategories for faster queries
    await db.collection('users').createIndex({ 'fellowData.assignedCategories': 1 });
    console.log('✓ Created index on fellowData.assignedCategories');

    console.log('✅ Migration 001-add-category-access completed successfully');
  } catch (error) {
    console.error('❌ Migration 001-add-category-access failed:', error);
    throw error;
  }
}

export async function down(db: any) {
  console.log('Rolling back migration: 001-add-category-access');

  try {
    // Remove purchasedCategories field from all users
    await db.collection('users').updateMany(
      {},
      {
        $unset: {
          purchasedCategories: '',
        },
      },
    );

    console.log('✓ Removed purchasedCategories from all users');

    // Remove assignedCategories from fellowData
    await db.collection('users').updateMany(
      {},
      {
        $unset: {
          'fellowData.assignedCategories': '',
        },
      },
    );

    console.log('✓ Removed fellowData.assignedCategories from all users');

    // Drop indexes
    try {
      await db.collection('users').dropIndex('purchasedCategories_1');
      await db.collection('users').dropIndex('fellowData.assignedCategories_1');
      console.log('✓ Dropped indexes');
    } catch (err) {
      console.log('ℹ️ Indexes may not exist, skipping drop');
    }

    console.log('✅ Rollback 001-add-category-access completed successfully');
  } catch (error) {
    console.error('❌ Rollback 001-add-category-access failed:', error);
    throw error;
  }
}

// Script to run migration directly
if (require.main === module) {
  const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/elearning';
  const DB_NAME = process.env.DB_NAME || 'elearning';

  console.log('Starting migration...');
  console.log('MongoDB URI:', MONGODB_URI.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@')); // Hide password in logs

  async function runMigration() {
    const client = new MongoClient(MONGODB_URI);

    try {
      console.log('Connecting to MongoDB...');
      await client.connect();
      console.log('✓ Connected to MongoDB');

      const db = client.db(DB_NAME);

      // Run migration
      await up(db);

      console.log('Migration completed successfully!');
    } catch (error) {
      console.error('Migration failed:', error);
      process.exit(1);
    } finally {
      await client.close();
      console.log('MongoDB connection closed');
    }
  }

  runMigration();
}
