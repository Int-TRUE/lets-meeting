export type Role = 'Owner' | 'Master' | 'Attendee';
export type MeetingStatus = 'scheduled' | 'summary-needed' | 'completed' | 'cancelled';
export interface Person {
  id: string;
  name: string;
  team: string;
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
