import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { Badge, Button, Card, ConfirmDialog, Field, Input, Modal, Select, Spinner, Tabs, useToast } from "../../components/ui";
import { formatPhone } from "../../lib/format";
import type { Professional } from "../../lib/types";

interface Member {
  id: number;
  user_id: number;
  role: string;
  can_view_records: number;
  active: number;
  professional_id: number | null;
  name: string;
  email: string;
  must_change_password: number;
  last_login_at: string | null;
  professional_name: string | null;
  cro: string | null;
  cro_uf: string | null;
}

const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const ROLE_LABEL: Record<string, string> = {
  clinic_admin: "Administrador", dentist: "Dentista", receptionist: "Recepção",
};

export default function TeamPage() {
  const toast = useToast();
  const [tab, setTab] = useState<"acessos" | "profissionais">("acessos");
  const [members, setMembers] = useState<Member[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [limits, setLimits] = useState<{ staff: { limit: number; used: number } } | null>(null);
  const [loading, setLoading] = useState(true);
  const [memberModal, setMemberModal] = useState(false);
  const [proModal, setProModal] = useState(false);
  const [codeResult, setCodeResult] = useState<{ email: string; code: string } | null>(null);
  const [deactivate, setDeactivate] = useState<Member | null>(null);
  const [scheduleFor, setScheduleFor] = useState<Professional | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, p] = await Promise.all([
        api.get<{ members: Member[]; limits: { staff: { limit: number; used: number } } }>("/members"),
        api.get<{ professionals: Professional[] }>("/professionals"),
      ]);
      setMembers(m.members);
      setLimits(m.limits);
      setProfessionals(p.professionals);
    } catch (e) {
      toast.push(errorMessage(e), "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  async function toggle(member: Member, active: boolean) {
    try {
      await api.put(`/members/${member.id}`, { active });
      toast.push(active ? "Acesso reativado." : "Acesso desativado.", "success");
      await load();
    } catch (e) {
      toast.push(errorMessage(e), "error");
    } finally {
      setDeactivate(null);
    }
  }

  async function changeRole(member: Member, role: string) {
    try {
      await api.put(`/members/${member.id}`, { role });
      toast.push("Perfil atualizado.", "success");
      await load();
    } catch (e) {
      toast.push(errorMessage(e), "error");
    }
  }

  async function toggleRecords(member: Member, can_view_records: boolean) {
    try {
      await api.put(`/members/${member.id}`, { can_view_records });
      toast.push("Permissão de prontuário atualizada.", "success");
      await load();
    } catch (e) {
      toast.push(errorMessage(e), "error");
    }
  }

  async function resetCode(member: Member) {
    try {
      const res = await api.post<{ code: string; email: string }>(`/members/${member.id}/reset-code`);
      setCodeResult({ email: res.email, code: res.code });
    } catch (e) {
      toast.push(errorMessage(e), "error");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs
          tabs={[{ id: "acessos", label: "Acessos ao painel" }, { id: "profissionais", label: "Dentistas e escalas" }]}
          value={tab}
          onChange={(t) => setTab(t as never)}
        />
        <div className="ml-auto flex gap-2">
          {tab === "acessos" ? (
            <Button onClick={() => setMemberModal(true)}>+ Novo acesso</Button>
          ) : (
            <Button onClick={() => setProModal(true)}>+ Novo dentista</Button>
          )}
        </div>
      </div>

      {loading && <Spinner />}

      {tab === "acessos" && !loading && (
        <Card
          title="Usuários com acesso à clínica"
          subtitle={limits ? `Plano permite ${limits.staff.limit < 0 ? "ilimitados" : limits.staff.limit} usuário(s) de apoio · ${limits.staff.used} em uso` : undefined}
        >
          <div className="space-y-2">
            {members.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800">
                    {m.name} {m.active ? null : <Badge className="ml-1 bg-slate-200 text-slate-600">inativo</Badge>}
                  </p>
                  <p className="truncate text-xs text-slate-500">{m.email}</p>
                  <p className="text-[11px] text-slate-400">
                    {m.professional_name ? `${m.professional_name}${m.cro ? ` · CRO ${m.cro}${m.cro_uf ? `/${m.cro_uf}` : ""}` : ""}` : "Sem vínculo com dentista"}
                    {m.last_login_at ? ` · último acesso ${new Date(m.last_login_at).toLocaleDateString("pt-BR")}` : " · nunca acessou"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Select value={m.role} onChange={(e) => changeRole(m, e.target.value)} className="w-auto py-1 text-xs">
                    <option value="clinic_admin">Administrador</option>
                    <option value="dentist">Dentista</option>
                    <option value="receptionist">Recepção</option>
                  </Select>
                  {m.role === "receptionist" && (
                    <label className="flex items-center gap-1 text-[11px] text-slate-600">
                      <input type="checkbox" checked={Boolean(m.can_view_records)} onChange={(e) => toggleRecords(m, e.target.checked)} />
                      prontuário
                    </label>
                  )}
                  <Button size="sm" variant="secondary" onClick={() => resetCode(m)}>Código</Button>
                  {m.active ? (
                    <Button size="sm" variant="danger" onClick={() => setDeactivate(m)}>Desativar</Button>
                  ) : (
                    <Button size="sm" onClick={() => toggle(m, true)}>Reativar</Button>
                  )}
                </div>
              </div>
            ))}
            {members.length === 0 && <p className="text-sm text-slate-500">Nenhum usuário cadastrado.</p>}
          </div>
          <p className="mt-3 text-[11px] text-slate-500">
            Recepção não acessa dados clínicos, salvo liberação explícita acima. Todas as ações ficam registradas na auditoria.
          </p>
        </Card>
      )}

      {tab === "profissionais" && !loading && (
        <div className="space-y-2">
          {professionals.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="h-8 w-1.5 rounded-full" style={{ background: p.color }} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800">
                    {p.name} {p.active ? null : <Badge className="ml-1 bg-slate-200 text-slate-600">inativo</Badge>}
                  </p>
                  <p className="text-xs text-slate-500">
                    {p.cro ? `CRO ${p.cro}${p.cro_uf ? `/${p.cro_uf}` : ""}` : "CRO não informado"}
                    {p.specialties ? ` · ${p.specialties}` : ""}
                    {p.phone ? ` · ${formatPhone(p.phone)}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex gap-1.5">
                <Button size="sm" variant="secondary" onClick={() => setScheduleFor(p)}>Escala</Button>
                <Button size="sm" variant="secondary" onClick={() => setProModal(true)}>Editar dados</Button>
              </div>
            </div>
          ))}
          {professionals.length === 0 && <p className="text-sm text-slate-500">Nenhum dentista cadastrado.</p>}
        </div>
      )}

      {memberModal && (
        <MemberModal
          professionals={professionals}
          onClose={() => setMemberModal(false)}
          onSaved={() => { setMemberModal(false); void load(); }}
        />
      )}
      {proModal && (
        <ProfessionalModal onClose={() => setProModal(false)} onSaved={() => { setProModal(false); void load(); }} />
      )}
      {scheduleFor && (
        <ScheduleModal professional={scheduleFor} onClose={() => setScheduleFor(null)} />
      )}

      {codeResult && (
        <Modal open onClose={() => setCodeResult(null)} title="Código de acesso gerado">
          <p className="text-sm text-slate-600">Entregue este código pessoalmente ao usuário. Ele expira em 60 minutos e derruba as sessões ativas.</p>
          <p className="mt-3 rounded-xl bg-slate-100 px-4 py-3 text-center text-2xl font-bold tracking-[0.3em] text-slate-900">{codeResult.code}</p>
          <p className="mt-1 text-xs text-slate-500">{codeResult.email}</p>
        </Modal>
      )}

      <ConfirmDialog
        open={Boolean(deactivate)}
        title={`Desativar ${deactivate?.name ?? ""}?`}
        description="O usuário perde o acesso imediatamente e as sessões abertas são encerradas. O histórico permanece."
        confirmLabel="Desativar acesso"
        danger
        onConfirm={() => { if (deactivate) void toggle(deactivate, false); }}
        onClose={() => setDeactivate(null)}
      />
    </div>
  );
}

function MemberModal({
  professionals, onClose, onSaved,
}: { professionals: Professional[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "receptionist", can_view_records: false });

  async function save() {
    setBusy(true);
    try {
      await api.post("/members", form);
      toast.push("Acesso criado. O usuário deverá trocar a senha no primeiro login.", "success");
      onSaved();
    } catch (e) {
      toast.push(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open onClose={onClose} title="Novo acesso ao painel"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button loading={busy} onClick={save}>Criar acesso</Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="Nome" required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="E-mail" required><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Senha inicial" required hint="mínimo 10 caracteres — troca obrigatória no primeiro login">
          <Input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        <Field label="Perfil">
          <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="receptionist">Recepção / apoio (sem prontuário por padrão)</option>
            <option value="clinic_admin">Administrador da clínica</option>
          </Select>
        </Field>
        {form.role === "receptionist" && (
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={form.can_view_records} onChange={(e) => setForm({ ...form, can_view_records: e.target.checked })} />
            Permitir acesso ao prontuário clínico
          </label>
        )}
        <p className="text-[11px] text-slate-500">
          Dentistas devem ser cadastrados em “Dentistas e escalas” para vincular CRO, procedimentos e agenda.
          {professionals.length > 0 ? "" : ""}
        </p>
      </div>
    </Modal>
  );
}

function ProfessionalModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [specialties, setSpecialties] = useState<{ id: number; name: string; color: string }[]>([]);
  const [units, setUnits] = useState<{ id: number; name: string }[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [form, setForm] = useState({
    name: "", cro: "", cro_uf: "", email: "", phone: "", color: "#0f766e",
    slot_min: 30, show_in_booking: true, active: true, default_unit_id: "" as string,
    login_password: "",
  });

  useEffect(() => {
    void (async () => {
      try {
        const [s, u] = await Promise.all([
          api.get<{ specialties: { id: number; name: string; color: string }[] }>("/specialties"),
          api.get<{ units: { id: number; name: string }[] }>("/units"),
        ]);
        setSpecialties(s.specialties);
        setUnits(u.units);
      } catch {
        /* silencioso: campos opcionais */
      }
    })();
  }, []);

  async function save() {
    setBusy(true);
    try {
      await api.post("/professionals", {
        ...form,
        cro_uf: form.cro_uf.toUpperCase(),
        default_unit_id: form.default_unit_id ? Number(form.default_unit_id) : null,
        specialty_ids: selected,
        login_password: form.login_password || undefined,
      });
      toast.push("Dentista cadastrado.", "success");
      onSaved();
    } catch (e) {
      toast.push(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open onClose={onClose} title="Novo dentista" size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button loading={busy} onClick={save}>Cadastrar</Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome" required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <div className="grid grid-cols-[1fr_80px] gap-2">
            <Field label="CRO" required><Input value={form.cro} onChange={(e) => setForm({ ...form, cro: e.target.value })} /></Field>
            <Field label="UF" required><Input maxLength={2} value={form.cro_uf} onChange={(e) => setForm({ ...form, cro_uf: e.target.value.toUpperCase() })} /></Field>
          </div>
          <Field label="E-mail"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="WhatsApp"><Input inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <Field label="Duração padrão da consulta (min)">
            <Select value={form.slot_min} onChange={(e) => setForm({ ...form, slot_min: Number(e.target.value) })}>
              {[15, 20, 30, 45, 60].map((v) => <option key={v} value={v}>{v} min</option>)}
            </Select>
          </Field>
          <Field label="Unidade principal">
            <Select value={form.default_unit_id} onChange={(e) => setForm({ ...form, default_unit_id: e.target.value })}>
              <option value="">Todas</option>
              {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </Field>
          <Field label="Cor na agenda"><Input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} /></Field>
          <Field label="Senha de acesso ao painel (opcional)" hint="mínimo 10 caracteres">
            <Input value={form.login_password} onChange={(e) => setForm({ ...form, login_password: e.target.value })} />
          </Field>
        </div>
        <div>
          <p className="label">Especialidades</p>
          <div className="flex flex-wrap gap-1.5">
            {specialties.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelected((prev) => prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id])}
                className={`chip ${selected.includes(s.id) ? "text-white" : "bg-slate-100 text-slate-700"}`}
                style={selected.includes(s.id) ? { background: s.color } : undefined}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-slate-700">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={form.show_in_booking} onChange={(e) => setForm({ ...form, show_in_booking: e.target.checked })} />
            Exibir no agendamento online
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            Ativo
          </label>
        </div>
        <p className="text-[11px] text-slate-500">Uma escala padrão (seg–sex, 08h–18h com almoço) é criada automaticamente e pode ser ajustada em “Escala”.</p>
      </div>
    </Modal>
  );
}

function ScheduleModal({ professional, onClose }: { professional: Professional; onClose: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(
    WEEKDAYS.map((_, weekday) => ({ weekday, active: false, start: "08:00", end: "18:00", break_start: "12:00", break_end: "13:00" }))
  );
  const [exceptions, setExceptions] = useState<{ id: number; date: string; kind: string; start_min: number | null; end_min: number | null; reason: string }[]>([]);
  const [exc, setExc] = useState({ date: "", kind: "dayoff", start: "", end: "", reason: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{
        schedules: { weekday: number; start: string; end: string; break_start: string; break_end: string }[];
        exceptions: typeof exceptions;
      }>(`/professionals/${professional.id}/schedules`);
      setDays((prev) =>
        prev.map((d) => {
          const found = res.schedules.filter((s) => s.weekday === d.weekday)[0];
          return found
            ? { ...d, active: true, start: found.start, end: found.end, break_start: found.break_start, break_end: found.break_end }
            : d;
        })
      );
      setExceptions(res.exceptions);
    } catch (e) {
      toast.push(errorMessage(e), "error");
    } finally {
      setLoading(false);
    }
  }, [professional.id, toast]);

  useEffect(() => { void load(); }, [load]);

  async function saveWeek() {
    setBusy(true);
    try {
      await api.put(`/professionals/${professional.id}/schedules`, {
        days: days.filter((d) => d.active).map((d) => ({
          weekday: d.weekday, active: true, start: d.start, end: d.end,
          break_start: d.break_start, break_end: d.break_end,
        })),
      });
      toast.push("Escala salva.", "success");
    } catch (e) {
      toast.push(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function addException() {
    if (!exc.date) return toast.push("Informe a data.", "error");
    try {
      await api.post("/schedule-exceptions", {
        professional_id: professional.id,
        date: exc.date,
        kind: exc.kind,
        start: exc.start,
        end: exc.end,
        reason: exc.reason,
      });
      toast.push("Exceção registrada.", "success");
      setExc({ date: "", kind: "dayoff", start: "", end: "", reason: "" });
      await load();
    } catch (e) {
      toast.push(errorMessage(e), "error");
    }
  }

  async function removeException(id: number) {
    try {
      await api.del(`/schedule-exceptions/${id}`);
      await load();
    } catch (e) {
      toast.push(errorMessage(e), "error");
    }
  }

  return (
    <Modal open onClose={onClose} title={`Escala · ${professional.name}`} size="lg">
      {loading ? <Spinner /> : (
        <div className="space-y-4">
          <div className="space-y-1.5">
            {days.map((d, i) => (
              <div key={d.weekday} className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1.5">
                <label className="flex w-28 items-center gap-1.5 text-xs font-semibold text-slate-700">
                  <input
                    type="checkbox" checked={d.active}
                    onChange={(e) => setDays(days.map((x, j) => j === i ? { ...x, active: e.target.checked } : x))}
                  />
                  {WEEKDAYS[d.weekday]}
                </label>
                <Input type="time" value={d.start} disabled={!d.active} onChange={(e) => setDays(days.map((x, j) => j === i ? { ...x, start: e.target.value } : x))} className="w-28" />
                <span className="text-xs text-slate-400">até</span>
                <Input type="time" value={d.end} disabled={!d.active} onChange={(e) => setDays(days.map((x, j) => j === i ? { ...x, end: e.target.value } : x))} className="w-28" />
                <span className="text-xs text-slate-400">almoço</span>
                <Input type="time" value={d.break_start} disabled={!d.active} onChange={(e) => setDays(days.map((x, j) => j === i ? { ...x, break_start: e.target.value } : x))} className="w-28" />
                <Input type="time" value={d.break_end} disabled={!d.active} onChange={(e) => setDays(days.map((x, j) => j === i ? { ...x, break_end: e.target.value } : x))} className="w-28" />
              </div>
            ))}
          </div>
          <Button loading={busy} onClick={saveWeek}>Salvar semana</Button>

          <div className="border-t border-slate-200 pt-3">
            <p className="mb-2 text-sm font-semibold text-slate-800">Folgas, férias e horários especiais</p>
            <div className="grid gap-2 sm:grid-cols-4">
              <Input type="date" value={exc.date} onChange={(e) => setExc({ ...exc, date: e.target.value })} />
              <Select value={exc.kind} onChange={(e) => setExc({ ...exc, kind: e.target.value })}>
                <option value="dayoff">Folga</option>
                <option value="vacation">Férias</option>
                <option value="holiday">Feriado</option>
                <option value="absence">Ausência</option>
                <option value="custom_hours">Horário especial</option>
                <option value="block">Bloqueio</option>
              </Select>
              <Input type="time" value={exc.start} onChange={(e) => setExc({ ...exc, start: e.target.value })} />
              <Input type="time" value={exc.end} onChange={(e) => setExc({ ...exc, end: e.target.value })} />
            </div>
            <div className="mt-2 flex gap-2">
              <Input placeholder="Motivo (opcional)" value={exc.reason} onChange={(e) => setExc({ ...exc, reason: e.target.value })} />
              <Button variant="secondary" onClick={addException}>Adicionar</Button>
            </div>
            <ul className="mt-2 space-y-1">
              {exceptions.map((e) => (
                <li key={e.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-2 py-1.5 text-xs">
                  <span>{e.date} · {e.kind}{e.reason ? ` · ${e.reason}` : ""}</span>
                  <button className="font-semibold text-rose-600 hover:underline" onClick={() => removeException(e.id)}>remover</button>
                </li>
              ))}
              {exceptions.length === 0 && <li className="text-xs text-slate-500">Nenhuma exceção futura.</li>}
            </ul>
          </div>
        </div>
      )}
    </Modal>
  );
}
