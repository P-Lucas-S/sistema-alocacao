import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { NotificationProvider } from './context/NotificationContext';
import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Team from './pages/Team';
import Profile from './pages/Profile';
import Colaboradores from './pages/Colaboradores';
import Projetos from './pages/Projetos';
import ProjetoDetalhe from './pages/ProjetoDetalhe';
import Alocacoes from './pages/Alocacoes';
import GridAlocacao from './pages/GridAlocacao';
import Layout from './components/Layout';

const ProtectedRoute = ({ children, requireAdmin = false }: { children: React.ReactNode; requireAdmin?: boolean }) => {
  const { user, isLoading } = useAuth();
  if (isLoading) return (
    <div className="flex items-center justify-center h-screen" style={{ background: 'var(--surface-2)', color: 'var(--text-1)' }}>
      Carregando...
    </div>
  );
  if (!user) return <Navigate to="/login" replace />;
  if (requireAdmin && user.role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
};

function EmConstrucao() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3" style={{ color: 'var(--text-3)' }}>
      <p className="text-lg font-semibold" style={{ color: 'var(--text-2)' }}>Em construção</p>
      <p className="text-sm">O sistema de alocação está sendo implementado.</p>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Router>
          <NotificationProvider>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/" element={
                <ProtectedRoute>
                  <Layout><EmConstrucao /></Layout>
                </ProtectedRoute>
              } />
              <Route path="/team" element={
                <ProtectedRoute requireAdmin={true}>
                  <Layout><Team /></Layout>
                </ProtectedRoute>
              } />
              <Route path="/colaboradores" element={
                <ProtectedRoute>
                  <Layout><Colaboradores /></Layout>
                </ProtectedRoute>
              } />
              <Route path="/projetos" element={
                <ProtectedRoute>
                  <Layout><Projetos /></Layout>
                </ProtectedRoute>
              } />
              <Route path="/grid" element={
                <ProtectedRoute>
                  <Layout><GridAlocacao /></Layout>
                </ProtectedRoute>
              } />
              <Route path="/alocacoes" element={
                <ProtectedRoute>
                  <Layout><Alocacoes /></Layout>
                </ProtectedRoute>
              } />
              <Route path="/projetos/:id" element={
                <ProtectedRoute>
                  <Layout><ProjetoDetalhe /></Layout>
                </ProtectedRoute>
              } />
              <Route path="/profile" element={
                <ProtectedRoute>
                  <Layout><Profile /></Layout>
                </ProtectedRoute>
              } />
            </Routes>
          </NotificationProvider>
        </Router>
      </AuthProvider>
    </ThemeProvider>
  );
}
