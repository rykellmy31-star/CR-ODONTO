import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { Button, Field, Input, useToast } from "../../components/ui";
import type { MembershipClinic, SessionUser } from "../../lib/types";
import { Icon } from "../../components/Icons";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotMsg, setForgotMsg] = useState<string | null>(null);
  const { reload, user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    if (user) {
      if (user.platform_role === "superadmin") navigate("/superadmin/visao-geral", { replace: true });
    }
  }, [user, navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post<{ user: SessionUser }>("/auth/login", { email: email.trim(), password });
      await reload();
      const me = await api.get<{ user: SessionUser | null; clinics: MembershipClinic[] }>("/auth/me");
      if (me.user?.must_change_password) return navigate("/trocar-senha", { replace: true });
      if (me.user?.platform_role === "superadmin") return navigate("/superadmin/visao-geral", { replace: true });
      const first = me.clinics?.[0];
      if (!first) return navigate("/sem-acesso", { replace: true });
      navigate(first.role === "dentist" ? `/c/${first.slug}/pro` : `/c/${first.slug}/admin`, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function requestReset() {
    if (!forgotEmail.trim()) return;
    try {
      const res = await api.post<{ message?: string; dev_code?: string }>("/auth/forgot", { email: forgotEmail.trim() });
      setForgotMsg(
        res.dev_code
          ? `Ambiente de desenvolvimento — código: ${res.dev_code}`
          : res.message ?? "Se o e-mail existir, um código será disponibilizado pelo administrador."
      );
      toast.push("Solicitação registrada.", "success");
    } catch (err) {
      setForgotMsg(errorMessage(err));
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-gradient-to-br from-brand-800 via-brand-700 to-teal-900 p-10 text-white lg:flex">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white/15 text-white"><Icon name="tooth" className="h-6 w-6" strokeWidth={2} /></span>
          <div>
            <p className="text-lg font-black tracking-tight">CR ODONTO</p>
            <p className="text-xs text-brand-100">Gestão de consultórios e clínicas odontológicas</p>
          </div>
        </div>
        <div className="max-w-md space-y-6">
          <h1 className="text-3xl font-bold leading-tight">
            Agenda inteligente, prontuário eletrônico e confirmação automática pelo WhatsApp.
          </h1>
          <ul className="space-y-3 text-sm text-brand-50">
            <li className="flex items-start gap-2"><Icon name="check" className="mt-0.5 h-4 w-4 shrink-0" />Escalas individuais por dentista e por dia da semana</li>
            <li className="flex items-start gap-2"><Icon name="check" className="mt-0.5 h-4 w-4 shrink-0" />Odontograma interativo e planos de tratamento</li>
            <li className="flex items-start gap-2"><Icon name="check" className="mt-0.5 h-4 w-4 shrink-0" />Finalização do atendimento em poucos cliques</li>
            <li className="flex items-start gap-2"><Icon name="check" className="mt-0.5 h-4 w-4 shrink-0" />Lembretes 24h e 5h antes, com confirmação e reagendamento</li>
          </ul>
        </div>
        <p className="text-[11px] text-brand-200">
          Dados de saúde tratados conforme a LGPD. Cada clínica acessa apenas as próprias informações.
        </p>
      </div>

      <div className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex items-center gap-2 lg:hidden">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-700 text-white"><Icon name="tooth" className="h-5 w-5" strokeWidth={2} /></span>
            <p className="text-lg font-black text-slate-900">CR ODONTO</p>
          </div>
          <h2 className="text-2xl font-bold text-slate-900">Entrar no painel</h2>
          <p className="mt-1 text-sm text-slate-500">Use o e-mail cadastrado pela sua clínica.</p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <Field label="E-mail" required>
              <Input
                type="email" autoComplete="email" required value={email}
                onChange={(e) => setEmail(e.target.value)} placeholder="voce@clinica.com.br"
              />
            </Field>
            <Field label="Senha" required>
              <Input
                type="password" autoComplete="current-password" required value={password}
                onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
              />
            </Field>
            {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}
            <Button type="submit" loading={busy} className="w-full">Entrar</Button>
          </form>

          <button onClick={() => setForgotOpen((v) => !v)} className="mt-4 text-xs font-semibold text-brand-700 hover:underline">
            Esqueci minha senha
          </button>
          {forgotOpen && (
            <div className="mt-3 space-y-2 rounded-xl border border-slate-200 bg-white p-3">
              <Input
                type="email" placeholder="seu@email.com" value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
              />
              <Button variant="secondary" size="sm" onClick={requestReset}>Solicitar código</Button>
              {forgotMsg && <p className="text-xs text-slate-600">{forgotMsg}</p>}
            </div>
          )}

          <div className="mt-8 border-t border-slate-200 pt-4 text-xs text-slate-500">
            <p>
              Primeiro acesso da plataforma?{" "}
              <Link to="/setup" className="font-semibold text-brand-700 hover:underline">Configurar superadministrador</Link>
            </p>
            <p className="mt-2">
              É paciente?{" "}
              <Link to="/" className="font-semibold text-brand-700 hover:underline">Acesse o site da sua clínica</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
