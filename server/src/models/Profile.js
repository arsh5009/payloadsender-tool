import mongoose from 'mongoose';

const profileSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    host: { type: String, required: true },
    port: { type: Number, required: true, min: 1, max: 65535 },
    transport: { type: String, enum: ['TCP', 'UDP'], required: true },
  },
  { timestamps: true },
);

export const Profile = mongoose.models.Profile || mongoose.model('Profile', profileSchema);
