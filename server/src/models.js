import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true, lowercase: true },
    name: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
    lastSeen: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

userSchema.methods.toPublic = function () {
  return { id: this._id.toString(), username: this.username, name: this.name, lastSeen: this.lastSeen };
};

const messageSchema = new mongoose.Schema(
  {
    from: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    to: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    text: { type: String, required: true, maxlength: 4000 },
    status: { type: String, enum: ['sent', 'delivered', 'read'], default: 'sent' },
  },
  { timestamps: true }
);
messageSchema.index({ from: 1, to: 1, createdAt: -1 });

messageSchema.methods.toPublic = function () {
  return {
    id: this._id.toString(),
    from: this.from.toString(),
    to: this.to.toString(),
    text: this.text,
    status: this.status,
    createdAt: this.createdAt,
  };
};

export const User = mongoose.model('User', userSchema);
export const Message = mongoose.model('Message', messageSchema);
