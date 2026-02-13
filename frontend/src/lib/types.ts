import type { ContactStatus, InteractionType, InteractionSource } from '@nge/shared';

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  title: string | null;
  company: string | null;
  linkedinUrl: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  headline: string | null;
  status: ContactStatus;
  seniority: string | null;
  relationshipScore: number;
  priorityScore: number | null;
  notes: string | null;
  introductionSource: string | null;
  mutualConnectionsCount: number;
  isActiveOnLinkedin: boolean;
  hasOpenToConnect: boolean;
  lastInteractionAt: string | null;
  fieldSources: Record<string, string> | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  categories: { contactId: string; categoryId: string; category: Category }[];
  tags: { contactId: string; tagId: string; tag: Tag }[];
}

export interface Category {
  id: string;
  name: string;
  relevanceWeight: number;
  createdAt: string;
}

export interface Tag {
  id: string;
  name: string;
  createdAt: string;
}

export interface Interaction {
  id: string;
  contactId: string;
  type: InteractionType;
  source: InteractionSource;
  occurredAt: string;
  metadata: Record<string, unknown> | null;
  pointsValue: number;
  createdAt: string;
}

export interface StatusHistoryEntry {
  id: string;
  contactId: string;
  fromStatus: ContactStatus | null;
  toStatus: ContactStatus;
  trigger: string;
  triggerReason: string | null;
  createdAt: string;
}

export interface ScoreHistoryEntry {
  id: string;
  contactId: string;
  scoreType: string;
  scoreValue: number;
  recordedAt: string;
}

export interface ContactWithHistory extends Contact {
  interactions: Interaction[];
  statusHistory: StatusHistoryEntry[];
  scoreHistory: ScoreHistoryEntry[];
}

export interface PaginationInfo {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface ContactListResponse {
  success: boolean;
  data: Contact[];
  pagination: PaginationInfo;
}

export interface ContactDetailResponse {
  success: boolean;
  data: Contact;
}
