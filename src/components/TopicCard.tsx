import { ArrowUpRight, BarChart3, CalendarDays, Monitor, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Topic, Workspace } from '../domain/models';
import { topicMeetings } from '../domain/selectors';
const icons = { monitor: Monitor, chart: BarChart3, people: Users };
const roles = { Owner: '소유자', Master: '관리자', Attendee: '참여자' };
export function TopicIcon({ topic }: { topic: Topic }) {
  const Icon = icons[topic.icon];
  return (
    <span className={`topic-icon tone-${topic.tone}`}>
      <Icon size={24} strokeWidth={1.7} />
    </span>
  );
}
export function TopicCard({ topic, data }: { topic: Topic; data: Workspace }) {
  const role = topic.roles[data.user.id];
  return (
    <Link className="card topic-card" to={`/topics/${topic.id}`}>
      <div className="topic-card-top">
        <TopicIcon topic={topic} />
        <span className={`role-badge ${role === 'Attendee' ? '' : 'role-manager'}`}>
          {roles[role]}
        </span>
      </div>
      <h3>
        {topic.title}
        <ArrowUpRight size={17} />
      </h3>
      <p className="muted">{topic.description}</p>
      <div className="topic-footer">
        <CalendarDays size={15} />
        회의 {topicMeetings(topic, data).length}개
      </div>
    </Link>
  );
}
