import mongoose from 'mongoose';

/** Metadata only. Payload contents are never stored. */
const transferRecordSchema = new mongoose.Schema(
  {
    host: { type: String, required: true },
    port: { type: Number, required: true },
    transport: { type: String, enum: ['TCP', 'UDP'], required: true },
    filename: { type: String, required: true, maxlength: 255 },
    byteCount: { type: Number, required: true },
    outcome: { type: String, enum: ['sent', 'cancelled', 'timedOut', 'failed'], required: true },
    detail: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const TransferRecord =
  mongoose.models.TransferRecord || mongoose.model('TransferRecord', transferRecordSchema);

export const MAX_HISTORY = 200;

/** Inserts a record and trims history to the newest MAX_HISTORY entries. */
export async function addRecord(data) {
  await TransferRecord.create(data);
  const old = await TransferRecord.find().sort({ createdAt: -1 }).skip(MAX_HISTORY).select('_id').lean();
  if (old.length) await TransferRecord.deleteMany({ _id: { $in: old.map((d) => d._id) } });
}
