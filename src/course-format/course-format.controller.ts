import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CourseFormat } from '../schemas/course-format.schema';

@Controller('api/course-format')
@ApiTags('Course Format')
export class CourseFormatController {
  constructor(
    @InjectModel(CourseFormat.name) private courseFormatModel: Model<CourseFormat>,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get current course format document (Public - accessible to all users)' })
  @ApiResponse({ status: 200, description: 'Course format document details' })
  @ApiResponse({ status: 404, description: 'No course format document found' })
  async getCourseFormat() {
    try {
      const courseFormat = await this.courseFormatModel
        .findOne({ isActive: true })
        .select('-uploadedBy')
        .sort({ uploadedAt: -1 });

      if (!courseFormat) {
        return {
          success: false,
          message: 'No course format document available',
          courseFormat: null,
        };
      }

      return {
        success: true,
        message: 'Course format retrieved successfully',
        courseFormat,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to fetch course format',
        courseFormat: null,
      };
    }
  }
}
