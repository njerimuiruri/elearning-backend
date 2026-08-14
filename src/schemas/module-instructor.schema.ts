import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types, Document, SchemaTypes } from 'mongoose';

export enum ModuleInstructorRole {
  LEAD = 'lead',
  CO = 'co',
  EDITOR = 'editor',
}

export interface ModuleInstructorPermissions {
  canEditLessons: boolean;
  canAddQuizzes: boolean;
  canUploadResources: boolean;
  canReviewContent: boolean;
  canPublish?: boolean;
  canDelete?: boolean;
  canRemoveInstructors?: boolean;
}

@Schema({ _id: false })
export class ModuleInstructor {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  instructorId: Types.ObjectId;

  @Prop({ enum: ModuleInstructorRole, required: true })
  role: ModuleInstructorRole;

  @Prop({ type: Object, required: true })
  permissions: ModuleInstructorPermissions;
}

export const ModuleInstructorSchema =
  SchemaFactory.createForClass(ModuleInstructor);
