import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class CourseFormat extends Document {
  @Prop({ required: true })
  fileName: string;

  @Prop({ required: true })
  filePath: string; // Path to the uploaded file (e.g., 'uploads/course-formats/filename.pdf')

  @Prop({ required: true })
  fileType: string; // 'pdf' or 'doc' or 'docx'

  @Prop({ required: true })
  fileSize: number; // File size in bytes

  @Prop({ required: false })
  description?: string; // Optional description about the format document

  @Prop({ required: false })
  version?: string; // Version of the course format

  @Prop({ default: Date.now })
  uploadedAt: Date;

  @Prop({ required: false })
  uploadedBy?: string; // Admin ID who uploaded the document

  @Prop({ default: true })
  isActive: boolean; // To allow soft delete or deactivation
}

export const CourseFormatSchema = SchemaFactory.createForClass(CourseFormat);
