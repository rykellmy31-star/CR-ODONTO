import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { Badge, Button, Card, Field, Input, Modal, Select, Spinner, Textarea, useToast } from "../../components/ui";
import { formatMoney } from "../../lib/format";

interface Specialty { id: number; name: string; slug: string; color: string; active: number }
interface Procedure {
  id: number; slug: string; name: string; specialty_id: number | null; specialty_name: string | null;
  specialty_color: string | null; duration_min: number; price_cents: number; requires_room: number;
  description: string; active: number; show_in_booking: number;
}

const emptyProc = {
  name: "", specialty_id: "", duration_min: 30, price: "0", requires_room: true,
  description: "", active: true, show_in_booking: true,
};

export default function ProceduresPage() {
  const toast = useToast();
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [procModal, setProcModal] = useState<{ id?: number } | null>(null);
  const [specModal, setSpecModal] = useState(false);
  const [form, setForm] = useState(emptyProc);
  const [specForm, setSpecForm] = useState({ name: "", color: "#0f766e" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, s] = await Promise.all([
        api.get<{ procedures: Procedure[] }>("/procedures"),
        api.get<{ specialties: Specialty[] }>("/specialties"),
      ]);
      setProcedures(p.procedures);
      setSpecialties(s.specialties);
    } catch (e) {
      toast.push(errorMessage(e), "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  function openNew() {
    setForm(emptyProc);
    setProcModal({});
  }

  function openEdit(p: Procedure) {
    setForm({
      name: p.name,
      specialty_id: p.specialty_id ? String(p.specialty_id) : "",
      duration_min: p.duration_min,
      price: (p.price_cents / 100).toFixed(2),
      requires_room: Boolean(p.requires_room),
      description: p.description,
      active: Boolean(p.active),
      show_in_booking: Boolean(p.show_in_booking),
    });
    setProcModal({ id: p.id });
  }

  async function saveProcedure() {
    setBusy(true);
    const payload = {
      name: form.name,
      specialty_id: form.specialty_id ? Number(form.specialty_id) : null,
      duration_min: Number(form.duration_min),
      price_cents: Math.round(Number(form.price.replace(",", ".")) * 100) || 0,
      requires_room: form.requires_room,
      description: form.description,
      active: form.active,
      show_in_booking: form.show_in_booking,
    };
    try {
      if (procModal?.id) await api.put(`/procedures/${procModal.id}`, payload);
      else await api.post("/procedures", payload);
      toast.push("Procedimento salvo.", "success");
      setProcModal(null);
      await load();
    } catch (e) {
      toast.push(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(p: Procedure) {
    try {
      await api.put(`/procedures/${p.id}`, { active: !p.active });
      await load();
    } catch (e) {
      toast.push(errorMessage(e), "error");
    }
  }

  async function saveSpecialty() {
    setBusy(true);
    try {
      await api.post("/specialties", specForm);
      toast.push("Especialidade criada.", "success");
      setSpecModal(false);
      setSpecForm({ name: "", color: "#0f766e" });
      await load();
    } catch (e) {
      toast.push(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  const visible = procedures.filter((p) => !filter || p.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Filtrar procedimentos" className="max-w-xs" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <Button variant="secondary" onClick={() => setSpecModal(true)}>+ Especialidade</Button>
        <Button className="ml-auto" onClick={openNew}>+ Novo procedimento</Button>
      </div>

      <Card title="Especialidades" subtitle="Organizam procedimentos e agenda">
        <div className="flex flex-wrap gap-1.5">
          {specialties.map((s) => (
            <span key={s.id} className="chip text-white" style={{ background: s.color }}>{s.name}</span>
          ))}
          {specialties.length === 0 && <p className="text-sm text-slate-500">Nenhuma especialidade.</p>}
        </div>
      </Card>

      <Card title="Procedimentos" subtitle={`${visible.length} item(ns) · duração usada pela agenda`}>
        {loading && <Spinner />}
        <div className="space-y-1.5">
          {visible.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800">
                  {p.name}
                  {!p.active && <Badge className="ml-1 bg-slate-200 text-slate-600">inativo</Badge>}
                  {!p.show_in_booking && <Badge className="ml-1 bg-amber-100 text-amber-800">fora do online</Badge>}
                </p>
                <p className="text-xs text-slate-500">
                  {p.specialty_name ?? "sem especialidade"} · {p.duration_min} min · {formatMoney(p.price_cents)}
                  {p.requires_room ? " · exige sala" : ""}
                </p>
              </div>
              <div className="flex gap-1.5">
                <Button size="sm" variant="secondary" onClick={() => openEdit(p)}>Editar</Button>
                <Button size="sm" variant={p.active ? "danger" : "primary"} onClick={() => toggleActive(p)}>
                  {p.active ? "Desativar" : "Ativar"}
                </Button>
              </div>
            </div>
          ))}
          {!loading && visible.length === 0 && <p className="py-4 text-center text-sm text-slate-500">Nenhum procedimento encontrado.</p>}
        </div>
      </Card>

      <Modal
        open={Boolean(procModal)} onClose={() => setProcModal(null)}
        title={procModal?.id ? "Editar procedimento" : "Novo procedimento"} size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setProcModal(null)}>Cancelar</Button>
            <Button loading={busy} onClick={saveProcedure}>Salvar</Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Field label="Nome" required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Especialidade">
              <Select value={form.specialty_id} onChange={(e) => setForm({ ...form, specialty_id: e.target.value })}>
                <option value="">Sem especialidade</option>
                {specialties.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Duração (min)"><Input type="number" min={5} step={5} value={form.duration_min} onChange={(e) => setForm({ ...form, duration_min: Number(e.target.value) })} /></Field>
            <Field label="Valor (R$)"><Input inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></Field>
          </div>
          <Field label="Descrição"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <div className="flex flex-wrap gap-3 text-xs text-slate-700">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={form.requires_room} onChange={(e) => setForm({ ...form, requires_room: e.target.checked })} />Exige sala</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={form.show_in_booking} onChange={(e) => setForm({ ...form, show_in_booking: e.target.checked })} />Disponível no agendamento online</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />Ativo</label>
          </div>
        </div>
      </Modal>

      <Modal
        open={specModal} onClose={() => setSpecModal(false)} title="Nova especialidade"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setSpecModal(false)}>Cancelar</Button>
            <Button loading={busy} onClick={saveSpecialty}>Criar</Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Field label="Nome" required><Input value={specForm.name} onChange={(e) => setSpecForm({ ...specForm, name: e.target.value })} /></Field>
          <Field label="Cor"><Input type="color" value={specForm.color} onChange={(e) => setSpecForm({ ...specForm, color: e.target.value })} /></Field>
        </div>
      </Modal>
    </div>
  );
}
