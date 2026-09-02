export type Session = {
  id: string;
  code: string;
  subject: string;
  status: "active" | "closed";
  created_at: string;
  expires_at: string | null;
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
