import { Navigate, Route, Routes, useParams } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "./lib/auth";
import { Spinner } from "./components/ui";

// Público
import RootPage from "./pages/public/RootPage";
import ClinicPublicPage from "./pages/public/ClinicPublicPage";
import ActionPage from "./pages/public/ActionPage";
import PortalPage from "./pages/public/PortalPage";
// Auth
import LoginPage from "./pages/auth/LoginPage";
import ChangePasswordPage from "./pages/auth/ChangePasswordPage";
import SetupPage from "./pages/auth/SetupPage";
// Superadmin
import SuperLayout from "./pages/super/SuperLayout";
import SuperOverviewPage from "./pages/super/SuperOverviewPage";
import SuperClinicsPage from "./pages/super/SuperClinicsPage";
import SuperClinicDetailPage from "./pages/super/SuperClinicDetailPage";
import SuperPlansPage from "./pages/super/SuperPlansPage";
import SuperAuditPage from "./pages/super/SuperAuditPage";
// Admin da clínica
import AdminLayout from "./pages/admin/AdminLayout";
import AdminDashboardPage from "./pages/admin/AdminDashboardPage";
import AgendaPage from "./pages/admin/AgendaPage";
import PatientsPage from "./pages/admin/PatientsPage";
import PatientDetailPage from "./pages/admin/PatientDetailPage";
import TeamPage from "./pages/admin/TeamPage";
import ProceduresPage from "./pages/admin/ProceduresPage";
import WhatsAppPage from "./pages/admin/WhatsAppPage";
import ReportsPage from "./pages/admin/ReportsPage";
import SettingsPage from "./pages/admin/SettingsPage";
// Dentista
import ProPanelPage from "./pages/pro/ProPanelPage";
import { Icon } from "./components/Icons";

/** Links antigos (sem clínica na URL) não são mais aceitos: pede um novo link. */
function LegacyLinkPage() {
  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 p-6">
      <div className="card max-w-md p-6 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand-700"><Icon name="link" className="h-6 w-6" /></span>
        <h1 className="mt-2 text-lg font-bold text-slate-900">Link desatualizado</h1>
        <p className="mt-1 text-sm text-slate-600">
          Este endereço não identifica mais a clínica. Peça um novo link de confirmação pelo WhatsApp ou
          acesse a página da clínica.
        </p>
        <a href="/" className="btn-primary mt-4 inline-flex px-3 py-2 text-xs">Ir para a página inicial</a>
      </div>
    </div>
  );
}

function FullSpinner() {
  return <div className="grid min-h-screen place-items-center"><Spinner label="Carregando CR ODONTO..." /></div>;
}

/** Exige login. Se houver troca de senha pendente, redireciona. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.must_change_password) return <Navigate to="/trocar-senha" replace />;
  return <>{children}</>;
}

function RequireSuper({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.platform_role !== "superadmin") return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Garante que o usuário tem vínculo com a clínica da URL e escolhe o painel. */
function ClinicGate({ children, roles }: { children: ReactNode; roles?: string[] }) {
  const { user, clinics, loading } = useAuth();
  const { slug } = useParams();
  if (loading) return <FullSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  const membership = clinics.find((c) => c.slug === slug);
  if (!membership) return <Navigate to="/sem-acesso" replace />;
  if (roles && !roles.includes(membership.role)) return <Navigate to={`/c/${slug}/${membership.role === "dentist" ? "pro" : "admin"}`} replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RootPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/trocar-senha" element={<ChangePasswordPage />} />
      <Route path="/sem-acesso" element={<RootPage noAccess />} />

      {/* Público da clínica */}
      <Route path="/c/:slug" element={<ClinicPublicPage />} />
      <Route path="/c/:slug/portal" element={<PortalPage />} />
      <Route path="/c/:slug/confirmar/:token" element={<ActionPage purpose="confirmar" />} />
      <Route path="/c/:slug/reagendar/:token" element={<ActionPage purpose="reagendar" />} />
      <Route path="/confirmar/:token" element={<LegacyLinkPage />} />
      <Route path="/reagendar/:token" element={<LegacyLinkPage />} />

      {/* Superadmin */}
      <Route
        path="/superadmin"
        element={
          <RequireSuper>
            <SuperLayout />
          </RequireSuper>
        }
      >
        <Route index element={<Navigate to="visao-geral" replace />} />
        <Route path="visao-geral" element={<SuperOverviewPage />} />
        <Route path="clinicas" element={<SuperClinicsPage />} />
        <Route path="clinicas/:id" element={<SuperClinicDetailPage />} />
        <Route path="planos" element={<SuperPlansPage />} />
        <Route path="auditoria" element={<SuperAuditPage />} />
      </Route>

      {/* Painel da clínica (admin/recepção) */}
      <Route
        path="/c/:slug/admin"
        element={
          <RequireAuth>
            <ClinicGate roles={["clinic_admin", "receptionist"]}>
              <AdminLayout />
            </ClinicGate>
          </RequireAuth>
        }
      >
        <Route index element={<AdminDashboardPage />} />
        <Route path="agenda" element={<AgendaPage />} />
        <Route path="pacientes" element={<PatientsPage />} />
        <Route path="pacientes/:patientId" element={<PatientDetailPage />} />
        <Route path="equipe" element={<TeamPage />} />
        <Route path="procedimentos" element={<ProceduresPage />} />
        <Route path="whatsapp" element={<WhatsAppPage />} />
        <Route path="relatorios" element={<ReportsPage />} />
        <Route path="configuracoes" element={<SettingsPage />} />
      </Route>

      {/* Painel do dentista */}
      <Route
        path="/c/:slug/pro"
        element={
          <RequireAuth>
            <ClinicGate roles={["dentist", "clinic_admin"]}>
              <ProPanelPage />
            </ClinicGate>
          </RequireAuth>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
