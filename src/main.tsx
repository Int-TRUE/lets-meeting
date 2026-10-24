import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { App } from './app/App';
import './app/tokens.css';
import './app/styles.css';
import './features/home/home.css';
import './app/desktop-reference.css';
import './app/meeting-polish.css';
const router = createBrowserRouter([{ path: '*', element: <App /> }]);
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
