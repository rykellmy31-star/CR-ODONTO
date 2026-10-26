import { Link, Outlet, useParams } from "react-router-dom";
import { AppShell } from "../../components/layout/AppShell";
import { useAuth } from "../../lib/auth";

export default function AdminLayout() {
  const { slug = "" } = useParams();
  const { clinics } = useAuth();
  const clinic = clinics.find((c) => c.slug === slug);

  return (
    <AppShell
      title={clinic?.name ?? "Clínica"}
      subtitle={clinic?.role === "receptionist" ? "Recepção" : "Administração"}
      nav={[
        { to: `/c/${slug}/admin`, label: "Início", icon: "icon:home", end: true },
        { to: `/c/${slug}/admin/agenda`, label: "Agenda", icon: "icon:calendar" },
        { to: `/c/${slug}/admin/pacientes`, label: "Pacientes", icon: "icon:patients" },
        { to: `/c/${slug}/admin/equipe`, label: "Equipe e escalas", icon: "icon:team" },
        { to: `/c/${slug}/admin/procedimentos`, label: "Procedimentos", icon: "icon:tooth" },
        { to: `/c/${slug}/admin/whatsapp`, label: "WhatsApp", icon: "icon:chat" },
        { to: `/c/${slug}/admin/relatorios`, label: "Relatórios", icon: "icon:chart" },
        { to: `/c/${slug}/admin/configuracoes`, label: "Configurações", icon: "icon:settings" },
      ]}
      headerRight={
        <div className="flex items-center gap-2">
          <Link to={`/c/${slug}/pro`} className="btn-secondary px-3 py-2 text-xs">Painel do dentista</Link>
          <Link to={`/c/${slug}`} className="btn-ghost px-3 py-2 text-xs">Site</Link>
        </div>
      }
    >
      <Outlet />
    </AppShell>
  );
}
