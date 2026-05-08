import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Project, ProjectDocument } from './project.schema';
import { CloudinaryService } from '../common/services/cloudinary.service';

const MAX_DOCS_PER_USER = 5;

@Injectable()
export class ProjectsService {
  constructor(
    @InjectModel(Project.name) private projectModel: Model<ProjectDocument>,
    private cloudinaryService: CloudinaryService,
  ) {}

  // ── Student ────────────────────────────────────────────────────────────────

  async submitProject(
    studentId: string,
    studentName: string,
    title: string,
    description: string,
    tags: string[],
    file: Express.Multer.File,
  ): Promise<Project> {
    const existing = await this.projectModel.countDocuments({
      studentId,
      uploadedByAdmin: false,
    });
    if (existing >= MAX_DOCS_PER_USER) {
      throw new BadRequestException(
        `You have reached the ${MAX_DOCS_PER_USER}-document limit. Delete a pending submission to free a slot.`,
      );
    }

    const fileUrl = await this.cloudinaryService.uploadDocument(
      file.buffer,
      file.originalname,
    );

    const project = new this.projectModel({
      studentId,
      studentName,
      title,
      description,
      tags: tags ?? [],
      fileName: file.originalname,
      fileUrl,
      status: 'pending',
      uploadedByAdmin: false,
    });

    return project.save();
  }

  async getMySubmissions(studentId: string): Promise<Project[]> {
    return this.projectModel
      .find({ studentId, uploadedByAdmin: false })
      .sort({ createdAt: -1 })
      .exec();
  }

  async getAdminResourcesForFellow(fellowEmail: string): Promise<Project[]> {
    return this.projectModel
      .find({
        uploadedByAdmin: true,
        status: 'approved',
        $or: [{ targetEmail: null }, { targetEmail: fellowEmail }],
      })
      .sort({ createdAt: -1 })
      .exec();
  }

  async getCommunityProjects(params: {
    search?: string;
    tag?: string;
    limit?: number;
    skip?: number;
  }): Promise<Project[]> {
    const filter: any = { status: 'approved', uploadedByAdmin: false };
    if (params.search) {
      filter.$or = [
        { title: { $regex: params.search, $options: 'i' } },
        { description: { $regex: params.search, $options: 'i' } },
        { studentName: { $regex: params.search, $options: 'i' } },
      ];
    }
    if (params.tag) {
      filter.tags = { $in: [params.tag] };
    }
    return this.projectModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(params.limit ?? 100)
      .skip(params.skip ?? 0)
      .exec();
  }

  async updateSubmission(
    projectId: string,
    studentId: string,
    data: { title: string; description: string; tags: string[] },
  ): Promise<Project> {
    const project = await this.projectModel.findById(projectId);
    if (!project) throw new NotFoundException('Project not found');
    if (project.studentId.toString() !== studentId) {
      throw new ForbiddenException('You can only edit your own submissions');
    }
    if (project.status !== 'pending') {
      throw new ForbiddenException('Only pending submissions can be edited');
    }
    Object.assign(project, { title: data.title, description: data.description, tags: data.tags ?? [] });
    return project.save();
  }

  async rateProject(
    projectId: string,
    userId: string,
    value: number,
  ): Promise<Project> {
    if (value < 1 || value > 5) {
      throw new BadRequestException('Rating must be between 1 and 5');
    }
    const project = await this.projectModel.findById(projectId);
    if (!project) throw new NotFoundException('Project not found');
    if (project.status !== 'approved') {
      throw new BadRequestException('Only approved projects can be rated');
    }
    if (!project.uploadedByAdmin && project.studentId.toString() === userId) {
      throw new ForbiddenException('You cannot rate your own project');
    }

    const existingIdx = project.ratings.findIndex(
      (r) => r.userId.toString() === userId,
    );
    if (existingIdx >= 0) {
      project.ratings[existingIdx].value = value;
    } else {
      project.ratings.push({ userId: new Types.ObjectId(userId), value });
    }
    return project.save();
  }

  async deleteSubmission(projectId: string, studentId: string): Promise<void> {
    const project = await this.projectModel.findById(projectId);
    if (!project) throw new NotFoundException('Project not found');
    if (project.studentId.toString() !== studentId) {
      throw new ForbiddenException('You can only delete your own submissions');
    }
    if (project.status !== 'pending') {
      throw new ForbiddenException('Only pending submissions can be deleted');
    }
    await this.projectModel.findByIdAndDelete(projectId);
  }

  // ── Admin ──────────────────────────────────────────────────────────────────

  async adminUploadResource(
    adminId: string,
    adminName: string,
    data: {
      title: string;
      description: string;
      tags: string[];
      authorName: string;
      authorEmail: string;
      targetEmail?: string;
    },
    file: Express.Multer.File,
  ): Promise<Project> {
    const fileUrl = await this.cloudinaryService.uploadDocument(
      file.buffer,
      file.originalname,
    );

    const project = new this.projectModel({
      studentId: adminId,
      studentName: adminName,
      title: data.title,
      description: data.description,
      tags: data.tags ?? [],
      fileName: file.originalname,
      fileUrl,
      status: 'approved',
      uploadedByAdmin: true,
      authorName: data.authorName,
      authorEmail: data.authorEmail,
      targetEmail: data.targetEmail?.trim() || null,
    });

    return project.save();
  }

  async adminDeleteResource(projectId: string): Promise<void> {
    const project = await this.projectModel.findById(projectId);
    if (!project) throw new NotFoundException('Project not found');
    await this.projectModel.findByIdAndDelete(projectId);
  }

  async adminGetAll(params: {
    status?: string;
    search?: string;
    type?: string; // 'submissions' | 'resources' | 'all'
    limit?: number;
    skip?: number;
  }): Promise<{ projects: Project[]; total: number }> {
    const filter: any = {};
    if (params.type === 'submissions') filter.uploadedByAdmin = false;
    else if (params.type === 'resources') filter.uploadedByAdmin = true;

    if (params.status && params.status !== 'all') {
      filter.status = params.status;
    }
    if (params.search) {
      filter.$or = [
        { title: { $regex: params.search, $options: 'i' } },
        { studentName: { $regex: params.search, $options: 'i' } },
        { authorName: { $regex: params.search, $options: 'i' } },
      ];
    }
    const [projects, total] = await Promise.all([
      this.projectModel
        .find(filter)
        .sort({ createdAt: -1 })
        .limit(params.limit ?? 50)
        .skip(params.skip ?? 0)
        .exec(),
      this.projectModel.countDocuments(filter),
    ]);
    return { projects, total };
  }

  async adminApprove(projectId: string, feedback = ''): Promise<Project> {
    const project = await this.projectModel.findByIdAndUpdate(
      projectId,
      { status: 'approved', adminFeedback: feedback },
      { new: true },
    );
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async adminReject(projectId: string, feedback = ''): Promise<Project> {
    const project = await this.projectModel.findByIdAndUpdate(
      projectId,
      { status: 'rejected', adminFeedback: feedback },
      { new: true },
    );
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async adminAddFeedback(projectId: string, comment: string): Promise<Project> {
    const project = await this.projectModel.findByIdAndUpdate(
      projectId,
      { adminFeedback: comment },
      { new: true },
    );
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }
}
