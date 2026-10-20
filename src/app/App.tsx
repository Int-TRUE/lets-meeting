import { useEffect, useRef, useState } from 'react';
import { Route, Routes, useSearchParams } from 'react-router-dom';
import type { PreviewState, Workspace } from '../domain/models';
import { createPreviewRepository, WorkspaceError } from '../data/workspace';
import { ErrorState, LoadingState } from '../components/ui';
import { HomePage } from '../features/home/HomePage';
import { PreviewTools } from '../features/home/PreviewTools';
import { SearchDialog } from '../features/search/SearchDialog';
import { AppShell } from './AppShell';
import { LinkedPages } from './LinkedPages';
export function App() {
  const [params, setParams] = useSearchParams();
  const searchTriggerRef = useRef<HTMLButtonElement>(null);
  const [previewState, setPreviewState] = useState<PreviewState>('normal');
  const [userId, setUserId] = useState('kim');
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ data?: Workspace; error?: WorkspaceError }>({});
  useEffect(() => {
    const controller = new AbortController();
    createPreviewRepository(previewState, userId)
      .load(controller.signal)
      .then((data) => setResult({ data }))
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
          <Routes>
            <Route path="/" element={<HomePage workspace={result.data} />} />
            <Route path="/topics/:id" element={<LinkedPages data={result.data} />} />
            <Route path="/meetings/:id" element={<LinkedPages data={result.data} />} />
            <Route path="*" element={<LinkedPages data={result.data} />} />
          </Routes>
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
