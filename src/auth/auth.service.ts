import { Injectable, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { User, UserRole, InstructorStatus } from '../schemas/user.schema';
import { PasswordReset } from '../schemas/password-reset.schema';
import { ActivityLog, ActivityType } from '../schemas/activity-log.schema';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RegisterInstructorDto } from './dto/register-instructor.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
import { EmailService } from '../common/services/email.service';

@Injectable()
export class AuthService {
  private googleClient: OAuth2Client | null;

  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(PasswordReset.name) private passwordResetModel: Model<PasswordReset>,
    @InjectModel(ActivityLog.name) private activityLogModel: Model<ActivityLog>,
    private jwtService: JwtService,
    private emailService: EmailService,
    private configService: ConfigService,
  ) {
    const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
    this.googleClient = clientId ? new OAuth2Client(clientId) : null;
  }

  // Helper method to log activities
  private async logActivity(
    type: ActivityType,
    message: string,
    targetUser?: string,
    metadata?: Record<string, any>,
    icon?: string,
  ) {
    try {
      await this.activityLogModel.create({
        type,
        message,
        targetUser,
        metadata,
        icon,
      });
    } catch (error) {
      console.error('Failed to log activity:', error);
      // Don't throw - logging should not block the main operation
    }
  }

  async register(registerDto: RegisterDto) {
    const { email, password, firstName, lastName, country, organization, otherOrganization, role } = registerDto;

    // Check if user exists
    const existingUser = await this.userModel.findOne({ email });
    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await this.userModel.create({
      email,
      password: hashedPassword,
      firstName,
      lastName,
      country,
      organization: organization === 'Other' ? otherOrganization : organization,
      role: role || UserRole.STUDENT,
      instructorStatus: role === UserRole.INSTRUCTOR ? InstructorStatus.PENDING : undefined,
    });

    // Log the registration activity
    await this.logActivity(
      ActivityType.USER_REGISTRATION,
      `${firstName} ${lastName} registered as ${role || 'student'}`,
      user._id.toString(),
      { email, role: role || UserRole.STUDENT, country, organization },
      'UserPlus',
    );

    // Send welcome email for self-registered students
    if (role !== UserRole.INSTRUCTOR) {
      try {
        await this.emailService.sendWelcomeEmail(email, firstName);
      } catch (error) {
        console.error('Failed to send welcome email:', error);
      }
    }

    // For students, generate token immediately
    if (role !== UserRole.INSTRUCTOR) {
      const token = this.generateToken(user);
      return {
        user: this.sanitizeUser(user),
        token,
        message: 'Registration successful',
      };
    }

    // For instructors, no token until approved
    return {
      user: this.sanitizeUser(user),
      message: 'Registration successful. Your account is pending approval.',
    };
  }

  async registerInstructor(registerInstructorDto: RegisterInstructorDto) {
    const {
      email,
      password,
      firstName,
      lastName,
      phoneNumber,
      country,
      organization,
      otherOrganization,
      institution,
      bio,
      qualifications,
      expertise,
      linkedIn,
      portfolio,
      teachingExperience,
      yearsOfExperience,
      profilePictureUrl,
      cvUrl,
    } = registerInstructorDto;

    // Check if user exists
    const existingUser = await this.userModel.findOne({ email });
    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create instructor (pending approval)
    const instructor = await this.userModel.create({
      email,
      password: hashedPassword,
      firstName,
      lastName,
      phoneNumber,
      country,
      organization: organization === 'Other' ? otherOrganization : organization,
      role: UserRole.INSTRUCTOR,
      institution,
      bio,
      qualifications,
      expertise,
      linkedIn,
      portfolio,
      teachingExperience,
      yearsOfExperience,
      profilePhotoUrl: profilePictureUrl,
      cvUrl,
      instructorStatus: InstructorStatus.PENDING,
    });

    // Log the instructor registration activity
    await this.logActivity(
      ActivityType.USER_REGISTRATION,
      `${firstName} ${lastName} registered as instructor (pending approval)`,
      instructor._id.toString(),
      { 
        email, 
        role: UserRole.INSTRUCTOR, 
        institution, 
        country,
        status: InstructorStatus.PENDING,
      },
      'UserPlus',
    );

    // Send notification to admin about pending instructor registration
    try {
      const adminUsers = await this.userModel.find({ role: UserRole.ADMIN });
      const adminEmails = adminUsers.map(admin => admin.email);
      
      // Also add the default admin email to ensure notifications are received
      const defaultAdminEmail = 'faith.muiruri@strathmore.edu';
      if (!adminEmails.includes(defaultAdminEmail)) {
        adminEmails.push(defaultAdminEmail);
      }
      
      for (const adminEmail of adminEmails) {
        await this.emailService.sendInstructorRegistrationNotificationToAdmin(
          adminEmail,
          `${firstName} ${lastName}`,
          email,
          institution,
          bio,
          instructor._id.toString(),
        );
      }
    } catch (error) {
      console.error('Failed to send admin notification:', error);
      // Don't fail the registration if email notification fails
    }

    return {
      user: this.sanitizeUser(instructor),
      message: 'Instructor registration submitted for approval. You will be notified once your account is approved.',
    };
  }

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

    // Find user
    const user = await this.userModel.findOne({ email });
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Check if user is active
    if (!user.isActive) {
      throw new UnauthorizedException('Your account has been deactivated. Please contact support.');
    }

    // Allow instructors to login regardless of approval status
    // The frontend will handle redirection based on instructorStatus

    // Update last login asynchronously (non-blocking - don't await)
    this.userModel.updateOne(
      { _id: user._id },
      { lastLogin: new Date() },
    ).exec().catch(err => console.error('Failed to update last login:', err));

    // Log the login activity
    const loginType = user.role === UserRole.ADMIN ? 'Admin' : user.role === UserRole.INSTRUCTOR ? 'Instructor' : 'Student';
    await this.logActivity(
      ActivityType.USER_REGISTRATION, // Using this for now, can create new LOGIN type if needed
      `${loginType} ${user.firstName} ${user.lastName} logged in`,
      user._id.toString(),
      { email: user.email, role: user.role, loginTime: new Date() },
      'LogIn',
    );

    // Generate token with 24-hour expiration for cookie storage
    const payload = {
      sub: user._id,
      email: user.email,
      role: user.role,
    };
    const token = this.jwtService.sign(payload, {
      expiresIn: '24h', // 24-hour cookie expiration
    });

    return {
      user: this.sanitizeUser(user),
      token,
      message: 'Login successful',
    };
  }

  async googleLogin(googleDto: GoogleLoginDto) {
    const { idToken, role } = googleDto;

    if (!this.googleClient) {
      throw new UnauthorizedException('Google login is not configured');
    }

    const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID');

    let payload;
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: clientId,
      });
      payload = ticket.getPayload();
    } catch (error) {
      console.error('Google token verification failed:', error);
      throw new UnauthorizedException('Invalid Google token');
    }

    if (!payload || !payload.email) {
      throw new UnauthorizedException('Unable to retrieve Google account');
    }

    const email = payload.email.toLowerCase();
    const firstName = payload.given_name || 'User';
    const lastName = payload.family_name || 'Google';
    const picture = payload.picture;
    const googleId = payload.sub;
    const emailVerified = Boolean(payload.email_verified);

    let user = await this.userModel.findOne({ email });

    // If user exists, update provider info and verification
    if (user) {
      user.googleId = user.googleId || googleId;
      user.provider = 'google';
      if (emailVerified && !user.emailVerified) {
        user.emailVerified = true;
      }
    } else {
      // Create new user with role preference
      const desiredRole = role === UserRole.INSTRUCTOR ? UserRole.INSTRUCTOR : UserRole.STUDENT;
      const randomPassword = crypto.randomBytes(32).toString('hex');
      const hashedPassword = await bcrypt.hash(randomPassword, 10);

      user = await this.userModel.create({
        email,
        password: hashedPassword,
        firstName,
        lastName,
        role: desiredRole,
        instructorStatus: desiredRole === UserRole.INSTRUCTOR ? InstructorStatus.PENDING : undefined,
        profilePhotoUrl: picture,
        emailVerified,
        googleId,
        provider: 'google',
        mustSetPassword: false,
      });

      // Log the registration activity for new Google users
      await this.logActivity(
        ActivityType.USER_REGISTRATION,
        `${firstName} ${lastName} registered via Google as ${desiredRole}${desiredRole === UserRole.INSTRUCTOR ? ' (pending approval)' : ''}`,
        user._id.toString(),
        { 
          email, 
          role: desiredRole, 
          provider: 'google',
          status: desiredRole === UserRole.INSTRUCTOR ? InstructorStatus.PENDING : 'active',
        },
        'UserPlus',
      );
    }

    user.lastLogin = new Date();
    await user.save();

    const token = this.generateToken(user);

    return {
      user: this.sanitizeUser(user),
      token,
      message: 'Google login successful',
    };
  }

  async validateUser(userId: string) {
    const user = await this.userModel.findById(userId);
    if (!user || !user.isActive) {
      return null;
    }
    return user;
  }

  private generateToken(user: User) {
    const payload = {
      sub: user._id,
      email: user.email,
      role: user.role,
    };
    return this.jwtService.sign(payload);
  }

  private sanitizeUser(user: User) {
    const userObj = user.toObject();
    delete userObj.password;
    return userObj;
  }

  // Password Reset Methods
  async forgotPassword(email: string) {
    const user = await this.userModel.findOne({ email });
    if (!user) {
      // Don't reveal if email exists for security
      return { success: true, message: 'If an account exists with this email, a reset link will be sent.' };
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

    // Save reset token
    await this.passwordResetModel.create({
      userId: user._id,
      email,
      token: hashedToken,
    });

    // Send reset email
    try {
      const resetUrl = `${process.env.FRONTEND_URL}/auth/reset-password/${resetToken}`;
      await this.emailService.sendPasswordResetEmail(email, user.firstName, resetUrl);
    } catch (error) {
      console.error('Failed to send password reset email:', error);
      throw new Error('Failed to send password reset email');
    }

    return {
      success: true,
      message: 'If an account exists with this email, a reset link will be sent.',
    };
  }

  async resetPassword(token: string, newPassword: string, confirmPassword: string) {
    if (newPassword !== confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    // Hash token to compare
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    // Find reset record
    const resetRecord = await this.passwordResetModel.findOne({
      token: hashedToken,
      createdAt: { $gt: new Date(Date.now() - 3600000) }, // Within 1 hour
    });

    if (!resetRecord) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    // Update password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.userModel.findByIdAndUpdate(resetRecord.userId, {
      password: hashedPassword,
    });

    // Delete reset token
    await this.passwordResetModel.deleteOne({ _id: resetRecord._id });

    return { success: true, message: 'Password reset successful' };
  }

  async setInitialPassword(token: string, password: string, confirmPassword: string) {
    if (password !== confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const resetRecord = await this.passwordResetModel.findOne({
      token: hashedToken,
      createdAt: { $gt: new Date(Date.now() - 24 * 3600000) }, // Within 24 hours
    });

    if (!resetRecord) {
      throw new BadRequestException('Invalid or expired setup link');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await this.userModel.findByIdAndUpdate(resetRecord.userId, {
      password: hashedPassword,
    });

    await this.passwordResetModel.deleteOne({ _id: resetRecord._id });

    return { success: true, message: 'Password set successfully' };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string, confirmPassword: string) {
    if (newPassword !== confirmPassword) {
      throw new BadRequestException('New passwords do not match');
    }

    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.userModel.findByIdAndUpdate(userId, {
      password: hashedPassword,
      mustSetPassword: false, // Clear the flag after password change
    });

    return { success: true, message: 'Password changed successfully' };
  }

}
