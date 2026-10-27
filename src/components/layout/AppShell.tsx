import { useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { useAuth } from "../../lib/auth";
import { Icon, type IconName } from "../Icons";

function renderIcon(icon?: ReactNode) {
  if (typeof icon === "string" && icon.startsWith("icon:")) {
    return <Icon name={icon.slice(5) as IconName} />;
  }
  return icon;
}

export interface NavItem {
  to: string;
  label: string;
  icon?: ReactNode;
  end?: boolean;
}

export function AppShell({
  title, subtitle, nav, children, headerRight,
}: { title: string; subtitle?: string; nav: NavItem[]; children: ReactNode; headerRight?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const doLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Topbar móvel */}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg border border-slate-300 p-2 text-slate-600"
          aria-label="Abrir menu"
        >
          <Icon name="menu" className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-slate-800">{title}</p>
          {subtitle && <p className="truncate text-[11px] text-slate-500">{subtitle}</p>}
        </div>
        {headerRight}
      </header>

      <div className="mx-auto flex w-full max-w-[1400px]">
        {/* Sidebar */}
        <aside
          className={clsx(
            "fixed inset-y-0 left-0 z-40 w-72 transform border-r border-slate-200 bg-white transition-transform lg:sticky lg:top-0 lg:z-0 lg:h-screen lg:translate-x-0",
            open ? "translate-x-0 shadow-2xl" : "-translate-x-full"
          )}
        >
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-4">
              <div className="flex items-center gap-2">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-700 text-white">
                  <Icon name="tooth" className="h-5 w-5" strokeWidth={2} />
                </span>
                <div>
                  <p className="text-sm font-black tracking-tight text-slate-900">CR ODONTO</p>
                  <p className="text-[11px] text-slate-500">{subtitle ?? "Gestão odontológica"}</p>
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="rounded p-1 text-slate-400 lg:hidden" aria-label="Fechar">
                <Icon name="close" className="h-4 w-4" />
              </button>
            </div>

            <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-3">
              {nav.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    clsx(
                      "flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition",
                      isActive || (item.end && location.pathname === item.to)
                        ? "bg-brand-50 text-brand-800"
                        : "text-slate-600 hover:bg-slate-100"
                    )
                  }
                >
                  <span className="grid place-items-center text-brand-700">{renderIcon(item.icon)}</span>
                  {item.label}
                </NavLink>
              ))}
            </nav>

            <div className="border-t border-slate-200 px-3 py-3">
              <p className="truncate px-1 text-xs font-semibold text-slate-700">{user?.name ?? "—"}</p>
              <p className="truncate px-1 text-[11px] text-slate-500">{user?.email ?? ""}</p>
              <div className="mt-2 flex gap-2">
                <Link to="/trocar-senha" onClick={() => setOpen(false)} className="btn-secondary flex-1 px-2 py-1.5 text-xs">
                  Senha
                </Link>
                <button onClick={doLogout} className="btn-ghost flex-1 px-2 py-1.5 text-xs">Sair</button>
              </div>
            </div>
          </div>
        </aside>

        {open && <div className="fixed inset-0 z-30 bg-slate-900/30 lg:hidden" onClick={() => setOpen(false)} />}

        <main className="min-w-0 flex-1 px-3 py-4 sm:px-5 sm:py-6">
          <div className="mb-4 hidden items-center justify-between gap-3 lg:flex">
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900">{title}</h1>
              {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
            </div>
            <div className="flex items-center gap-2">{headerRight}</div>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
