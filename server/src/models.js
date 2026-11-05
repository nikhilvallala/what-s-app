import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

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

const groupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    members: [{ type: ObjectId, ref: 'User', index: true }],
    admin: { type: ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

groupSchema.methods.toPublic = function () {
  return {
    id: this._id.toString(),
    name: this.name,
    members: this.members.map(String),
    admin: this.admin.toString(),
    isGroup: true,
  };
};

const attachmentSchema = new mongoose.Schema(
  { url: String, name: String, mime: String, size: Number },
  { _id: false }
);

// A message is either direct (`to` set) or to a group (`group` set).
const messageSchema = new mongoose.Schema(
  {
    from: { type: ObjectId, ref: 'User', required: true, index: true },
    to: { type: ObjectId, ref: 'User', index: true },
    group: { type: ObjectId, ref: 'Group', index: true },
    text: { type: String, default: '', maxlength: 4000 },
    attachment: { type: attachmentSchema, default: undefined },
    status: { type: String, enum: ['sent', 'delivered', 'read'], default: 'sent' },
    readBy: [{ type: ObjectId, ref: 'User' }],
  },
  { timestamps: true }
);
messageSchema.index({ from: 1, to: 1, createdAt: -1 });
messageSchema.index({ group: 1, createdAt: -1 });

messageSchema.methods.toPublic = function () {
  return {
    id: this._id.toString(),
    from: this.from.toString(),
    to: this.to?.toString(),
    group: this.group?.toString(),
    text: this.text,
    attachment: this.attachment || null,
    status: this.status,
    createdAt: this.createdAt,
  };
};

export const User = mongoose.model('User', userSchema);
export const Group = mongoose.model('Group', groupSchema);
export const Message = mongoose.model('Message', messageSchema);
