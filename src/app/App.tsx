import { useEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import type { PreviewState, Workspace } from '../domain/models';
import { createPreviewRepository, people, WorkspaceError } from '../data/workspace';
import { ErrorState, LoadingState } from '../components/ui';
import { HomePage } from '../features/home/HomePage';
import { LoginPage } from '../features/home/LoginPage';
import { PreviewTools } from '../features/home/PreviewTools';
import { SearchDialog } from '../features/search/SearchDialog';
import { AppShell } from './AppShell';
import { NotFoundPage } from './LinkedPages';
import { previewService } from '../data/previewService';
import { WorkspaceContext } from './WorkspaceContext';
import { TopicsPage, TopicDetail, TopicForm } from '../features/topics/TopicsPage';
import { MeetingWizard } from '../features/meetings/MeetingWizard';
import { MeetingDetail, SummaryEditor } from '../features/meetings/MeetingDetail';
import { MeetingsPage } from '../features/meetings/MeetingsPage';
import { NotificationSettingsPage } from '../features/settings/NotificationSettingsPage';
import { AdminNotificationsPage, RoomsPage } from '../features/admin/AdminPages';
export function App() {
  const [params, setParams] = useSearchParams();
  const searchTriggerRef = useRef<HTMLButtonElement>(null);
  const [previewState, setPreviewState] = useState<PreviewState>('normal');
  const [userId, setUserId] = useState(() => {
    try {
      const stored = sessionStorage.getItem('robot-butler:preview-user:v1');
      return people.some((p) => p.id === stored) ? stored! : 'kim';
    } catch {
      return 'kim';
    }
  });
  const [attempt, setAttempt] = useState(0);
  const currentActor = useRef(userId);
  currentActor.current = userId;
  const [result, setResult] = useState<{ data?: Workspace; error?: WorkspaceError }>({});
  useEffect(() => {
    const controller = new AbortController();
    createPreviewRepository(previewState, userId)
      .load(controller.signal)
      .then(async (initial) => {
        const data = previewState === 'normal' ? await previewService.snapshot(userId) : initial;
        if (!controller.signal.aborted) setResult({ data });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setResult({
            error: error instanceof WorkspaceError ? error : new WorkspaceError('error'),
          });
      });
    return () => controller.abort();
  }, [previewState, userId, attempt]);
  function changePreview(state: PreviewState, user: string) {
    setResult({});
    setPreviewState(state);
    setUserId(user);
    try {
      sessionStorage.setItem('robot-butler:preview-user:v1', user);
    } catch {
      /* Session persistence is optional. */
    }
  }
  function retry() {
    setResult({});
    setAttempt((a) => a + 1);
  }
  function closeSearch() {
    const next = new URLSearchParams(params);
    next.delete('search');
    setParams(next, { replace: true });
  }
  async function run<T>(operation: () => Promise<T>): Promise<T> {
    if (previewState !== 'normal') throw new Error('정상 미리보기 상태에서 저장해주세요.');
    const value = await operation();
    const data = await previewService.snapshot(userId);
    if (currentActor.current === userId) setResult({ data });
    return value;
  }
  const error = result.error;
  return (
    <AppShell
      searchTriggerRef={searchTriggerRef}
      user={result.data?.user}
      tools={<PreviewTools state={previewState} userId={userId} onChange={changePreview} />}
    >
      {error ? (
        <ErrorState
          title={
            error.kind === 'forbidden'
              ? '이 공간에 접근할 수 없어요'
              : error.kind === 'expired'
                ? '로그인이 만료되었어요'
                : '홈 정보를 불러오지 못했어요'
          }
          description={
            error.kind === 'forbidden'
              ? '접근 권한을 확인해주세요.'
              : error.kind === 'expired'
                ? '회사 계정으로 다시 로그인해주세요. 현재는 미리보기 상태입니다.'
                : '연결 상태를 확인하고 다시 시도해주세요.'
          }
          onRetry={retry}
        />
      ) : result.data ? (
        <>
          <WorkspaceContext key={userId} value={{ data: result.data, directory: people, run }}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/" element={<HomePage workspace={result.data} />} />
              <Route path="/topics" element={<TopicsPage />} />
              <Route
                path="/topics/new"
                element={
                  <>
                    <TopicsPage />
                    <TopicForm />
                  </>
                }
              />
              <Route path="/topics/:id" element={<TopicDetail />} />
              <Route path="/topics/:id/settings" element={<TopicForm editing />} />
              <Route
                path="/topics/:id/meetings/new"
                element={<MeetingWizard key={`new-${userId}`} />}
              />
              <Route path="/meetings" element={<MeetingsPage />} />
              <Route path="/meetings/:id" element={<MeetingDetail />} />
              <Route
                path="/meetings/:id/edit"
                element={<MeetingWizard editing key={`edit-${userId}`} />}
              />
              <Route path="/meetings/:id/summary" element={<SummaryEditor />} />
              <Route path="/rooms" element={<RoomsPage />} />
              <Route path="/settings/notifications" element={<NotificationSettingsPage />} />
              <Route path="/admin" element={<Navigate to="/admin/notifications" replace />} />
              <Route path="/admin/notifications" element={<AdminNotificationsPage />} />
              <Route path="/admin/rooms" element={<RoomsPage admin />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </WorkspaceContext>
          {params.get('search') === '1' ? (
            <SearchDialog
              returnFocusRef={searchTriggerRef}
              data={result.data}
              onClose={closeSearch}
            />
          ) : null}
        </>
      ) : (
        <LoadingState />
      )}
    </AppShell>
  );
}
