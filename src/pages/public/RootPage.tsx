import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "../../lib/auth";
import { Icon } from "../../components/Icons";

export default function RootPage({ noAccess }: { noAccess?: boolean }) {
  const { user, clinics } = useAuth();
  const [slug, setSlug] = useState("");

  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-700 text-white"><Icon name="tooth" className="h-5 w-5" strokeWidth={2} /></span>
            <span className="text-base font-black tracking-tight text-slate-900">CR ODONTO</span>
          </Link>
          <nav className="flex items-center gap-2 text-sm">
            {user ? (
              <>
                {clinics[0] && (
                  <Link
                    to={clinics[0].role === "dentist" ? `/c/${clinics[0].slug}/pro` : `/c/${clinics[0].slug}/admin`}
                    className="btn-primary px-3 py-2"
                  >
                    Abrir painel
                  </Link>
                )}
                {user.platform_role === "superadmin" && (
                  <Link to="/superadmin/visao-geral" className="btn-secondary px-3 py-2">Superadmin</Link>
                )}
              </>
            ) : (
              <Link to="/login" className="btn-primary px-4 py-2">Entrar</Link>
            )}
          </nav>
        </div>
      </header>

      <main>
        {noAccess && (
          <div className="mx-auto max-w-3xl px-4 pt-6">
            <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Sua conta ainda não está vinculada a uma clínica. Peça ao administrador da clínica para liberar o acesso.
            </div>
          </div>
        )}

        <section className="mx-auto max-w-6xl px-4 py-12 sm:py-20">
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <div>
              <span className="chip bg-brand-50 text-brand-800">Sistema para consultórios e clínicas odontológicas</span>
              <h1 className="mt-4 text-4xl font-black leading-tight tracking-tight text-slate-900 sm:text-5xl">
                Menos faltas, mais cadeira ocupada.
              </h1>
              <p className="mt-4 max-w-lg text-base text-slate-600">
                Agenda inteligente com escalas individuais, prontuário eletrônico, odontograma interativo e confirmação
                de consultas pelo WhatsApp — com 24h e 5h de antecedência.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link to="/login" className="btn-primary px-5 py-3">Acessar o painel</Link>
                <a href="#recursos" className="btn-secondary px-5 py-3">Conhecer recursos</a>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const s = slug.trim().toLowerCase();
                  if (s) location.href = `/c/${s}`;
                }}
                className="mt-8 flex max-w-md gap-2"
              >
                <input
                  className="input"
                  placeholder="endereço da clínica (ex.: clinica-sorriso)"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                />
                <button className="btn-primary shrink-0">Agendar</button>
              </form>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { icon: "calendar" as const, title: "Agenda inteligente", text: "Encaixes com autorização, lista de espera e visão diária/semanal." },
                { icon: "tooth" as const, title: "Odontograma", text: "Dentição permanente e decídua, por dente e por face, com histórico." },
                { icon: "clipboard" as const, title: "Prontuário", text: "Anamnese, evolução, diagnósticos e documentos com rastreabilidade." },
                { icon: "chat" as const, title: "WhatsApp", text: "Lembretes automáticos com botões de confirmar e reagendar." },
                { icon: "clock" as const, title: "Finalização rápida", text: "Conclua o atendimento e agende o retorno em poucos cliques." },
                { icon: "lock" as const, title: "LGPD", text: "Isolamento por clínica, permissões por perfil e auditoria de acessos." },
              ].map((f) => (
                <div key={f.title} className="card p-4">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700"><Icon name={f.icon} className="h-5 w-5" /></span>
                  <p className="mt-2 text-sm font-semibold text-slate-800">{f.title}</p>
                  <p className="mt-1 text-xs text-slate-500">{f.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="recursos" className="border-t border-slate-200 bg-slate-50 py-14">
          <div className="mx-auto max-w-6xl px-4">
            <h2 className="text-2xl font-bold text-slate-900">Feito para a rotina do consultório</h2>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <div className="card p-5">
                <h3 className="text-sm font-bold text-slate-900">Para o dentista</h3>
                <ul className="mt-3 space-y-2 text-xs text-slate-600">
                  <li>• Agenda individual e próximos pacientes</li>
                  <li>• Prontuário, anamnese e odontograma</li>
                  <li>• Planos de tratamento com etapas</li>
                  <li>• Finalização do atendimento e retorno</li>
                </ul>
              </div>
              <div className="card p-5">
                <h3 className="text-sm font-bold text-slate-900">Para a recepção</h3>
                <ul className="mt-3 space-y-2 text-xs text-slate-600">
                  <li>• Agendar, remarcar, cancelar e encaixar</li>
                  <li>• Confirmar presença e registrar chegada</li>
                  <li>• Cadastro rápido sem duplicidade</li>
                  <li>• Lista de espera organizada</li>
                </ul>
              </div>
              <div className="card p-5">
                <h3 className="text-sm font-bold text-slate-900">Para o administrador</h3>
                <ul className="mt-3 space-y-2 text-xs text-slate-600">
                  <li>• Unidades, salas e cadeiras</li>
                  <li>• Escalas individuais por dia</li>
                  <li>• Relatórios operacionais</li>
                  <li>• Personalização visual e WhatsApp</li>
                </ul>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 text-xs text-slate-500 sm:flex-row">
          <p>CR ODONTO — gestão odontológica multiempresa.</p>
          <p>Dados de saúde tratados conforme a LGPD.</p>
        </div>
      </footer>
    </div>
  );
}
