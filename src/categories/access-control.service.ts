import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Category } from '../schemas/category.schema';
import { User, UserRole } from '../schemas/user.schema';
import { Course } from '../schemas/course.schema';

export interface CategoryAccessResult {
  allowed: boolean;
  reason?: 'payment_required' | 'not_assigned' | 'restricted' | 'admin_bypass' | 'free_category' | 'fellow_access' | 'purchased';
  price?: number;
  categoryId?: string;
}

export interface CourseAccessResult {
  allowed: boolean;
  requiresPayment: boolean;
  categoryId?: string;
  price?: number;
  reason?: string;
}

@Injectable()
export class CategoryAccessControlService {
  constructor(
    @InjectModel(Category.name) private categoryModel: Model<Category>,
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(Course.name) private courseModel: Model<Course>,
  ) {}

  /**
   * Check if a user has access to a specific category
   * @param userId - User ID to check
   * @param categoryId - Category ID to check
   * @returns CategoryAccessResult with access status and reason
   */
  async checkCategoryAccess(
    userId: string,
    categoryId: string,
  ): Promise<CategoryAccessResult> {
    // Fetch user and category in parallel
    const [user, category] = await Promise.all([
      this.userModel.findById(userId),
      this.categoryModel.findById(categoryId),
    ]);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    if (!category.isActive) {
      return {
        allowed: false,
        reason: 'restricted',
      };
    }

    // Admin bypass - admins can access everything
    if (user.role === UserRole.ADMIN) {
      return {
        allowed: true,
        reason: 'admin_bypass',
      };
    }

    // Free category — only fellows assigned to this category get free access.
    // Non-fellows are blocked (they do not get automatic free access).
    if (category.accessType === 'free') {
      if (user.fellowData?.assignedCategories) {
        const isAssigned = user.fellowData.assignedCategories.some(
          (catId) => catId.toString() === categoryId.toString(),
        );
        if (isAssigned) {
          return {
            allowed: true,
            reason: 'fellow_access',
          };
        }
      }
      // Non-fellow trying to access a fellow-only free category
      return {
        allowed: false,
        reason: 'restricted',
      };
    }

    // Paid category — check if user is a fellow with this category assigned
    if (user.fellowData?.assignedCategories) {
      const isAssigned = user.fellowData.assignedCategories.some(
        (catId) => catId.toString() === categoryId.toString(),
      );

      if (isAssigned) {
        return {
          allowed: true,
          reason: 'fellow_access',
        };
      }
    }

    // Check if user has purchased this category
    if (user.purchasedCategories) {
      const hasPurchased = user.purchasedCategories.some(
        (catId) => catId.toString() === categoryId.toString(),
      );

      if (hasPurchased) {
        return {
          allowed: true,
          reason: 'purchased',
        };
      }
    }

    // Check if payment is required for non-eligible users
    if (category.paymentRequiredForNonEligible && category.accessType === 'paid') {
      return {
        allowed: false,
        reason: 'payment_required',
        price: category.price,
        categoryId: categoryId,
      };
    }

    // Otherwise, access is restricted
    return {
      allowed: false,
      reason: 'restricted',
    };
  }

  /**
   * Check if a user has access to a specific course (via its category and course settings)
   * @param userId - User ID to check
   * @param courseId - Course ID to check
   * @returns CourseAccessResult with access status and payment requirement
   */
  async checkCourseAccess(
    userId: string,
    courseId: string,
  ): Promise<CourseAccessResult> {
    // Fetch user and course with populated category
    const [user, course] = await Promise.all([
      this.userModel.findById(userId),
      this.courseModel.findById(courseId).populate('category'),
    ]);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    // Course must have a category (required for pricing control)
    if (!course.category) {
      throw new NotFoundException('Course has no category assigned');
    }

    const category = course.category as any;

    // Admin bypass - admins can access everything
    if (user.role === UserRole.ADMIN) {
      return {
        allowed: true,
        requiresPayment: false,
        categoryId: category._id.toString(),
        reason: 'admin_bypass',
      };
    }

    // Check if user is a fellow with this category assigned
    if (user.fellowData?.assignedCategories) {
      const isAssigned = user.fellowData.assignedCategories.some(
        (catId) => catId.toString() === category._id.toString(),
      );

      if (isAssigned) {
        return {
          allowed: true,
          requiresPayment: false,
          categoryId: category._id.toString(),
          reason: 'fellow_access',
        };
      }
    }

    // Check if user has purchased this category
    if (user.purchasedCategories) {
      const hasPurchased = user.purchasedCategories.some(
        (catId) => catId.toString() === category._id.toString(),
      );

      if (hasPurchased) {
        return {
          allowed: true,
          requiresPayment: false,
          categoryId: category._id.toString(),
          reason: 'purchased',
        };
      }
    }

    // Check if category is free (isPaid = false or accessType = 'free')
    // NOTE: For backward compatibility, if isPaid is undefined, check accessType
    if (category.isPaid === false || category.accessType === 'free') {
      return {
        allowed: true,
        requiresPayment: false,
        categoryId: category._id.toString(),
        reason: 'free_category',
      };
    }

    // Check if category is paid
    // If isPaid is explicitly true, OR if accessType is 'paid', require payment
    const isPaidCategory = category.isPaid === true || category.accessType === 'paid';

    if (isPaidCategory) {
      // User doesn't have access via fellow assignment or purchase
      // Payment is required
      if (category.price && category.price > 0) {
        return {
          allowed: false,
          requiresPayment: true,
          categoryId: category._id.toString(),
          price: category.price,
          reason: 'payment_required',
        };
      } else {
        // Category is marked as paid but has no price set
        return {
          allowed: false,
          requiresPayment: false,
          categoryId: category._id.toString(),
          reason: 'restricted',
        };
      }
    }

    // Default: If neither paid nor free is explicitly set, treat as free for backward compatibility
    return {
      allowed: true,
      requiresPayment: false,
      categoryId: category._id.toString(),
      reason: 'free_category',
    };
  }

  /**
   * Mark a category as purchased by a user
   * @param userId - User ID
   * @param categoryId - Category ID to mark as purchased
   */
  async markCategoryAsPurchased(
    userId: string,
    categoryId: string,
  ): Promise<void> {
    await this.userModel.findByIdAndUpdate(
      userId,
      {
        $addToSet: { purchasedCategories: new Types.ObjectId(categoryId) },
      },
      { new: true },
    );
  }

  /**
   * Check if a user has purchased a specific category
   * @param userId - User ID
   * @param categoryId - Category ID
   * @returns true if purchased, false otherwise
   */
  async hasPurchasedCategory(
    userId: string,
    categoryId: string,
  ): Promise<boolean> {
    const user = await this.userModel.findById(userId);

    if (!user || !user.purchasedCategories) {
      return false;
    }

    return user.purchasedCategories.some(
      (catId) => catId.toString() === categoryId.toString(),
    );
  }

  /**
   * Get all categories accessible to a user (free + fellow-assigned + purchased)
   * @param userId - User ID
   * @returns Array of category IDs the user can access
   */
  async getUserAccessibleCategories(userId: string): Promise<string[]> {
    const user = await this.userModel.findById(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Admin can access all active categories
    if (user.role === UserRole.ADMIN) {
      const allCategories = await this.categoryModel.find({ isActive: true });
      return allCategories.map((cat) => cat._id.toString());
    }

    // Get all free categories
    const freeCategories = await this.categoryModel.find({
      accessType: 'free',
      isActive: true,
    });

    const accessibleIds = new Set<string>();

    // Add free categories
    freeCategories.forEach((cat) => accessibleIds.add(cat._id.toString()));

    // Add fellow-assigned categories
    if (user.fellowData?.assignedCategories) {
      user.fellowData.assignedCategories.forEach((catId) =>
        accessibleIds.add(catId.toString()),
      );
    }

    // Add purchased categories
    if (user.purchasedCategories) {
      user.purchasedCategories.forEach((catId) =>
        accessibleIds.add(catId.toString()),
      );
    }

    return Array.from(accessibleIds);
  }
}
