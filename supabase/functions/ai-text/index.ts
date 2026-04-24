import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ success: false, error: "Nicht authentifiziert" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const openaiKey = Deno.env.get("OPENAI_API_KEY");

    if (!openaiKey) {
      return jsonResponse({ success: false, error: "OPENAI_API_KEY nicht konfiguriert" }, 500);
    }

    const token = authHeader.replace("Bearer ", "");
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey);
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser(token);

    if (userError || !user) {
      return jsonResponse({ success: false, error: "Ungültiger Token" }, 401);
    }

    const contentType = req.headers.get("Content-Type") || "";

    // --- Transcription (Whisper) ---
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("audio");
      if (!(file instanceof File)) {
        return jsonResponse({ success: false, error: "Keine Audio-Datei" }, 400);
      }

      const whisperForm = new FormData();
      whisperForm.append("file", file, file.name || "audio.webm");
      whisperForm.append("model", "whisper-1");
      whisperForm.append("language", "de");

      const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${openaiKey}` },
        body: whisperForm,
      });

      if (!whisperRes.ok) {
        const errText = await whisperRes.text();
        return jsonResponse({ success: false, error: `Transkription fehlgeschlagen: ${errText}` }, 500);
      }

      const whisperData = await whisperRes.json();
      return jsonResponse({ success: true, text: whisperData.text || "" });
    }

    // --- Text improvement (Chat) ---
    const body = await req.json();
    const { action, text, context: textContext } = body;

    if (!text || typeof text !== "string") {
      return jsonResponse({ success: false, error: "Kein Text angegeben" }, 400);
    }

    let systemPrompt = "";
    if (action === "improve") {
      systemPrompt = `Du bist ein Assistent, der deutsche Texte für einen handwerklichen Regiebericht oder Projektdokumentation verbessert.
Aufgaben:
- Rechtschreibung und Grammatik korrigieren
- Sätze klar und professionell formulieren
- Fachsprache (Elektrotechnik, Bau, Handwerk) beibehalten wo erkennbar
- Keine zusätzlichen Informationen erfinden
- Knapp und sachlich bleiben
- Nur den verbesserten Text zurückgeben, keine Erklärungen${textContext ? `\nKontext: ${textContext}` : ""}`;
    } else {
      return jsonResponse({ success: false, error: "Unbekannte Aktion" }, 400);
    }

    const chatRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text },
        ],
        temperature: 0.3,
      }),
    });

    if (!chatRes.ok) {
      const errText = await chatRes.text();
      return jsonResponse({ success: false, error: `KI-Fehler: ${errText}` }, 500);
    }

    const chatData = await chatRes.json();
    const improved = chatData.choices?.[0]?.message?.content?.trim() || text;
    return jsonResponse({ success: true, text: improved });
  } catch (error: any) {
    console.error("ai-text error:", error);
    return jsonResponse({ success: false, error: `Unerwarteter Fehler: ${error?.message || String(error)}` }, 500);
  }
});
