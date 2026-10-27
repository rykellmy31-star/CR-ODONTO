import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { Button, Field, Input, useToast } from "../../components/ui";
import { Icon } from "../../components/Icons";

export default function ChangePasswordPage() {
  const { user, clinics, reload } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const toast = useToast();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) return setError("A confirmação não confere com a nova senha.");
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/password", { current_password: current, new_password: next });
      await reload();
      toast.push("Senha alterada com sucesso.", "success");
      if (user?.platform_role === "superadmin") return navigate("/superadmin/visao-geral", { replace: true });
      const first = clinics[0];
      navigate(first ? (first.role === "dentist" ? `/c/${first.slug}/pro` : `/c/${first.slug}/admin`) : "/sem-acesso", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-4 flex items-center gap-2">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-700 text-white"><Icon name="tooth" className="h-5 w-5" strokeWidth={2} /></span>
          <p className="text-lg font-black text-slate-900">CR ODONTO</p>
        </div>
        <div className="card p-5">
          <h1 className="text-xl font-bold text-slate-900">Troca de senha</h1>
          <p className="mt-1 text-sm text-slate-500">
            {user?.must_change_password
              ? "Sua senha é provisória. Defina uma senha pessoal para continuar."
              : "Atualize sua senha de acesso."}
          </p>
          <form onSubmit={submit} className="mt-5 space-y-4">
            <Field label="Senha atual" required>
              <Input type="password" required value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
            </Field>
            <Field label="Nova senha" hint="Mínimo 8 caracteres, com letras e números." required>
              <Input type="password" required value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
            </Field>
            <Field label="Confirmar nova senha" required>
              <Input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
            </Field>
            {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}
            <Button type="submit" loading={busy} className="w-full">Salvar nova senha</Button>
          </form>
        </div>
      </div>
    </div>
  );
}
