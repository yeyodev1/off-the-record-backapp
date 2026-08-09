import { Schema } from "mongoose";

export const BLOCK_KINDS = [
  "paragraph",
  "heading",
  "subheading",
  "intertitle",
  "list",
  "quote",
  "divider",
  "callout",
  "media",
  "embed",
  "chart",
  "infographic",
] as const;

export const ATTACHMENT_KINDS = ["image", "video", "audio", "document"] as const;

export const AI_ASSET_KINDS = ["image", "infographic", "audio", "video", "summary", "headline"] as const;

export const CONTENT_STATUSES = ["draft", "review", "scheduled", "published", "archived"] as const;

/**
 * A single presentational block of a report or update.
 * Blocks carry their own typography so the newsroom can control
 * fonts, sizes, indentation, alignment and line height per section.
 */
export const blockSchema = new Schema(
  {
    uid: { type: String, required: true },
    kind: { type: String, enum: BLOCK_KINDS, default: "paragraph" },
    html: { type: String, default: "" },
    text: { type: String, default: "" },
    items: { type: [String], default: [] },
    ordered: { type: Boolean, default: false },
    level: { type: Number, default: 2 },
    color: { type: String, default: "" },
    background: { type: String, default: "" },
    align: { type: String, enum: ["left", "center", "right", "justify"], default: "left" },
    indent: { type: Number, default: 0 },
    lineHeight: { type: Number, default: 1.7 },
    fontFamily: { type: String, default: "" },
    fontSize: { type: String, default: "" },
    assetUrl: { type: String, default: "" },
    assetKind: { type: String, default: "" },
    caption: { type: String, default: "" },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false },
);

export const attachmentSchema = new Schema(
  {
    uid: { type: String, required: true },
    kind: { type: String, enum: ATTACHMENT_KINDS, required: true },
    url: { type: String, required: true },
    name: { type: String, default: "" },
    mime: { type: String, default: "" },
    bytes: { type: Number, default: 0 },
    caption: { type: String, default: "" },
    provider: { type: String, default: "cloudinary" },
    publicId: { type: String, default: "" },
    source: { type: String, enum: ["upload", "ai", "external"], default: "upload" },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

export const aiAssetSchema = new Schema(
  {
    uid: { type: String, required: true },
    kind: { type: String, enum: AI_ASSET_KINDS, required: true },
    status: { type: String, enum: ["queued", "ready", "failed", "unavailable"], default: "queued" },
    prompt: { type: String, default: "" },
    url: { type: String, default: "" },
    text: { type: String, default: "" },
    provider: { type: String, default: "" },
    model: { type: String, default: "" },
    error: { type: String, default: "" },
    data: { type: Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

export const spellIssueSchema = new Schema(
  {
    message: { type: String, default: "" },
    excerpt: { type: String, default: "" },
    suggestion: { type: String, default: "" },
    rule: { type: String, default: "" },
    severity: { type: String, enum: ["error", "warning", "style"], default: "warning" },
    offset: { type: Number, default: 0 },
    length: { type: Number, default: 0 },
  },
  { _id: false },
);

export const spellcheckSchema = new Schema(
  {
    score: { type: Number, default: 100 },
    issues: { type: [spellIssueSchema], default: [] },
    checkedAt: { type: Date, default: null },
    engine: { type: String, default: "" },
  },
  { _id: false },
);

export const shareSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    token: { type: String, default: "" },
    expiresAt: { type: Date, default: null },
    visits: { type: Number, default: 0 },
    lastVisitAt: { type: Date, default: null },
    channel: { type: String, default: "signal" },
  },
  { _id: false },
);

export const statsSchema = new Schema(
  {
    views: { type: Number, default: 0 },
    uniqueViews: { type: Number, default: 0 },
    shareVisits: { type: Number, default: 0 },
    avgSeconds: { type: Number, default: 0 },
    lastReadAt: { type: Date, default: null },
  },
  { _id: false },
);
