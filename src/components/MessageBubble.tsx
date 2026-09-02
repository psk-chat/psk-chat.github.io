import type { Message } from "../types";
import { formatTime } from "../utils";
import AttachmentImage from "./AttachmentImage";

type Props = {
  message: Message;
  studentToken?: string | null;
};

export default function MessageBubble({ message, studentToken }: Props) {
  const mine = message.sender_role === "student";

  return (
    <div className={`message-row ${mine ? "mine" : "theirs"}`}>
      <div className="message-bubble">
        <div className="message-author">
          {mine ? "Ty" : "Prowadzący"} · {formatTime(message.created_at)}
        </div>

        {message.content && <div>{message.content}</div>}

        {message.attachment_url && (
          <AttachmentImage
            path={message.attachment_url}
            threadId={message.thread_id}
            studentToken={studentToken}
          />
        )}
      </div>
    </div>
  );
}
