import QRCode from "npm:qrcode@1.5.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  const url = new URL(req.url);
  const code = (url.searchParams.get("code") ?? "").trim().toUpperCase();

  if (!/^[A-Z0-9]{5}$/.test(code)) {
    return new Response("Nieprawidłowy kod chatu.", { status: 400, headers: corsHeaders });
  }

  const appUrl = (Deno.env.get("APP_URL") || "https://psk-chat.github.io").replace(/\/$/, "");
  const joinUrl = `${appUrl}/#/join?code=${encodeURIComponent(code)}`;

  const svg = await QRCode.toString(joinUrl, {
    type: "svg",
    width: 720,
    margin: 3,
    errorCorrectionLevel: "M",
  });

  return new Response(svg, {
    headers: {
      ...corsHeaders,
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "Content-Disposition": `inline; filename="chat-${code}.svg"`,
    },
  });
});
