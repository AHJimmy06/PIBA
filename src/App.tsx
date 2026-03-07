import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { LoginView } from './presentation/views/LoginView';
import { DashboardView } from './presentation/views/DashboardView';
import { SongListView } from './presentation/views/SongListView';
import { RehearsalView } from './presentation/views/RehearsalView';
import { CreateRehearsalView } from './presentation/views/CreateRehearsalView';
import { ProjectionView } from './presentation/views/ProjectionView';
import { EditSongView } from './presentation/views/EditSongView';
import './App.css';

/**
 * Configuración del Enrutador (React Router v7)
 * Define la navegación entre las capas de presentación.
 */
const router = createBrowserRouter([
  {
    path: "/",
    element: <LoginView />,
  },
  {
    path: "/dashboard",
    element: <DashboardView />,
  },
  {
    path: "/songs",
    element: <SongListView />,
  },
  {
    path: "/songs/new",
    element: <EditSongView />,
  },
  {
    path: "/songs/edit/:songId",
    element: <EditSongView />,
  },
  {
    path: "/rehearsal/new",
    element: <CreateRehearsalView />,
  },
  {
    path: "/rehearsal/:rehearsalId",
    element: <RehearsalView />,
  },
  {
    path: "/projection/:rehearsalId",
    element: <ProjectionView />,
  },
  {
    path: "*",
    element: <Navigate to="/" replace />,
  }
]);

function App() {
  return (
    <div className="app-container">
      <RouterProvider router={router} />
    </div>
  )
}

export default App;
