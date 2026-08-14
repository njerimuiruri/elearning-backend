import mongoose from 'mongoose';
import { Module, ModuleSchema } from './src/schemas/module.schema';

async function main() {
  await mongoose.connect('mongodb://localhost:27018/elearning');
  for (const p of ['categoryId', 'createdBy', 'lastEditedBy', 'instructorIds']) {
    const path = ModuleSchema.path(p);
    console.log(p, '->', path?.constructor?.name, 'instance:', (path as any)?.instance);
  }
  const ModuleModel = mongoose.model(Module.name, ModuleSchema, 'modules');

  const doc = await ModuleModel.findOne({ title: /Science Communication for Policy Impact/i });
  if (!doc) { console.log('not found'); process.exit(1); }
  console.log('BEFORE in-memory categoryId:', doc.categoryId, doc.categoryId?.constructor?.name);

  const fakeDto: any = { title: doc.title, categoryId: '69ce216b97ba6be0d2f30b65' };
  Object.assign(doc, fakeDto, { lastEditedAt: new Date() });
  console.log('AFTER assign in-memory categoryId:', doc.categoryId, doc.categoryId?.constructor?.name);

  await doc.save();

  const raw: any = await mongoose.connection.db!.collection('modules').findOne({ _id: doc._id });
  console.log('AFTER save raw BSON categoryId type:', raw!.categoryId, raw!.categoryId.constructor.name);

  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
