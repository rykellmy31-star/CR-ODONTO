import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, errorMessage } from "../../lib/api";
import { Button, Card, Field, Input } from "../../components/ui";
import { Icon } from "../../components/Icons";

export default function SetupPage() {
  const [status, setStatus] = useState<{ bootstrap_completed: boolean; superadmins: number; setup_token_configured: boolean } | null>(null);
  const [form, setForm] = useState({ setup_token: "", name: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api.get<typeof status>("/setup/status").then((s) => setStatus(s)).catch(() => setStatus(null));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/setup/superadmin", form);
      setDone(true);
      setTimeout(() => navigate("/login", { replace: true }), 2500);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      <div className="mb-4 flex items-center gap-2">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-700 text-white"><Icon name="tooth" className="h-5 w-5" strokeWidth={2} /></span>
        <p className="text-lg font-black text-slate-900">CR ODONTO</p>
      </div>
      <Card title="Configuração inicial do superadministrador" subtitle="Etapa única, protegida por token do ambiente.">
        {status && !status.setup_token_configured && (
          <p className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
            O segredo <code className="font-mono">SETUP_TOKEN</code> não está configurado neste ambiente. Defina-o com{" "}
            <code className="font-mono">npx wrangler secret put SETUP_TOKEN</code> antes de continuar.
          </p>
        )}
        {status?.bootstrap_completed && (
          <p className="mb-4 rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-700">
            A configuração inicial já foi concluída. Use a tela de login.
          </p>
        )}
        {done ? (
          <p className="rounded-xl bg-emerald-50 px-3 py-3 text-sm font-medium text-emerald-800">
            Superadministrador criado! Redirecionando para o login... Troque a senha no primeiro acesso.
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <Field label="Token de configuração" hint="Valor de SETUP_TOKEN configurado no Worker." required>
              <Input required value={form.setup_token} onChange={(e) => setForm({ ...form, setup_token: e.target.value })} />
            </Field>
            <Field label="Nome" required>
              <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="E-mail" required>
              <Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Senha" hint="Mínimo 10 caracteres. Será trocada no primeiro acesso." required>
              <Input type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </Field>
            {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}
            <Button type="submit" loading={busy} className="w-full">Criar superadministrador</Button>
          </form>
        )}
      </Card>
    </div>
  );
}
