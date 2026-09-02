export type Session = {
  id: string;
  code: string;
  subject: string;
  status: "scheduled" | "active" | "closed";
  created_at: string;
  starts_at: string;
  expires_at: string | null;
  auto_close: boolean;
  publish_code: boolean;
  schedule_id: string | null;
};

export type SessionSchedule = {
  id: string;
  subject: string;
  weekday: number;
  start_time: string;
  duration_minutes: number;
  auto_close: boolean;
  publish_code: boolean;
  active: boolean;
  starts_on: string;
  ends_on: string | null;
  timezone: string;
  created_at: string;
};

export type Thread = {
  id: string;
  session_id: string;
  student_name: string;
  student_token: string;
  status: "open" | "resolved";
  unread_for_teacher: boolean;
  unread_for_student: boolean;
  created_at: string;
};

export type Message = {
  id: string;
  thread_id: string;
  sender_role: "student" | "teacher";
  content: string | null;
  attachment_url: string | null;
  created_at: string;
};
