// Shared types between frontend and backend
// These will be expanded as we implement features

export type ContactStatus = 'target' | 'requested' | 'connected' | 'engaged' | 'relationship';

export type Seniority = 'ic' | 'manager' | 'director' | 'vp' | 'c_suite';

export type InteractionType =
  | 'linkedin_message'
  | 'email'
  | 'meeting_1on1_inperson'
  | 'meeting_1on1_virtual'
  | 'meeting_group'
  | 'linkedin_comment_given'
  | 'linkedin_comment_received'
  | 'linkedin_like_given'
  | 'linkedin_like_received'
  | 'introduction_given'
  | 'introduction_received'
  | 'manual_note'
  | 'connection_request_sent'
  | 'connection_request_accepted';

export type InteractionSource = 'manual' | 'linkedin' | 'gmail' | 'calendar';

export type QueueItemStatus = 'pending' | 'approved' | 'executed' | 'skipped' | 'snoozed';

export type QueueActionType = 'connection_request' | 'follow_up' | 're_engagement';

export type QueueItemResult = 'success' | 'failed';

export type StatusTransitionTrigger =
  | 'manual'
  | 'automated_promotion'
  | 'automated_demotion'
  | 'unfriended'
  | 'import_trigger';

export type ScoreType = 'relationship' | 'priority';

export type MergeType = 'auto' | 'manual';

export type ScoringConfigType =
  | 'relationship_weight'
  | 'priority_weight'
  | 'timing_trigger'
  | 'status_threshold'
  | 'general';

// Score bands
export const SCORE_BANDS = {
  cold: { min: 0, max: 20 },
  warm: { min: 21, max: 50 },
  active: { min: 51, max: 75 },
  strong: { min: 76, max: 100 },
} as const;

export type ScoreBand = keyof typeof SCORE_BANDS;

// API Response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

// LinkedIn connection note limit
export const LINKEDIN_NOTE_MAX_LENGTH = 300;
export const LINKEDIN_NOTE_WARNING_LENGTH = 280;
