import { Outlet } from "react-router-dom";
import { AppShell } from "../../components/layout/AppShell";

export default function SuperLayout() {
  return (
    <AppShell
      title="Superadmin"
      subtitle="Administração da plataforma"
      nav={[
        { to: "/superadmin/visao-geral", label: "Visão geral", icon: "icon:chart" },
        { to: "/superadmin/clinicas", label: "Clínicas", icon: "icon:building" },
        { to: "/superadmin/planos", label: "Planos", icon: "icon:tag" },
        { to: "/superadmin/auditoria", label: "Auditoria", icon: "icon:search" },
      ]}
      headerRight={<a href="/" className="btn-secondary px-3 py-2 text-xs">Site</a>}
    >
      <Outlet />
    </AppShell>
  );
}
