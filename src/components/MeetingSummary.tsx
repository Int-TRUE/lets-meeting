import { useRef, useState } from 'react';
import { Check, ListChecks, FileText } from 'lucide-react';
import type { Meeting } from '../domain/models';
import { canEditSummary, summaryTasks } from '../domain/workflows';
import { useWorkspace } from '../app/WorkspaceContext';
import { previewService } from '../data/previewService';

export function MeetingSummary({ meeting }: { meeting: Meeting }) {
  const { data, run } = useWorkspace();
  const [pending, setPending] = useState<{ id: string; done: boolean }>();
  const saving = useRef(false);
  const [error, setError] = useState('');
  const tasks = summaryTasks(meeting.summary);
  const editable = canEditSummary(meeting, data.user.id, data.now);
  const completed = tasks.filter((task) =>
    pending?.id === task.id ? pending.done : task.done,
  ).length;
  async function toggle(id: string, done: boolean) {
    if (!editable || !meeting.summary || saving.current) return;
    saving.current = true;
    setPending({ id, done });
    setError('');
    try {
      await run(() =>
        previewService.saveSummary(
          data.user.id,
          meeting.id,
          {
            ...meeting.summary!,
            tasks: tasks.map((task) => (task.id === id ? { ...task, done } : task)),
          },
          false,
          meeting.revision ?? 0,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장하지 못했어요. 다시 시도해주세요.');
    } finally {
      saving.current = false;
      setPending(undefined);
    }
  }
  return (
    <div className="meeting-summary-content">
      <section className="summary-notes" aria-label="회의 요약">
        <div className="summary-section-heading">
          <span className="section-icon">
            <FileText size={20} aria-hidden="true" />
          </span>
          <h3>회의 요약</h3>
        </div>
        {meeting.summary ? (
          <div className="summary-note-grid">
            <div>
              <h4>주요 논의 내용</h4>
              <p>{meeting.summary.discussion || '작성된 내용이 없어요.'}</p>
            </div>
            <div>
              <h4>결정 사항</h4>
              <p>{meeting.summary.decisions || '작성된 내용이 없어요.'}</p>
            </div>
          </div>
        ) : (
          <p className="summary-empty">
            {meeting.cancelled
              ? '취소된 회의입니다.'
              : '아직 등록된 요약이 없어요. 회의 후 주요 내용을 남겨주세요.'}
          </p>
        )}
      </section>
      <section className="followup-panel" aria-label="후속 작업">
        <div className="summary-section-heading">
          <span className="section-icon mint">
            <ListChecks size={20} aria-hidden="true" />
          </span>
          <h3>후속 작업</h3>
          <span className="task-count">
            {completed} / {tasks.length} 완료
          </span>
        </div>
        {tasks.length ? (
          <>
            <div
              className="task-progress"
              role="progressbar"
              aria-label="후속 작업 완료율"
              aria-valuemin={0}
              aria-valuemax={tasks.length}
              aria-valuenow={completed}
            >
              <span style={{ width: `${(completed / tasks.length) * 100}%` }} />
            </div>
            <ul className="followup-list">
              {tasks.map((task) => {
                const done = pending?.id === task.id ? pending.done : task.done;
                return (
                  <li key={task.id} className={done ? 'is-done' : ''}>
                    <label>
                      <span className="task-check">
                        <input
                          type="checkbox"
                          checked={done}
                          disabled={!editable || Boolean(pending)}
                          onChange={(e) => void toggle(task.id, e.target.checked)}
                          aria-label={task.text}
                        />
                        <span className="task-check-face">
                          <Check size={15} aria-hidden="true" />
                        </span>
                      </span>
                      <span className="task-text">{task.text}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <p className="task-hint" role="status">
              {pending
                ? '변경 내용을 저장하고 있어요…'
                : editable
                  ? '체크하면 완료 상태가 바로 저장돼요.'
                  : '참가자가 완료 상태를 변경할 수 있어요.'}
            </p>
          </>
        ) : (
          <p className="summary-empty">등록된 후속 작업이 없어요.</p>
        )}
        {error ? (
          <p className="task-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}
