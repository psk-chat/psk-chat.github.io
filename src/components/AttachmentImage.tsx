import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type Props = {
  path: string;
  threadId: string;
  studentToken?: string | null;
};

export default function AttachmentImage({ path, threadId, studentToken }: Props) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      const { data, error } = await supabase.functions.invoke("chat-attachment", {
        body: {
          action: "sign",
          path,
          threadId,
          studentToken: studentToken ?? null
        }
      });

      if (!error && data?.signedUrl && alive) {
        setUrl(data.signedUrl);
      }
    }

    load();
    return () => { alive = false; };
  }, [path, threadId, studentToken]);

  if (!url) {
    return <div className="attachment-placeholder">Ładowanie załącznika…</div>;
  }

  return (
    <a href={url} target="_blank" rel="noreferrer">
      <img className="attachment" src={url} alt="Załącznik" />
    </a>
  );
}
