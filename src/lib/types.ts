export type ID = string;
export type Vars = Record<string, string | number>;
/** Translation key; UI looks it up instead of rendering stored text. */
export type Key = string;

export type UserRole = "member" | "reviewer" | "admin";

export interface User {
  id: ID;
  email: string;
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
}

/** Public-safe view of a member — never includes email/credentials/evidence. */
export interface PublicMember {
  userId: ID;
  fullName: string;
  username: string;
  occupation: string;
  avatar?: string;
  location?: string;
}
