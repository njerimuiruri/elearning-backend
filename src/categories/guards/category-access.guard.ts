import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { CategoryAccessControlService } from '../access-control.service';

@Injectable()
export class CategoryAccessGuard implements CanActivate {
  constructor(
    private readonly categoryAccessControl: CategoryAccessControlService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    const userId = user._id || user.id;

    // Extract courseId from different possible locations
    const courseId =
      request.params.id || // For routes like /courses/:id
      request.params.courseId || // For routes like /enroll/:courseId
      request.body.courseId || // For POST body
      request.query.courseId; // For query params

    if (!courseId) {
      throw new BadRequestException('Course ID is required');
    }

    try {
      // Check if user has access to this course
      const accessCheck = await this.categoryAccessControl.checkCourseAccess(
        userId,
        courseId,
      );

      if (accessCheck.allowed) {
        // Access granted
        return true;
      }

      // Access denied - throw appropriate exception
      if (accessCheck.requiresPayment) {
        throw new ForbiddenException({
          statusCode: 402,
          message: 'Payment required to access this course',
          error: 'Payment Required',
          data: {
            categoryId: accessCheck.categoryId,
            price: accessCheck.price,
            reason: accessCheck.reason,
          },
        });
      }

      // Access restricted (not for sale or fellow-only)
      throw new ForbiddenException({
        statusCode: 403,
        message: 'You do not have access to this course category',
        error: 'Forbidden',
        data: {
          categoryId: accessCheck.categoryId,
          reason: accessCheck.reason,
        },
      });
    } catch (error) {
      // If it's already a ForbiddenException or BadRequestException, re-throw it
      if (
        error instanceof ForbiddenException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      // For any other error, throw a generic forbidden exception
      throw new ForbiddenException(
        error.message || 'Unable to verify course access',
      );
    }
  }
}
