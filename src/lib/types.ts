// Tipos compartilhados com o painel (espelham as respostas da API).
export type StaffRole = "clinic_admin" | "dentist" | "receptionist";

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  platform_role: "user" | "superadmin";
  must_change_password?: boolean;
  clinic?: {
    slug: string;
    name: string;
    role: StaffRole | "public";
    professional_id: number | null;
    unit_id: number | null;
    can_view_records: boolean;
    plan: string;
  } | null;
}

export interface MembershipClinic {
  id: number;
  slug: string;
  name: string;
  status: string;
  role: StaffRole;
  professional_id: number | null;
  professional_name: string | null;
}

export type AppointmentStatus =
  | "agendado" | "aguardando_confirmacao" | "confirmado" | "chegou"
  | "em_atendimento" | "concluido" | "cancelado" | "reagendado" | "nao_compareceu";

export interface Appointment {
  id: number;
  code: string;
  clinic_id: number;
  unit_id: number | null;
  professional_id: number;
  patient_id: number;
  procedure_id: number | null;
  room_id: number | null;
  kind: string;
  starts_at: string;
  ends_at: string;
  local_day: string;
  status: AppointmentStatus;
  source: string;
  is_fit_in: number;
  patient_name: string;
  patient_phone: string;
  patient_code: string;
  professional_name: string;
  procedure_name: string | null;
  procedure_duration: number | null;
  unit_name: string | null;
  room_name: string | null;
  confirmed_at: string | null;
  confirmed_via: string;
  arrived_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  followup_choice: string;
  patient_notes: string;
  internal_notes: string;
  price_cents: number;
}

export interface Professional {
  id: number;
  name: string;
  slug: string;
  cro: string;
  cro_uf: string;
  email: string;
  phone: string;
  photo_url: string;
  color: string;
  default_unit_id: number | null;
  unit_name: string | null;
  slot_min: number;
  show_in_booking: number;
  active: number;
  user_id: number | null;
  specialties: string | null;
}

export interface Procedure {
  id: number;
  slug: string;
  name: string;
  specialty_id: number | null;
  specialty_name: string | null;
  specialty_color: string | null;
  duration_min: number;
  price_cents: number;
  requires_room: number;
  description: string;
  active: number;
  show_in_booking: number;
}

export interface PatientRow {
  id: number;
  code: string;
  name: string;
  phone: string;
  birth_date: string | null;
  last_visit: string | null;
}

export interface OdontogramEntry {
  id: number;
  dentition: string;
  tooth_code: string;
  face: string;
  condition: string;
  status: string;
  notes: string;
  professional_id: number;
  professional_name?: string;
  created_at: string;
}

export interface ClinicalRecord {
  id: number;
  kind: string;
  chief_complaint: string;
  history: string;
  diagnosis: string;
  evolution: string;
  procedure_done: string;
  tooth_codes: string;
  notes: string;
  voided_at: string | null;
  created_at: string;
  professional_name: string;
  professional_cro?: string;
  professional_cro_uf?: string;
  amends_record_id: number | null;
}
