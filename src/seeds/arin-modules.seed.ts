import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Module, ModuleLevel, ModuleStatus } from '../schemas/module.schema';
import { User } from '../schemas/user.schema';

const INSTRUCTOR_EMAIL = 'arinafrica0@gmail.com';

const ARIN_MODULES = [
  {
    title: 'Academic Writing Mastery',
    description:
      'To equip participants with the skills required to develop high-quality scholarly manuscripts that meet international publishing standards.',
    duration: '3 Sessions · 9–12 Hours',
    learningOutcomes: [
      'Structure a publishable academic manuscript',
      'Develop clear research arguments',
      'Write compelling abstracts and introductions',
      'Present findings effectively',
      'Select appropriate journals for publication',
      'Improve manuscript quality before submission',
    ],
    assignment: 'Develop a complete manuscript outline for a selected study.',
    expectedOutput: 'Draft manuscript ready for mentorship review.',
  },
  {
    title: 'Navigating the Publishing Process',
    description:
      'To prepare participants for successful engagement with editors, reviewers, and publishers.',
    duration: '2 Sessions · 6–8 Hours',
    learningOutcomes: [
      'Understand peer review systems',
      'Respond effectively to reviewers',
      'Manage revisions professionally',
      'Recognise predatory journals',
      'Understand publication workflows',
    ],
    assignment: 'Prepare a reviewer response matrix.',
    expectedOutput: 'Reviewer response letter and revised manuscript section.',
  },
  {
    title: 'Research Impact and Open Science',
    description:
      'To help researchers maximise visibility, accessibility, and impact of their research.',
    duration: '2 Sessions · 6–8 Hours',
    learningOutcomes: [
      'Understand open science principles',
      'Increase citation potential',
      'Build researcher profiles',
      'Track research impact',
      'Use repositories effectively',
    ],
    assignment: 'Develop a personal research visibility plan.',
    expectedOutput: 'Research impact enhancement strategy.',
  },
  {
    title: 'Science Communication for Policy Impact',
    description:
      "To strengthen participants' ability to translate research into policy and public influence.",
    duration: '3 Sessions · 9–12 Hours',
    learningOutcomes: [
      'Write policy briefs',
      'Develop evidence-based narratives',
      'Engage media effectively',
      'Communicate with non-specialist audiences',
      'Use storytelling for impact',
    ],
    assignment: 'One policy brief, one opinion article, one media release.',
    expectedOutput: 'Policy communication package.',
  },
  {
    title: 'Ethical Publishing & Research Integrity',
    description: 'To promote responsible conduct in research and publishing.',
    duration: '2 Sessions · 6–8 Hours',
    learningOutcomes: [
      'Understand research ethics',
      'Avoid plagiarism',
      'Apply authorship standards',
      'Ensure transparency and reproducibility',
    ],
    assignment: 'Develop an ethical compliance checklist.',
    expectedOutput: 'Research integrity action plan.',
  },
  {
    title: 'Responsible Use of AI in Academic Writing',
    description:
      'To enable participants to use AI responsibly while maintaining academic integrity.',
    duration: '2 Sessions · 6–8 Hours',
    learningOutcomes: [
      'Use AI tools ethically',
      'Understand AI limitations',
      'Apply disclosure requirements',
      'Protect data privacy',
      'Maintain originality',
    ],
    assignment: 'Prepare an AI-assisted writing workflow.',
    expectedOutput: 'Responsible AI use protocol.',
  },
  {
    title: 'Linking Research to the SDGs',
    description:
      'To strengthen the alignment of research with global sustainable development priorities.',
    duration: '2 Sessions · 6–8 Hours',
    learningOutcomes: [
      'Map research to SDGs',
      'Develop impact pathways',
      'Demonstrate policy relevance',
      'Frame evidence for donors and policymakers',
    ],
    assignment:
      'Prepare an SDG alignment and impact statement for a manuscript or policy product.',
    expectedOutput: 'Research-to-SDG impact framework.',
  },
];

async function seedArinModules() {
  const app = await NestFactory.create(AppModule);

  try {
    const categoryModel = app.get(getModelToken('Category'));
    const moduleModel = app.get(getModelToken(Module.name));
    const userModel = app.get(getModelToken(User.name));

    const matchingCategories = await categoryModel.find({
      name: { $regex: /^arin publishing academy$/i },
    });
    if (matchingCategories.length === 0) {
      console.error(
        '✗ "Arin Publishing Academy" category not found. Run categories.seed.ts first.',
      );
      return;
    }
    if (matchingCategories.length > 1) {
      console.warn(
        `⚠️ Found ${matchingCategories.length} categories matching "Arin Publishing Academy" (duplicate data). Using the active one.`,
      );
    }
    const category =
      matchingCategories.find((c) => c.isActive) || matchingCategories[0];

    const instructor = await userModel.findOne({ email: INSTRUCTOR_EMAIL });
    if (!instructor) {
      console.error(
        `✗ Instructor account ${INSTRUCTOR_EMAIL} not found. Create the account first, then re-run this seed.`,
      );
      return;
    }

    let createdCount = 0;
    for (let i = 0; i < ARIN_MODULES.length; i++) {
      const m = ARIN_MODULES[i];
      const existing = await moduleModel.findOne({
        title: m.title,
        categoryId: category._id,
      });
      if (existing) {
        console.log(`• Skipped (already exists): ${m.title}`);
        continue;
      }

      // These fields are edited via the Quill rich-text editor, which stores
      // (and expects) HTML. Feeding it plain text with no tags causes Quill's
      // own normalization to fire onChange on mount, creating a render loop
      // ("Maximum update depth exceeded") the moment the edit page opens.
      const asHtml = (text: string) => `<p>${text}</p>`;

      await moduleModel.create({
        title: m.title,
        description: asHtml(m.description),
        goal: asHtml(m.description),
        assignment: asHtml(m.assignment),
        expectedOutput: asHtml(m.expectedOutput),
        categoryId: category._id,
        // "beginner" avoids the student-side level-gating system (a module isn't
        // accessible until a fellow's progression reaches its level) since these
        // 7 modules aren't meant to be tiered by difficulty.
        level: ModuleLevel.BEGINNER,
        status: ModuleStatus.DRAFT,
        instructorIds: [instructor._id],
        createdBy: instructor._id,
        createdByRole: 'instructor',
        lessons: [],
        order: i + 1,
        duration: m.duration,
        // Joined with '\n' (not '; ') to match how the edit page's
        // DynamicStringList splits this string back into separate list items.
        learningOutcomes: m.learningOutcomes.join('\n'),
        isActive: true,
      });
      createdCount += 1;
      console.log(`✓ Created module: ${m.title}`);
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(
      `Arin Publishing Academy modules seeded: ${createdCount} new, ${ARIN_MODULES.length - createdCount} skipped`,
    );
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  } catch (error) {
    console.error('✗ Error seeding Arin Publishing Academy modules:', error.message);
  } finally {
    await app.close();
  }
}

seedArinModules();
