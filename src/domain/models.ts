export type Role = 'Owner' | 'Master' | 'Attendee';
export type MeetingStatus = 'scheduled' | 'summary-needed' | 'completed' | 'cancelled';
export interface Person {
  id: string;
  name: string;
  team: string;
  isAdmin?: boolean;
  position?: string;
  isTestAccount?: boolean;
  avatarUrl?: string;
}
export interface Topic {
  id: string;
  title: string;
  description: string;
  icon: 'monitor' | 'chart' | 'people';
  tone: 'blue' | 'mint' | 'peach';
  roles: Record<string, Role>;
}
export interface Meeting {
  id: string;
  topicId: string;
  title: string;
  description: string;
  start: string;
  end: string;
  room: string;
  creatorId: string;
  participantIds: string[];
  files: string[];
  material: 'pending' | 'none' | 'uploaded';
  completed: boolean;
  cancelled: boolean;
  revision?: number;
  hostAtTime?: string;
  updatedAt?: string;
  roomId?: string;
  summary?: Summary;
  attachments?: Attachment[];
}
export interface Workspace {
  user: Person;
  people: Person[];
  topics: Topic[];
  meetings: Meeting[];
  now: string;
}
export type PreviewState =
  'normal' | 'empty-meetings' | 'empty' | 'error' | 'loading' | 'forbidden' | 'expired';

export interface Summary {
  discussion: string;
  decisions: string;
  nextSteps: string;
  savedAt: string;
}
export interface Attachment {
  id: string;
  name: string;
  type: string;
  size: number;
  authorId: string;
  updatedAt: string;
  blob?: Blob;
  downloadable?: boolean;
}
export interface Room {
  id: string;
  name: string;
  location: '명동' | '분당';
  floor: string;
  capacity: number;
  active: boolean;
}
export interface NotificationSettings {
  materials: boolean;
  summary: boolean;
  reminders: string[];
}
export interface DeliveryLog {
  id: string;
  meetingId: string;
  event: 'created' | 'changed' | 'cancelled' | 'materials' | 'summary';
  recipientId: string;
  time: string;
  channel: 'Mattermost';
  result: 'not-connected' | 'pending' | 'sending' | 'sent' | 'failed' | 'unknown';
  batchId?: string;
  relay?: { sequence: number; claimId?: string; expiresAt?: number };
  attemptedAt?: string;
  deliveredAt?: string;
  postId?: string;
  payload?: {
    title: string;
    start: string;
    end: string;
    room: string;
    removed: boolean;
    previous?: { title: string; start: string; end: string; room: string };
  };
  detail: string;
}
export interface PreviewDatabase {
  version: 1;
  people?: Person[];
  rooms?: Room[];
  now?: string;
  topics: Topic[];
  meetings: Meeting[];
  preferences: Record<string, NotificationSettings>;
  logs: DeliveryLog[];
  requests: Record<string, string>;
}
