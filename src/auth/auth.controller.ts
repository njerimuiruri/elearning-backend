import {
  Controller,
  Post,
  Body,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
  Get,
  UseGuards,
  Put,
  UploadedFile,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { diskStorage } from 'multer';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RegisterInstructorDto } from './dto/register-instructor.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from '../decorators/current-user.decorator';
import { User } from '../schemas/user.schema';
import * as path from 'path';
import * as fs from 'fs';

// Ensure uploads base and sub-directories exist (store relative paths)
const uploadsDir = './uploads';
const uploadsProfilesDir = path.join(uploadsDir, 'profiles');
const uploadsCvsDir = path.join(uploadsDir, 'cvs');
for (const dir of [uploadsDir, uploadsProfilesDir, uploadsCvsDir]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

@Controller('api/auth')
@ApiTags('Auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private usersService: UsersService,
  ) {}

  @Post('login')
  @ApiOperation({ summary: 'Login user' })
  @ApiResponse({ status: 200, description: 'Login successful, returns JWT token' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() loginDto: LoginDto, @Res() response: Response) {
    const result = await this.authService.login(loginDto);
    
    // Set HTTP-only cookie with 24-hour expiration
    response.cookie('token', result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      path: '/',
    });

    // Also set a non-HTTP-only cookie for client-side user data access
    response.cookie('user', JSON.stringify(result.user), {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      path: '/',
    });

    return response.json({
      user: result.user,
      token: result.token,
      message: result.message,
    });
  }

  @Post('google')
  @ApiOperation({ summary: 'Login or register with Google for students and instructors' })
  @ApiResponse({ status: 200, description: 'Google login successful, returns JWT token' })
  async googleLogin(@Body() body: GoogleLoginDto, @Res() response: Response) {
    const result = await this.authService.googleLogin(body);
    
    // Set HTTP-only cookie with 24-hour expiration
    response.cookie('token', result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      path: '/',
    });

    // Also set a non-HTTP-only cookie for client-side user data access
    response.cookie('user', JSON.stringify(result.user), {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      path: '/',
    });

    return response.json({
      user: result.user,
      token: result.token,
      message: result.message,
    });
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('jwt-auth')
  @ApiOperation({ summary: 'Logout user' })
  @ApiResponse({ status: 200, description: 'Logout successful' })
  async logout(@CurrentUser() user: User, @Res() response: Response) {
    // Clear cookies
    response.clearCookie('token', { path: '/' });
    response.clearCookie('user', { path: '/' });

    // Update last logout time asynchronously (non-blocking)
    this.usersService.updateUser(user._id.toString(), {
      lastLogout: new Date(),
    } as any).catch(err => console.error('Failed to update last logout:', err));

    return response.json({
      message: 'Logged out successfully',
      success: true,
    });
  }

  @Post('register')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'profilePicture', maxCount: 1 },
        { name: 'cv', maxCount: 1 },
      ],
      {
        storage: diskStorage({
          destination: (req, file, cb) => {
            let dest = uploadsDir;
            if (file.fieldname === 'cv') dest = uploadsCvsDir;
            else if (file.fieldname === 'profilePicture') dest = uploadsProfilesDir;
            cb(null, dest);
          },
          filename: (req, file, cb) => {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
            const ext = path.extname(file.originalname);
            
            if (file.fieldname === 'cv') {
              // For CV, include first and last name from the request body
              const firstName = (req.body.firstName || 'instructor').replace(/\s+/g, '-').toLowerCase();
              const lastName = (req.body.lastName || 'cv').replace(/\s+/g, '-').toLowerCase();
              cb(null, `cv-${firstName}-${lastName}-${uniqueSuffix}${ext}`);
            } else {
              // For profile pictures, keep the existing format
              const base = file.fieldname === 'profilePicture' ? 'profile' : file.fieldname;
              cb(null, `${base}-${uniqueSuffix}${ext}`);
            }
          },
        }),
        limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
        fileFilter: (req, file, cb) => {
          if (file.fieldname === 'profilePicture') {
            if (!file.mimetype.match(/\/(jpg|jpeg|png|gif)$/)) {
              return cb(
                new BadRequestException('Only image files are allowed for profile picture'),
                false,
              );
            }
          } else if (file.fieldname === 'cv') {
            // Only accept PDF files for CV
            if (file.mimetype !== 'application/pdf') {
              return cb(
                new BadRequestException('Only PDF files are allowed for CV. Please convert your document to PDF format.'),
                false,
              );
            }
          }
          cb(null, true);
        },
      },
    ),
  )
  async register(
    @Body() body: any,
    @UploadedFiles()
    files: {
      profilePicture?: Express.Multer.File[];
      cv?: Express.Multer.File[];
    },
  ) {
    const { role } = body;

    if (role === 'instructor') {
      const instructorDto: RegisterInstructorDto = {
        ...body,
        profilePictureUrl: files?.profilePicture?.[0]?.path,
        cvUrl: files?.cv?.[0]?.path,
      };

      if (!instructorDto.cvUrl) {
        throw new BadRequestException('CV is required for instructor registration');
      }

      return this.authService.registerInstructor(instructorDto);
    }

    const registerDto: RegisterDto = body;
    return this.authService.register(registerDto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@CurrentUser() user: User) {
    return {
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        userType: user.userType,
        profilePhotoUrl: user.profilePhotoUrl,
        bio: user.bio,
        phoneNumber: user.phoneNumber,
        country: user.country,
        organization: user.organization,
        institution: user.institution,
        qualifications: user.qualifications,
        expertise: user.expertise,
        linkedIn: user.linkedIn,
        portfolio: user.portfolio,
        teachingExperience: user.teachingExperience,
        yearsOfExperience: user.yearsOfExperience,
        cvUrl: user.cvUrl,
        totalPoints: user.totalPoints,
        currentStreakDays: user.currentStreakDays,
        longestStreakDays: user.longestStreakDays,
        emailVerified: user.emailVerified,
        lastLogin: user.lastLogin,
        createdAt: user.createdAt,
      },
    };
  }

  @Put('profile')
  @UseGuards(JwtAuthGuard)
  async updateProfile(
    @CurrentUser() user: User,
    @Body() updateData: Partial<User>,
  ) {
    // Don't allow updating sensitive fields
    const allowedFields = [
      'firstName',
      'lastName',
      'bio',
      'phoneNumber',
      'country',
      'institution',
    ];

    const filteredData = Object.keys(updateData)
      .filter((key) => allowedFields.includes(key))
      .reduce((obj, key) => {
        obj[key] = updateData[key];
        return obj;
      }, {});

    const updatedUser = await this.usersService.updateUser(
      user._id.toString(),
      filteredData,
    );

    return {
      user: updatedUser,
      message: 'Profile updated successfully',
    };
  }

  @Post('upload-photo')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('profileImage', {
      storage: diskStorage({
        destination: uploadsProfilesDir,
        filename: (req, file, cb) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          const ext = path.extname(file.originalname);
          cb(null, `profile-${uniqueSuffix}${ext}`);
        },
      }),
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
      fileFilter: (req, file, cb) => {
        if (!file.mimetype.match(/\/(jpg|jpeg|png|gif)$/)) {
          return cb(
            new BadRequestException('Only image files are allowed'),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  async uploadProfilePhoto(
    @CurrentUser() user: User,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    // Delete old profile photo if exists
    if (user.profilePhotoUrl && fs.existsSync(user.profilePhotoUrl)) {
      try {
        fs.unlinkSync(user.profilePhotoUrl);
      } catch (error) {
        console.error('Error deleting old profile photo:', error);
      }
    }

    // Update user profile photo
    const updatedUser = await this.usersService.updateUser(
      user._id.toString(),
      { profilePhotoUrl: file.path } as any,
    );

    return {
      user: updatedUser,
      message: 'Profile photo uploaded successfully',
    };
  }

  @Post('remove-photo')
  @UseGuards(JwtAuthGuard)
  async removeProfilePhoto(@CurrentUser() user: User) {
    // Delete profile photo file if exists
    if (user.profilePhotoUrl && fs.existsSync(user.profilePhotoUrl)) {
      try {
        fs.unlinkSync(user.profilePhotoUrl);
      } catch (error) {
        console.error('Error deleting profile photo:', error);
      }
    }

    // Update user to remove profile photo
    const updatedUser = await this.usersService.updateUser(
      user._id.toString(),
      { profilePhotoUrl: null } as any,
    );

    return {
      user: updatedUser,
      message: 'Profile photo removed successfully',
    };
  }

  @Get('verify')
  @UseGuards(JwtAuthGuard)
  async verifyToken(@CurrentUser() user: User) {
    return {
      valid: true,
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
      },
    };
  }

  @Post('forgot-password')
  async forgotPassword(@Body('email') email: string) {
    return this.authService.forgotPassword(email);
  }

  @Post('reset-password')
  async resetPassword(
    @Body('token') token: string,
    @Body('newPassword') newPassword: string,
    @Body('confirmPassword') confirmPassword: string,
  ) {
    return this.authService.resetPassword(token, newPassword, confirmPassword);
  }

  @Post('set-initial-password')
  async setInitialPassword(
    @Body('token') token: string,
    @Body('password') password: string,
    @Body('confirmPassword') confirmPassword: string,
  ) {
    return this.authService.setInitialPassword(token, password, confirmPassword);
  }

  @Put('change-password')
  @UseGuards(JwtAuthGuard)
  async changePassword(
    @CurrentUser() user: User,
    @Body('currentPassword') currentPassword: string,
    @Body('newPassword') newPassword: string,
    @Body('confirmPassword') confirmPassword: string,
  ) {
    return this.authService.changePassword(user._id.toString(), currentPassword, newPassword, confirmPassword);
  }
}