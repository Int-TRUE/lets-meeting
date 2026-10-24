import { useBlocker } from 'react-router-dom';
import { createContext, useContext, useEffect, useRef } from 'react';
import type { Person, Room, Workspace } from '../domain/models';
export interface WorkspaceContextValue {
  data: Workspace;
  directory: Person[];
  rememberPeople: (people: Person[]) => void;
  rooms: Room[];
  run: <T>(operation: () => Promise<T>) => Promise<T>;
}
export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('Workspace provider missing');
  return context;
}
export function useUnsavedChanges(dirty: boolean) {
  const allowed = useRef(false);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !allowed.current && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (blocker.state === 'blocked') {
      if (window.confirm('저장하지 않은 입력이 있어요. 이 화면을 떠날까요?')) blocker.proceed();
      else blocker.reset();
    }
  }, [blocker]);
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => {
      if (!allowed.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [dirty]);
  return () => {
    allowed.current = true;
  };
}
