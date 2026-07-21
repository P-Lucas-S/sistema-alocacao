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
import PlanejamentoWizard from './pages/PlanejamentoWizard';
import GridAlocacao from './pages/GridAlocacao';
import Remanejamento from './pages/Remanejamento';
import Custos from './pages/Custos';
import Programas from './pages/Programas';
import Profissoes from './pages/Profissoes';
import Prioridades from './pages/Prioridades';
import DashboardGeral from './pages/DashboardGeral';
import Layout from './components/Layout';
import { GestorFiltroProvider } from './context/GestorFiltroContext';

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

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Router>
          <GestorFiltroProvider>
          <NotificationProvider>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/" element={
                <ProtectedRoute>
                  <Layout><DashboardGeral /></Layout>
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
              {/* Tela "Alocações" removida do menu (redundante com o Grid — mesmos
                  endpoints, mesma trava de teto/mês-fechado no backend). Rota mantida
                  como redirect pra não quebrar favoritos/links salvos. Alocacoes.tsx
                  continua no disco, só desconectado da navegação ativa. */}
              <Route path="/alocacoes" element={<Navigate to="/grid" replace />} />
              <Route path="/projetos/:id/planejar" element={
                <ProtectedRoute>
                  <Layout><PlanejamentoWizard /></Layout>
                </ProtectedRoute>
              } />
              <Route path="/projetos/:id" element={
                <ProtectedRoute>
                  <Layout><ProjetoDetalhe /></Layout>
                </ProtectedRoute>
              } />
              <Route path="/remanejamento" element={
                <ProtectedRoute>
                  <Layout><Remanejamento /></Layout>
                </ProtectedRoute>
              } />
              <Route path="/custos" element={
                <ProtectedRoute>
                  <Layout><Custos /></Layout>
                </ProtectedRoute>
              } />
              <Route path="/programas" element={
                <ProtectedRoute>
                  <Layout><Programas /></Layout>
                </ProtectedRoute>
              } />
              <Route path="/profissoes" element={
                <ProtectedRoute>
                  <Layout><Profissoes /></Layout>
                </ProtectedRoute>
              } />
              <Route path="/prioridades" element={
                <ProtectedRoute>
                  <Layout><Prioridades /></Layout>
                </ProtectedRoute>
              } />
              <Route path="/profile" element={
                <ProtectedRoute>
                  <Layout><Profile /></Layout>
                </ProtectedRoute>
              } />
            </Routes>
          </NotificationProvider>
          </GestorFiltroProvider>
        </Router>
      </AuthProvider>
    </ThemeProvider>
  );
}
