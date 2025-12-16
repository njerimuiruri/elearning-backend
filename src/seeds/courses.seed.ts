import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Course, CourseLevel, CourseStatus } from '../schemas/course.schema';
import { User, UserRole, InstructorStatus } from '../schemas/user.schema';
import * as bcrypt from 'bcrypt';

async function seedCourses() {
  const app = await NestFactory.create(AppModule);

  const categoryModel = app.get(getModelToken('Category'));
  let arinCategory: any;
  try {
    arinCategory = await categoryModel.findOne({ name: 'ARIN Publishing Academy' });
    if (!arinCategory) {
      arinCategory = await categoryModel.create({
        name: 'ARIN Publishing Academy',
        description: 'ARIN Publishing Academy',
        isActive: true
      });
      console.log('✓ Seeded ARIN Publishing Academy category');
    } else {
      console.log('✓ ARIN Publishing Academy category already exists');
    }
  } catch (err) {
    console.error('✗ Error seeding ARIN Publishing Academy category:', err.message);
    return;
  }

  try {
    const courseModel = app.get(getModelToken(Course.name));
    const userModel = app.get(getModelToken(User.name));


    // Ensure default instructors exist (for demo: one or two)
    const instructorEmails = [
      'academy.instructor@arin.com',
      'co.instructor@arin.com',
    ];
    const instructors: any[] = [];
    for (const email of instructorEmails) {
      let inst: any = await userModel.findOne({ email });
      if (!inst) {
        const hashedPassword = await bcrypt.hash('Instructor@123', 10);
        inst = await userModel.create({
          firstName: email === instructorEmails[0] ? 'Arin' : 'Co',
          lastName: 'Instructor',
          email,
          password: hashedPassword,
          role: UserRole.INSTRUCTOR,
          instructorStatus: InstructorStatus.APPROVED,
          isActive: true,
          emailVerified: true,
        });
        console.log('✓ Created default instructor:', email);
      } else {
        console.log('✓ Using existing instructor:', email);
      }
      instructors.push(inst);
    }

    const now = new Date();

    const defaultCourses = [
      {
        title: 'Academic Writing Mastery',
        description:
          'Develop clear, compelling academic manuscripts with strong structure, argumentation, and publication-ready polish.',
        category: arinCategory._id,
        level: CourseLevel.INTERMEDIATE,
        status: CourseStatus.PUBLISHED,
        instructorIds: [instructors[0]._id], // Only Arin instructor
        thumbnailUrl:
'https://images.unsplash.com/photo-1505373877841-8d25f7d46678?w=1200&q=80&auto=format&fit=crop',
        modules: [
          {
            title: 'Foundations of Scholarly Writing',
            description: 'Strengthen clarity, coherence, and academic tone with practical frameworks.',
            content: 'Audience, research questions, contribution statements, and thesis clarity.',
            duration: 55,
            order: 0,
          },
          {
            title: 'Structuring Journal-Ready Manuscripts',
            description: 'IMRaD structure, flow, and argumentation that meets reviewer expectations.',
            content: 'Abstracts, introductions, methods rigor, results storytelling, and impactful discussions.',
            duration: 60,
            order: 1,
          },
          {
            title: 'Revision, Style, and Reviewer Response',
            description: 'Polish drafts, manage edits, and respond effectively to peer review.',
            content: 'Style guides, tightening prose, checklist-driven revisions, and response letters.',
            duration: 50,
            order: 2,
          },
        ],
        requirements: ['Basic familiarity with research methods'],
        targetAudience: ['Graduate researchers', 'Early-career academics'],
        publishedAt: now,
        approvedAt: now,
        submittedAt: now,
        isActive: true,
      },
      {
        title: 'Navigating the Publishing Process',
        description:
          'Master journal selection, submission workflows, timelines, and post-publication visibility.',
        category: arinCategory._id,
        level: CourseLevel.INTERMEDIATE,
        status: CourseStatus.PUBLISHED,
        instructorIds: [instructors[0]._id], // Only Arin instructor
        thumbnailUrl:
          'https://images.unsplash.com/photo-1521587760476-6c12a4b040da?w=1200&q=80&auto=format&fit=crop',
        modules: [
          {
            title: 'Journal Strategy and Fit',
            description: 'Align scope, audience, and impact factors with your manuscript goals.',
            content: 'Aims and scope checks, desk-reject avoidance, and targeting special issues.',
            duration: 45,
            order: 0,
          },
          {
            title: 'Submission to Decision Workflow',
            description: 'Smooth submissions, cover letters, and managing revisions efficiently.',
                  category: arinCategory._id,
            duration: 50,
            order: 1,
          },
          {
            title: 'Post-Publication Visibility',
            description: 'Boost reach through indexing, sharing, and researcher profiles.',
            content: 'ORCID, Google Scholar, repository deposits, and altmetrics fundamentals.',
            duration: 40,
            order: 2,
          },
        ],
        requirements: ['Draft manuscript or active research project'],
        targetAudience: ['Researchers preparing first or second submissions'],
        publishedAt: now,
        approvedAt: now,
        submittedAt: now,
        isActive: true,
      },
      {
        title: 'Research Impact and Open Science',
        description:
          'Increase citation potential and societal impact through open practices and impact planning.',
        category: arinCategory._id,
        level: CourseLevel.BEGINNER,
        status: CourseStatus.PUBLISHED,
        instructorIds: [instructors[0]._id], // Only Arin instructor
        thumbnailUrl:
        'https://images.unsplash.com/photo-1505373877841-8d25f7d46678?w=1200&q=80&auto=format&fit=crop',

        modules: [
          {
            title: 'Designing for Impact',
            description: 'Plan pathways to academic and societal impact from project inception.',
            content: 'Impact narratives, stakeholder mapping, and impact indicators.',
            duration: 45,
            order: 0,
          },
          {
            title: 'Open Science Foundations',
            description: 'Adopt transparency, data sharing, and reproducibility best practices.',
                  category: arinCategory._id,
            duration: 50,
            order: 1,
          },
          {
            title: 'Measuring and Communicating Impact',
            description: 'Use metrics responsibly and communicate outcomes clearly.',
            content: 'Citation metrics, altmetrics, impact case studies, and reporting.',
            duration: 40,
            order: 2,
          },
        ],
        requirements: ['Willingness to share data/code when possible'],
        targetAudience: ['Research teams', 'Policy-facing projects', 'Open science practitioners'],
        publishedAt: now,
        approvedAt: now,
        submittedAt: now,
        isActive: true,
      },
      {
        title: 'Science Communication for Policy Impact',
        description:
          'Translate research into concise, persuasive outputs that resonate with policymakers and stakeholders.',
        category: arinCategory._id,
        level: CourseLevel.INTERMEDIATE,
        status: CourseStatus.PUBLISHED,
        instructorIds: [instructors[0]._id], // Only Arin instructor
        thumbnailUrl:
          'https://images.unsplash.com/photo-1505373877841-8d25f7d46678?w=1200&q=80&auto=format&fit=crop',
        modules: [
          {
            title: 'Audience-Centric Messaging',
            description: 'Craft policy-relevant narratives that align with stakeholder priorities.',
            content: 'Problem framing, evidence hierarchy, and clarity for non-specialists.',
            duration: 45,
            order: 0,
          },
          {
            title: 'Policy Briefs and Presentations',
            description: 'Structure briefs and slide decks that drive decisions.',
                  category: arinCategory._id,
            duration: 50,
            order: 1,
          },
          {
            title: 'Engagement and Media Strategy',
            description: 'Plan outreach, events, and media interactions responsibly.',
            content: 'Stakeholder maps, op-eds, interviews, and risk mitigation.',
            duration: 40,
            order: 2,
          },
        ],
        requirements: ['Draft findings or policy-relevant evidence'],
        targetAudience: ['Researchers engaging with government or NGOs'],
        publishedAt: now,
        approvedAt: now,
        submittedAt: now,
        isActive: true,
      },
      {
        title: 'Ethical Publishing and Research Integrity',
        description:
          'Protect credibility through rigorous ethics, authorship standards, and compliance best practices.',
        category: arinCategory._id,
        level: CourseLevel.BEGINNER,
        status: CourseStatus.PUBLISHED,
        instructorIds: [instructors[0]._id], // Only Arin instructor
        thumbnailUrl:
'https://images.unsplash.com/photo-1505373877841-8d25f7d46678?w=1200&q=80&auto=format&fit=crop',
        modules: [
          {
            title: 'Core Ethics and Authorship',
            description: 'Apply authorship criteria, conflict disclosures, and ethical approvals.',
            content: 'COPE guidelines, contributor roles, and transparent declarations.',
            duration: 45,
            order: 0,
          },
          {
            title: 'Integrity in Data and Methods',
            description: 'Prevent questionable research practices and ensure reproducibility.',
                  category: arinCategory._id,
            duration: 50,
            order: 1,
          },
          {
            title: 'Handling Misconduct and Corrections',
            description: 'Respond to errors, retractions, and post-publication issues responsibly.',
            content: 'Errata processes, plagiarism safeguards, and whistleblowing channels.',
            duration: 40,
            order: 2,
          },
        ],
        requirements: ['Commitment to research integrity'],
        targetAudience: ['All researchers', 'Editors', 'Supervisors'],
        publishedAt: now,
        approvedAt: now,
        submittedAt: now,
        isActive: true,
      },
    ];

    let createdCount = 0;

    for (const course of defaultCourses) {
      const existing = await courseModel.findOne({ title: course.title });
      if (existing) {
        console.log(`• Skipped (already exists): ${course.title}`);
        continue;
      }

      await courseModel.create(course);
      createdCount += 1;
      console.log(`✓ Created course: ${course.title}`);
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Courses seeded: ${createdCount} new, ${defaultCourses.length - createdCount} skipped`);
    console.log('Category: Arin Publishing Academy');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  } catch (error) {
    console.error('✗ Error seeding courses:', error.message);
  } finally {
    await app.close();
  }
}

seedCourses();
