import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum UserRole {
  STUDENT = 'student',
  INSTRUCTOR = 'instructor',
  ADMIN = 'admin',
}

export enum UserType {
  FELLOW = 'fellow',
  PUBLIC = 'public',
}

export enum InstructorStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export enum FellowshipStatus {
  ACTIVE = 'active',
  COMPLETED = 'completed',
  EXPIRED = 'expired',
}

class FellowData {
  @Prop()
  fellowId: string;

  @Prop()
  cohort: string;

  @Prop()
  deadline: Date;

  @Prop([String])
  requiredCourses: string[];

  @Prop({ enum: FellowshipStatus, default: FellowshipStatus.ACTIVE })
  fellowshipStatus: string;

  @Prop([{ type: Types.ObjectId, ref: 'Category' }])
  assignedCategories: Types.ObjectId[];
}

@Schema({ timestamps: true })
export class User extends Document {
  @Prop({ required: true, trim: true })
  firstName: string;

  @Prop({ required: true, trim: true })
  lastName: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true })
  password: string;

  @Prop({ default: null })
  googleId: string;

  @Prop({ default: 'local' })
  provider: string;

  @Prop({ enum: UserRole, default: UserRole.STUDENT })
  role: UserRole;

  @Prop({ enum: UserType, default: UserType.PUBLIC })
  userType: UserType;

  @Prop({ default: null })
  profilePhotoUrl: string;

  @Prop({ default: null })
  bio: string;

  @Prop({ default: null })
  phoneNumber: string;

  @Prop({ default: null })
  country: string;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: false })
  emailVerified: boolean;

  @Prop({ default: null })
  lastLogin: Date;

  @Prop({ default: null })
  lastLogout: Date;

  @Prop({ default: 0 })
  totalPoints: number;

  @Prop({ default: 0 })
  currentStreakDays: number;

  @Prop({ default: 0 })
  longestStreakDays: number;

  // Instructor-specific fields
  @Prop({ enum: InstructorStatus, default: InstructorStatus.PENDING })
  instructorStatus: InstructorStatus;

  @Prop({ default: null })
  institution: string;

  @Prop({ default: null })
  cvUrl: string;

  @Prop({ default: null })
  profilePicture: string;

  @Prop({ default: null })
  qualifications: string;

  @Prop({ default: null })
  expertise: string;

  @Prop({ default: null })
  linkedIn: string;

  @Prop({ default: null })
  portfolio: string;

  @Prop({ default: null })
  teachingExperience: string;

  @Prop({ default: null })
  yearsOfExperience: string;

  @Prop({ default: null })
  organization: string;

  @Prop({ default: null })
  otherOrganization: string;

  @Prop({ default: 0 })
  totalStudents: number;

  @Prop({ default: 0 })
  avgRating: number;

  // Fellow-specific fields
  @Prop({ type: FellowData, default: null })
  fellowData: FellowData;

  // Category access control
  @Prop([{ type: Types.ObjectId, ref: 'Category' }])
  purchasedCategories: Types.ObjectId[];

  // Password management
  @Prop({ default: false })
  mustSetPassword: boolean; // Flag for admin-created users to set password on first login

  // Timestamps (managed by mongoose)
  createdAt: Date;
  updatedAt: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);

// Create indexes
UserSchema.index({ role: 1 });
UserSchema.index({ 'fellowData.fellowId': 1 });
UserSchema.index({ createdAt: -1 });
UserSchema.index({ lastLogin: -1 });