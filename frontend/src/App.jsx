import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import VacationDashboard from './pages/VacationDashboard';

function LegacyManagerRedirect() {
  const { token = '' } = useParams();
  return <Navigate to={`/manager/administracija/${token}`} replace />;
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<VacationDashboard isManager={false} />} />
      <Route path="/manager/:department/:token" element={<VacationDashboard isManager />} />
      <Route path="/manager/:token" element={<LegacyManagerRedirect />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
