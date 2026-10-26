import { useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { Button, Card, Field, Input, Modal, Spinner, useAsync, useToast } from "../../components/ui";
import { formatMoney } from "../../lib/format";

interface Plan {
  code: string; name: string; price_cents_month: number; max_units: number; max_dentists: number;
  max_staff: number; max_messages_month: number; whatsapp_enabled: number; clinical_enabled: number;
  active: number; sort: number;
}

export default function SuperPlansPage() {
  const list = useAsync<{ plans: Plan[] }>(() => api.get("/super/plans"), []);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const [form, setForm] = useState({
    code: "", name: "", price_cents_month: 0, max_units: 1, max_dentists: 1, max_staff: 1,
    max_messages_month: 100, whatsapp_enabled: false, clinical_enabled: true, sort: 10,
  });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/super/plans", form);
      toast.push("Plano criado.", "success");
      setOpen(false);
      list.reload();
    } catch (err) {
      toast.push(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(p: Plan) {
    try {
      await api.put(`/super/plans/${p.code}`, { active: !p.active });
      list.reload();
    } catch (err) {
      toast.push(errorMessage(err), "error");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">Planos definem limites de unidades, dentistas e mensagens. Não há cobrança automática.</p>
        <Button onClick={() => setOpen(true)}>+ Novo plano</Button>
      </div>

      {list.loading && <Spinner />}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(list.data?.plans ?? []).map((p) => (
          <Card key={p.code} title={<span className="capitalize">{p.name}</span>} subtitle={`código: ${p.code}`}>
            <p className="text-2xl font-bold text-slate-900">{formatMoney(p.price_cents_month)}<span className="text-xs font-normal text-slate-500">/mês</span></p>
            <ul className="mt-3 space-y-1 text-xs text-slate-600">
              <li>Unidades: {p.max_units < 0 ? "ilimitadas" : p.max_units}</li>
              <li>Dentistas: {p.max_dentists < 0 ? "ilimitados" : p.max_dentists}</li>
              <li>Recepção: {p.max_staff < 0 ? "ilimitado" : p.max_staff}</li>
              <li>Mensagens/mês: {p.max_messages_month < 0 ? "ilimitadas" : p.max_messages_month}</li>
              <li>WhatsApp: {p.whatsapp_enabled ? "incluído" : "não incluído"}</li>
            </ul>
            <div className="mt-3 flex items-center justify-between">
              <span className={`chip ${p.active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>
                {p.active ? "Ativo" : "Inativo"}
              </span>
              <Button variant="secondary" size="sm" onClick={() => toggle(p)}>{p.active ? "Desativar" : "Ativar"}</Button>
            </div>
          </Card>
        ))}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Novo plano">
        <form onSubmit={create} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Código" required hint="minúsculas, sem espaços"><Input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") })} /></Field>
            <Field label="Nome" required><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Preço mensal (centavos)"><Input type="number" min={0} value={form.price_cents_month} onChange={(e) => setForm({ ...form, price_cents_month: Number(e.target.value) })} /></Field>
            <Field label="Máx. unidades" hint="-1 = ilimitado"><Input type="number" min={-1} value={form.max_units} onChange={(e) => setForm({ ...form, max_units: Number(e.target.value) })} /></Field>
            <Field label="Máx. dentistas"><Input type="number" min={-1} value={form.max_dentists} onChange={(e) => setForm({ ...form, max_dentists: Number(e.target.value) })} /></Field>
            <Field label="Máx. recepção"><Input type="number" min={-1} value={form.max_staff} onChange={(e) => setForm({ ...form, max_staff: Number(e.target.value) })} /></Field>
            <Field label="Mensagens/mês"><Input type="number" min={-1} value={form.max_messages_month} onChange={(e) => setForm({ ...form, max_messages_month: Number(e.target.value) })} /></Field>
            <Field label="Ordem"><Input type="number" min={0} value={form.sort} onChange={(e) => setForm({ ...form, sort: Number(e.target.value) })} /></Field>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={form.whatsapp_enabled} onChange={(e) => setForm({ ...form, whatsapp_enabled: e.target.checked })} />
            Inclui integração com WhatsApp
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" loading={busy}>Criar plano</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
