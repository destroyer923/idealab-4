export type ID = string;
export type Vars = Record<string, string | number>;
/** Translation key; UI looks it up instead of rendering stored text. */
export type Key = string;

export type UserRole = "member" | "reviewer" | "admin";

export interface User {
  id: ID;
  email: string;
  /** Reviewer accounts can action business-evidence and listing moderation. */
  role: UserRole;
  /** Account status; suspended users cannot sign in or act. */
  status: "active" | "suspended";
  passwordHash: string;
  salt: string;
  createdAt: string;
}

export interface Visibility {
  bio: boolean;
  location: boolean;
  skills: boolean;
  portfolio: boolean;
}

export interface NotificationPrefs {
  messages: boolean;
  exchanges: boolean;
  reviews: boolean;
}

export type SkillLevel = "" | "beginner" | "intermediate" | "expert";

export interface Skill {
  id: ID;
  name: string;
  category: string;
  level: SkillLevel;
  description: string;
}

export interface PortfolioItem {
  id: ID;
  title: string;
  image?: string;
  link?: string;
}

export interface Profile {
  userId: ID;
  fullName: string;
  username: string;
  bio: string;
  occupation: string;
  roles: string[];
  location: string;
  languages: string[];
  skills: Skill[];
  interests: string[];
  collabTypes: string[];
  availability: string;
  avatar?: string;
  cover?: string;
  portfolio: PortfolioItem[];
  visibility: Visibility;
  prefs: NotificationPrefs;
  /** Public, non-sensitive token encoded in the member's personal QR code. */
  qrToken?: string;
  /** Interface language preference; absent on older profiles (defaults to English). */
  language?: "en" | "mr" | "hi";
  createdAt: string;
  updatedAt: string;
}

export type ListingKind = "offer" | "need";
export type OfferStatus = "draft" | "pending_review" | "active" | "inactive" | "rejected";
export type NeedStatus = "draft" | "pending_review" | "open" | "matched" | "in_progress" | "fulfilled" | "paused" | "rejected";
export type WorkMode = "" | "remote" | "in_person" | "both";

export interface Listing {
  id: ID;
  ownerId: ID;
  kind: ListingKind;
  title: string;
  category: string;
  type: string;
  description: string;
  /** Offer: what I can provide. Need: what I need. */
  details: string;
  /** Offer: what I'd like in return. Need: what I can offer in exchange. Optional. */
  exchangePref: string;
  location: string;
  availability: string;
  mode: WorkMode;
  quantity: string;
  tags: string[];
  images: string[];
  status: OfferStatus | NeedStatus;
  /** True when the author declared this a registered business / enterprise. */
  businessClaimed?: boolean;
  /** Translation key explaining why moderation is required or why it was rejected. */
  reviewReason?: Key;
  reviewReasonVars?: Vars;
  reviewedBy?: ID;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export type ExchangeStatus = "pending" | "declined" | "withdrawn" | "active" | "completed" | "cancelled";
export type CommitmentProgress = "not_started" | "in_progress" | "ready" | "confirmed";

export interface Commitment {
  userId: ID;
  description: string;
  progress: CommitmentProgress;
  submission?: { note: string; link: string; at: string };
  feedback?: { note: string; at: string };
  confirmedAt?: string;
}

export type DeliveryStatus = "not_started" | "dispatched" | "handed_over" | "received";

export interface Delivery {
  required: boolean;
  method: string;
  status: DeliveryStatus;
  date: string;
  reference: string;
  updatedAt?: string;
  updatedBy?: ID;
}

export interface Amendment {
  byUserId: ID;
  commitments: { userId: ID; description: string }[];
  targetDate: string;
  createdAt: string;
}

export interface Exchange {
  id: ID;
  requesterId: ID;
  recipientId: ID;
  listingId?: ID;
  offeredListingId?: ID;
  title: string;
  category: string;
  message: string;
  commitments: Commitment[];
  targetDate: string;
  status: ExchangeStatus;
  delivery: Delivery;
  amendment?: Amendment;
  createdAt: string;
  updatedAt: string;
  respondedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  cancelledBy?: ID;
  cancelReason?: string;
}

export type MilestoneStatus = "not_started" | "in_progress" | "completed";

export interface Milestone {
  id: ID;
  exchangeId: ID;
  title: string;
  description: string;
  dueDate: string;
  status: MilestoneStatus;
  createdBy: ID;
  updatedBy: ID;
  createdAt: string;
  updatedAt: string;
}

export type EventType =
  | "request_created"
  | "request_accepted"
  | "request_declined"
  | "request_withdrawn"
  | "progress_changed"
  | "work_submitted"
  | "revision_requested"
  | "commitment_confirmed"
  | "exchange_completed"
  | "exchange_cancelled"
  | "milestone_created"
  | "milestone_updated"
  | "progress_note"
  | "delivery_updated"
  | "amendment_proposed"
  | "amendment_accepted"
  | "amendment_rejected"
  | "review_received";

export interface ActivityEvent {
  id: ID;
  exchangeId?: ID;
  audience: ID[];
  actorId: ID;
  type: EventType;
  /** Legacy English text (older records). New records use key + vars. */
  text: string;
  key?: string;
  vars?: Vars;
  body?: string;
  createdAt: string;
}

export type ContextType = "none" | "listing" | "exchange";

export interface Conversation {
  id: ID;
  key: string;
  participantIds: [ID, ID];
  contextType: ContextType;
  contextId?: ID;
  createdAt: string;
  lastMessageAt: string;
}

export interface Message {
  id: ID;
  conversationId: ID;
  senderId: ID;
  body: string;
  createdAt: string;
  readAt?: string;
}

export interface AppNotification {
  id: ID;
  userId: ID;
  kind: "message" | "exchange" | "review" | "verification" | "connection";
  text: string;
  key?: string;
  vars?: Vars;
  link: string;
  refId?: ID;
  createdAt: string;
  readAt?: string;
}

export type ConnectionStatus = "pending" | "accepted" | "rejected";

export interface Connection {
  id: ID;
  requesterId: ID;
  recipientId: ID;
  status: ConnectionStatus;
  createdAt: string;
  updatedAt: string;
  respondedAt?: string;
}

export interface SavedListing {
  id: ID;
  userId: ID;
  listingId: ID;
  createdAt: string;
}

export interface Review {
  id: ID;
  exchangeId: ID;
  reviewerId: ID;
  recipientId: ID;
  rating: number;
  comment: string;
  createdAt: string;
  updatedAt?: string;
}

export interface Block {
  blockerId: ID;
  blockedId: ID;
  createdAt: string;
}

export interface Report {
  id: ID;
  reporterId: ID;
  targetType: "review" | "user";
  targetId: ID;
  reason: string;
  createdAt: string;
}

export type CheckStatus = "not_started" | "pending" | "verified" | "rejected" | "unavailable";
export type TrustTier = "new" | "contact_verified" | "business_verified" | "identity_verified";

export interface ContactCheck {
  status: CheckStatus;
  /** Masked destination, e.g. +91****5678 — never the full value. */
  masked: string;
  at?: string;
  attempts: number;
  lastSentAt?: string;
  note?: Key;
}

export type BusinessType = "farmer" | "artisan" | "seller" | "designer" | "transporter" | "trader" | "service" | "other";

export interface BusinessDocument {
  title: string;
  type: "photo" | "text" | "link";
  value: string;
}

export interface BusinessEvidence {
  businessType: BusinessType;
  businessName: string;
  ownerName: string;
  udyamNumber: string;
  location: string;
  description: string;
  documents: BusinessDocument[];
}

export interface BusinessCheck {
  status: CheckStatus;
  submittedAt?: string;
  reviewedAt?: string;
  reviewedBy?: ID;
  /** Translation key explaining a rejection. */
  rejectionReason?: Key;
  rejectionVars?: Vars;
  evidence?: BusinessEvidence;
}

export interface IdentitySubmission {
  fullName: string;
  /** Masked reference to a government identity document; never the document itself. */
  idReference: string;
  note: string;
}

export interface IdentityCheck {
  status: CheckStatus;
  at?: string;
  note?: Key;
  submission?: IdentitySubmission;
  submittedAt?: string;
  reviewedAt?: string;
  reviewedBy?: ID;
  rejectionReason?: Key;
  rejectionVars?: Vars;
}

export interface Verification {
  userId: ID;
  phone: ContactCheck;
  email: ContactCheck;
  business: BusinessCheck;
  identity: IdentityCheck;
  /** Completed exchanges the member took part in (derived count kept for display). */
  completedExchanges: number;
  trust: TrustTier;
  updatedAt: string;
}

export interface Otp {
  id: ID;
  userId: ID;
  channel: "phone" | "email";
  destination: string;
  /** SHA-256(salt + code); the code itself is never stored. */
  otpHash: string;
  salt: string;
  expiresAt: string;
  attempts: number;
  attemptsAt: number[];
  createdAt: string;
  sentAt: string;
}

export type VerifyEventType =
  | "otp_requested"
  | "otp_failed_send"
  | "otp_verified"
  | "identity_submitted"
  | "identity_reviewed"
  | "otp_attempts_exhausted"
  | "otp_expired"
  | "business_submitted"
  | "business_reviewed"
  | "identity_unavailable"
  | "listing_needs_review"
  | "listing_approved"
  | "listing_rejected"
  | "listing_resubmitted"
  | "role_changed";

export interface VerifyEvent {
  id: ID;
  userId: ID;
  actorId: ID;
  type: VerifyEventType;
  key: Key;
  vars?: Vars;
  body?: string;
  createdAt: string;
}

export interface ProviderConfig {
  channel: "phone" | "email";
  type: "none" | "http" | "demo";
  endpoint: string;
  apiToken: string;
  label: string;
}

export interface IdentityProviderConfig {
  channel: "identity";
  /** none = unavailable (blocks publishing); http = real provider; manual = reviewer-approved workflow */
  type: "none" | "http" | "manual";
  endpoint: string;
  apiToken: string;
  label: string;
}

export interface VerifyConfig {
  phone: ProviderConfig;
  email: ProviderConfig;
  identity: IdentityProviderConfig;
  /** Categories that require business verification before publishing. */
  requiredBusinessCategories: string[];
}

export interface DB {
  users: User[];
  profiles: Profile[];
  listings: Listing[];
  exchanges: Exchange[];
  milestones: Milestone[];
  events: ActivityEvent[];
  conversations: Conversation[];
  messages: Message[];
  notifications: AppNotification[];
  saved: SavedListing[];
  reviews: Review[];
  blocks: Block[];
  reports: Report[];
  connections: Connection[];
  verifications: Verification[];
  otps: Otp[];
  verifyEvents: VerifyEvent[];
  verifyConfig: VerifyConfig;
}

/** Public-safe view of a member — never includes email/credentials. */
export interface PublicVerification {
  phoneVerified: boolean;
  emailVerified: boolean;
  businessVerified: boolean;
  identityVerified: boolean;
  completedExchanges: number;
  trust: TrustTier;
}

/** Public-safe view of a member — never includes email/credentials/evidence. */
export interface PublicMember {
  userId: ID;
  fullName: string;
  username: string;
  occupation: string;
  avatar?: string;
  location?: string;
  verification?: PublicVerification;
}
