import { useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../../lib/api";
import { Button, Card, Field, Input, Modal, Select, Spinner, useAsync, useToast } from "../../components/ui";
import { formatDateBr } from "../../lib/format";

interface ClinicRow {
  id: number;
  slug: string;
  name: string;
  status: string;
  plan_code: string;
  subscription_status: string | null;
  trial_ends_at: string | null;
  dentists: number;
  patients: number;
  today_appointments: number;
  created_at: string;
}

export default function SuperClinicsPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "", slug: "", legal_name: "", cnpj: "", email: "", phone: "", whatsapp: "",
    plan_code: "trial", trial_days: 14, admin_name: "", admin_email: "", admin_password: "",
    unit_name: "Unidade principal",
  });
  const toast = useToast();
  const list = useAsync<{ clinics: ClinicRow[] }>(() => api.get(`/super/clinics?q=${encodeURIComponent(q)}&status=${status}`), [q, status]);
  const plans = useAsync<{ plans: { code: string; name: string }[] }>(() => api.get("/super/plans"), []);

  async function createClinic(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = { ...form, cnpj: form.cnpj.replace(/\D/g, ""), slug: form.slug || undefined };
      const res = await api.post<{ clinic: { slug: string } }>("/super/clinics", payload);
      toast.push(`Clínica criada: /c/${res.clinic.slug}`, "success");
      setOpen(false);
      setForm({ ...form, name: "", slug: "", cnpj: "", email: "", admin_name: "", admin_email: "", admin_password: "" });
      list.reload();
    } catch (err) {
      toast.push(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Buscar por nome, endereço ou CNPJ" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-[180px]">
          <option value="">Todas as situações</option>
          <option value="active">Ativas</option>
          <option value="suspended">Suspensas</option>
          <option value="blocked">Bloqueadas</option>
        </Select>
        <Button onClick={() => setOpen(true)} className="ml-auto">+ Nova clínica</Button>
      </div>

      {list.loading && <Spinner />}
      {list.error && <Card title="Erro">{list.error}</Card>}

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Clínica</th>
              <th>Situação</th>
              <th>Plano</th>
              <th>Avaliação</th>
              <th className="text-right">Dentistas</th>
              <th className="text-right">Pacientes</th>
              <th className="text-right">Hoje</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(list.data?.clinics ?? []).map((c) => (
              <tr key={c.id}>
                <td>
                  <p className="font-semibold text-slate-800">{c.name}</p>
                  <p className="text-xs text-slate-500">/c/{c.slug}</p>
                </td>
                <td>
                  <span className={`chip ${
                    c.status === "active" ? "bg-emerald-100 text-emerald-800"
                      : c.status === "suspended" ? "bg-amber-100 text-amber-800" : "bg-rose-100 text-rose-700"
                  }`}>
                    {c.status === "active" ? "Ativa" : c.status === "suspended" ? "Suspensa" : "Bloqueada"}
                  </span>
                </td>
                <td className="capitalize">{c.plan_code}</td>
                <td className="text-xs">{c.trial_ends_at ? formatDateBr(c.trial_ends_at.slice(0, 10)) : "—"}</td>
                <td className="text-right tabular-nums">{c.dentists}</td>
                <td className="text-right tabular-nums">{c.patients}</td>
                <td className="text-right tabular-nums">{c.today_appointments}</td>
                <td className="text-right">
                  <Link to={`/superadmin/clinicas/${c.id}`} className="text-xs font-semibold text-brand-700 hover:underline">Gerenciar</Link>
                </td>
              </tr>
            ))}
            {(list.data?.clinics ?? []).length === 0 && !list.loading && (
              <tr><td colSpan={8} className="py-8 text-center text-sm text-slate-500">Nenhuma clínica encontrada.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Nova clínica" size="lg">
        <form onSubmit={createClinic} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome da clínica" required>
              <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Endereço (slug)" hint="Deixe vazio para gerar automaticamente">
              <Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} placeholder="clinica-sorriso" />
            </Field>
            <Field label="Razão social"><Input value={form.legal_name} onChange={(e) => setForm({ ...form, legal_name: e.target.value })} /></Field>
            <Field label="CNPJ"><Input value={form.cnpj} onChange={(e) => setForm({ ...form, cnpj: e.target.value })} /></Field>
            <Field label="Telefone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label="WhatsApp"><Input value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} /></Field>
            <Field label="Plano">
              <Select value={form.plan_code} onChange={(e) => setForm({ ...form, plan_code: e.target.value })}>
                {(plans.data?.plans ?? []).map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
              </Select>
            </Field>
            <Field label="Dias de avaliação gratuita" hint="0 = sem avaliação (assinatura ativa)">
              <Input type="number" min={0} max={365} value={form.trial_days} onChange={(e) => setForm({ ...form, trial_days: Number(e.target.value) })} />
            </Field>
          </div>
          <div className="rounded-xl border border-slate-200 p-3">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Administrador da clínica</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Nome" required><Input required value={form.admin_name} onChange={(e) => setForm({ ...form, admin_name: e.target.value })} /></Field>
              <Field label="E-mail" required><Input required type="email" value={form.admin_email} onChange={(e) => setForm({ ...form, admin_email: e.target.value })} /></Field>
              <Field label="Senha provisória" required hint="Mínimo 10 caracteres">
                <Input required type="password" value={form.admin_password} onChange={(e) => setForm({ ...form, admin_password: e.target.value })} />
              </Field>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" loading={busy}>Criar clínica</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
