import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Config ──────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const openaiKey = Deno.env.get("OPENAI_API_KEY")!;
const WAPI_TOKEN = Deno.env.get("WAPI_TOKEN")!;
const WAPI_BASE = "https://gate.whapi.cloud";

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// ─── Types ───────────────────────────────────────────────

interface ConversationEntry {
  role: "user" | "assistant" | "system";
  content: string;
}

// ─── WAPI helpers ────────────────────────────────────────

async function sendWhatsApp(to: string, message: string) {
  const recipient = to.includes("@") ? to : `${to}@s.whatsapp.net`;
  const res = await fetch(`${WAPI_BASE}/messages/text`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WAPI_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to: recipient, body: message }),
  });
  const result = await res.json();
  if (!res.ok) console.error("WAPI send error:", result);
  return result;
}

async function downloadMedia(mediaUrl: string): Promise<ArrayBuffer> {
  console.log("Downloading media from:", mediaUrl);

  // If it's a WAPI media ID (not a URL), fetch via WAPI media endpoint
  if (!mediaUrl.startsWith("http")) {
    const apiUrl = `${WAPI_BASE}/media/${mediaUrl}`;
    const res = await fetch(apiUrl, {
      headers: { Authorization: `Bearer ${WAPI_TOKEN}` },
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`WAPI media download failed (${res.status}): ${errText}`);
    }
    return res.arrayBuffer();
  }

  // Direct URL download - try with and without auth
  let res = await fetch(mediaUrl, {
    headers: { Authorization: `Bearer ${WAPI_TOKEN}` },
  });

  if (!res.ok) {
    // Retry without auth (some WAPI URLs are public)
    res = await fetch(mediaUrl);
  }

  if (!res.ok) {
    throw new Error(`Media download failed (${res.status}): ${mediaUrl}`);
  }

  return res.arrayBuffer();
}

// ─── Employee lookup ─────────────────────────────────────

async function findEmployeeByPhone(phone: string) {
  const cleaned = phone
    .replace("@s.whatsapp.net", "")
    .replace(/[\s\-\+\(\)]/g, "")
    .replace(/^0+/, "");
  const last8 = cleaned.slice(-8);

  const { data } = await supabase
    .from("employees")
    .select("id, vorname, nachname, user_id, telefon, whatsapp_aktiv")
    .or(`telefon.ilike.%${last8}%`)
    .limit(1)
    .maybeSingle();

  return data;
}

// ─── Conversation persistence ────────────────────────────

async function loadHistory(phone: string, limit = 12): Promise<ConversationEntry[]> {
  const { data } = await supabase
    .from("whatsapp_messages")
    .select("direction, message_body")
    .eq("phone", phone)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!data) return [];
  return data
    .reverse()
    .filter((m) => m.message_body)
    .map((m) => ({
      role: m.direction === "incoming" ? ("user" as const) : ("assistant" as const),
      content: m.message_body!,
    }));
}

async function saveMsg(
  phone: string,
  direction: "incoming" | "outgoing",
  body: string,
  employeeId?: string,
  userId?: string
) {
  await supabase.from("whatsapp_messages").insert({
    phone,
    direction,
    message_body: body,
    message_type: "text",
    employee_id: employeeId || null,
    user_id: userId || null,
    processed: true,
  });
}

// ─── Rich context for GPT ────────────────────────────────

async function gatherContext(userId: string) {
  const today = new Date().toISOString().split("T")[0];
  const dayNames = [
    "Sonntag", "Montag", "Dienstag", "Mittwoch",
    "Donnerstag", "Freitag", "Samstag",
  ];
  const dayName = dayNames[new Date().getDay()];

  const [projectsRes, todayEntriesRes, assignmentsRes, recentEntriesRes] =
    await Promise.all([
      supabase
        .from("projects")
        .select("id, name")
        .eq("status", "aktiv")
        .order("name"),
      supabase
        .from("time_entries")
        .select("id, stunden, taetigkeit, project_id, projects(name), created_at")
        .eq("user_id", userId)
        .eq("datum", today)
        .order("created_at", { ascending: false }),
      supabase
        .from("worker_assignments")
        .select("project_id, projects(name)")
        .eq("worker_id", userId)
        .eq("date", today),
      supabase
        .from("time_entries")
        .select("datum, stunden, taetigkeit, projects(name)")
        .eq("user_id", userId)
        .order("datum", { ascending: false })
        .limit(7),
    ]);

  const projects = projectsRes.data || [];
  const todayEntries = todayEntriesRes.data || [];
  const assignments = (assignmentsRes.data || []) as any[];
  const recentEntries = (recentEntriesRes.data || []) as any[];

  const todayHours = todayEntries.reduce(
    (sum: number, e: any) => sum + (e.stunden || 0), 0
  );

  let ctx = `DATUM HEUTE: ${today} (${dayName})\n`;
  ctx += `HEUTE BEREITS GEBUCHT: ${todayHours}h\n`;

  if (todayEntries.length > 0) {
    ctx += `\nHEUTIGE BUCHUNGEN:\n`;
    todayEntries.forEach((e: any) => {
      ctx += `  • ${e.stunden}h → ${e.projects?.name || "?"} – ${e.taetigkeit || "k.A."}\n`;
    });
  }

  if (assignments.length > 0) {
    ctx += `\nPLANTAFEL-EINTEILUNG HEUTE:\n`;
    assignments.forEach((a: any) => {
      ctx += `  • ${a.projects?.name || "?"}\n`;
    });
  }

  if (recentEntries.length > 0) {
    ctx += `\nLETZTE BUCHUNGEN (Verlauf):\n`;
    recentEntries.slice(0, 5).forEach((e: any) => {
      ctx += `  • ${e.datum}: ${e.stunden}h → ${e.projects?.name || "?"} (${e.taetigkeit || ""})\n`;
    });
  }

  ctx += `\nAKTIVE PROJEKTE (nummeriert):\n`;
  projects.forEach((p: any, i: number) => {
    ctx += `  ${i + 1}. ${p.name}  [ID: ${p.id}]\n`;
  });

  return { context: ctx, projects, todayHours, todayEntries };
}

// ─── OpenAI Tool definitions ─────────────────────────────

const tools = [
  {
    type: "function" as const,
    function: {
      name: "stunden_buchen",
      description:
        "Bucht Arbeitsstunden fuer einen Mitarbeiter auf ein Projekt. Verwende diese Funktion NACHDEM der Mitarbeiter Projekt, Stunden und Taetigkeit mitgeteilt hat.",
      parameters: {
        type: "object",
        properties: {
          project_id: {
            type: "string",
            description: "UUID des Projekts aus der nummerierten Projektliste",
          },
          stunden: {
            type: "number",
            description: "Stundenanzahl (z.B. 8, 8.5, 4.25)",
          },
          taetigkeit: {
            type: "string",
            description: "Beschreibung der Taetigkeit",
          },
          datum: {
            type: "string",
            description: "Datum YYYY-MM-DD, Standard = heute",
          },
          start_time: {
            type: "string",
            description: "Startzeit HH:MM (optional, Standard 07:00)",
          },
          end_time: {
            type: "string",
            description: "Endzeit HH:MM (optional, wird berechnet)",
          },
        },
        required: ["project_id", "stunden", "taetigkeit", "datum"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "foto_hochladen",
      description:
        "Laedt ein empfangenes Foto auf ein Projekt hoch. Nur aufrufen wenn tatsaechlich ein Foto gesendet wurde.",
      parameters: {
        type: "object",
        properties: {
          project_id: {
            type: "string",
            description: "UUID des Projekts",
          },
          beschreibung: {
            type: "string",
            description: "Kurze Beschreibung des Fotos",
          },
        },
        required: ["project_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "letzte_buchung_loeschen",
      description:
        "Loescht die letzte Stundenbuchung des heutigen Tages. Nur wenn der Mitarbeiter explizit sagt, dass die letzte Buchung falsch war.",
      parameters: {
        type: "object",
        properties: {
          grund: { type: "string", description: "Warum wird geloescht" },
        },
        required: ["grund"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "projekte_anzeigen",
      description:
        "Zeigt die nummerierte Liste aller aktiven Projekte. Verwende wenn der Mitarbeiter fragt welche Projekte es gibt oder eine Auswahl braucht.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
];

// ─── Tool execution ──────────────────────────────────────

async function executeTool(
  name: string,
  input: any,
  userId: string,
  senderName: string,
  mediaUrl?: string
): Promise<string> {
  const today = new Date().toISOString().split("T")[0];

  switch (name) {
    case "stunden_buchen": {
      const h = input.stunden;
      const datum = input.datum || today;

      if (h <= 0 || h > 24)
        return "FEHLER: Stunden muessen zwischen 0.25 und 24 liegen.";

      const startTime = input.start_time || "07:00";
      let endTime = input.end_time;
      if (!endTime) {
        const mins = 7 * 60 + h * 60 + (h > 6 ? 30 : 0);
        endTime = `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(Math.round(mins % 60)).padStart(2, "0")}`;
      }

      const { error } = await supabase.from("time_entries").insert({
        user_id: userId,
        datum,
        stunden: h,
        taetigkeit: input.taetigkeit,
        project_id: input.project_id,
        location_type: "baustelle",
        start_time: startTime,
        end_time: endTime,
        pause_minutes: h > 6 ? 30 : 0,
      });

      if (error) return `FEHLER: ${error.message}`;

      const { data: proj } = await supabase
        .from("projects")
        .select("name")
        .eq("id", input.project_id)
        .maybeSingle();

      return `ERFOLG: ${h}h auf "${proj?.name}" am ${datum} gebucht. Taetigkeit: ${input.taetigkeit}`;
    }

    case "foto_hochladen": {
      if (!mediaUrl) return "FEHLER: Kein Foto vorhanden.";
      try {
        const buf = await downloadMedia(mediaUrl);
        const ts = Date.now();
        const fileName = `${input.project_id}/whatsapp_${ts}.jpg`;

        // Upload to project-photos bucket (public, with INSERT policy)
        const { error: upErr } = await supabase.storage
          .from("project-photos")
          .upload(fileName, buf, { contentType: "image/jpeg", upsert: false });
        if (upErr) throw upErr;

        const { data: urlData } = supabase.storage
          .from("project-photos")
          .getPublicUrl(fileName);

        // Insert into documents table
        const { error: docErr } = await supabase.from("documents").insert({
          name: `WhatsApp Foto – ${senderName} – ${new Date().toLocaleDateString("de-AT")}`,
          file_url: urlData.publicUrl,
          typ: "foto",
          beschreibung: input.beschreibung || `WhatsApp-Upload von ${senderName}`,
          project_id: input.project_id,
          user_id: userId,
        });
        if (docErr) console.error("Doc insert error:", docErr);

        const { data: proj } = await supabase
          .from("projects")
          .select("name")
          .eq("id", input.project_id)
          .maybeSingle();

        return `ERFOLG: Foto auf Projekt "${proj?.name}" hochgeladen.`;
      } catch (e: any) {
        console.error("Photo upload full error:", e);
        return `FEHLER: ${e.message}`;
      }
    }

    case "letzte_buchung_loeschen": {
      const { data: last } = await supabase
        .from("time_entries")
        .select("id, stunden, taetigkeit, projects(name)")
        .eq("user_id", userId)
        .eq("datum", today)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!last) return "FEHLER: Heute keine Buchungen vorhanden.";

      const { error } = await supabase.from("time_entries").delete().eq("id", last.id);
      if (error) return `FEHLER: ${error.message}`;

      return `ERFOLG: Buchung geloescht (${last.stunden}h auf ${(last as any).projects?.name}: ${last.taetigkeit}). Grund: ${input.grund}`;
    }

    case "projekte_anzeigen": {
      const { data: projects } = await supabase
        .from("projects")
        .select("id, name")
        .eq("status", "aktiv")
        .order("name");

      if (!projects?.length) return "Keine aktiven Projekte gefunden.";

      let list = "AKTIVE PROJEKTE:\n";
      projects.forEach((p, i) => {
        list += `${i + 1}. ${p.name}\n`;
      });
      return list;
    }

    default:
      return `FEHLER: Unbekanntes Tool ${name}`;
  }
}

// ─── OpenAI conversation ─────────────────────────────────

async function askGPT(
  systemPrompt: string,
  history: ConversationEntry[],
  userMessage: string,
  userId: string,
  senderName: string,
  mediaUrl?: string
): Promise<string> {
  const messages: any[] = [
    { role: "system", content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage },
  ];

  const callGPT = async (msgs: any[]) => {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: msgs,
        tools,
        max_tokens: 1024,
      }),
    });
    return res.json();
  };

  let result = await callGPT(messages);

  // Tool-use loop (max 3 rounds)
  let rounds = 0;
  while (
    result.choices?.[0]?.finish_reason === "tool_calls" &&
    rounds < 3
  ) {
    rounds++;
    const msg = result.choices[0].message;

    // Add assistant message with tool calls
    messages.push(msg);

    // Execute each tool call
    for (const tc of msg.tool_calls || []) {
      const args = JSON.parse(tc.function.arguments);
      const output = await executeTool(
        tc.function.name,
        args,
        userId,
        senderName,
        mediaUrl
      );
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: output,
      });
    }

    result = await callGPT(messages);
  }

  return (
    result.choices?.[0]?.message?.content ||
    "Entschuldigung, da ist etwas schiefgelaufen."
  );
}

// ─── Build system prompt ─────────────────────────────────

function buildSystemPrompt(senderName: string, ctx: string, todayHours: number): string {
  return `Du bist der *eBauer Assistent* – der smarte WhatsApp-Helfer der eBauer GmbH (Elektrofirma).
Du chattest per WhatsApp mit Mitarbeitern. Sei freundlich, locker und hilfreich – aber immer kurz und knapp (WhatsApp!).
Verwende WhatsApp-Formatierung: *fett*, _kursiv_. Emojis sparsam und passend.

MITARBEITER: ${senderName}
${ctx}

═══ STUNDENBUCHUNG – ABLAUF ═══

1. Mitarbeiter will Stunden buchen → WENN Projekt + Stunden klar: direkt buchen.
2. WENN Projekt unklar oder mehrere moeglich: Zeige nummerierte Liste, frag "Auf welches Projekt? Antworte mit der Nummer."
3. WENN nur "Stunden schreiben" ohne Details: Frag nach Stunden + zeige Projektliste.
4. WENN nur Stunden genannt aber kein Projekt: Schau Plantafel → schlage vor, sonst Projektliste.
5. Wenn Mitarbeiter eine Nummer antwortet (z.B. "3"): nimm Projekt Nr. 3 aus der zuletzt gezeigten Liste.
6. Taetigkeit: Wenn nicht angegeben, frag kurz nach oder nimm sinnvollen Wert aus Kontext.

═══ FOTOS ═══
- Foto mit Beschreibung → ordne dem genannten Projekt zu
- Foto ohne Beschreibung → frag nach Projekt

═══ KORREKTUREN ═══
- "Stimmt nicht", "Loesch das" → letzte_buchung_loeschen, vorher kurz bestaetigen

═══ EINTEILUNG ═══
- "Wo muss ich hin?" → Plantafel-Einteilung aus Kontext zeigen

═══ REGELN ═══
- IMMER Deutsch
- Kurz und knapp!
- Nach Buchung: kurze Bestaetigung mit ✓
- Bereits gebuchte Stunden erwaehnen wenn > 0
- Niemals UUIDs oder technische Details zeigen
- Bei Nummern-Antwort: immer auf letzte Projektliste beziehen
- Du bist Zeiterfassungs-Assistent, kein allgemeiner Chatbot`;
}

// ─── Parse WAPI webhook ──────────────────────────────────

interface ParsedMsg {
  from: string;
  body?: string;
  type: string;
  mediaUrl?: string;
  caption?: string;
}

function parseWapiPayload(payload: any): ParsedMsg[] {
  const msgs: ParsedMsg[] = [];
  const messageList = payload.messages || [];

  for (const m of messageList) {
    const from = (m.from || m.chat_id || "").replace("@s.whatsapp.net", "");
    if (!from || m.from_me) continue;

    const parsed: ParsedMsg = { from, type: m.type || "text" };

    if (m.type === "text" || (!m.type && m.text)) {
      parsed.body = m.text?.body || m.body || m.text;
    } else if (m.type === "image") {
      parsed.mediaUrl = m.image?.link || m.image?.url || m.image?.id;
      parsed.caption = m.image?.caption;
      console.log("Image payload:", JSON.stringify(m.image));
    } else if (m.type === "document") {
      parsed.caption = m.document?.filename || m.document?.caption;
    } else if (m.type === "voice" || m.type === "audio" || m.type === "ptt") {
      parsed.body = "[Sprachnachricht – bitte als Text schreiben]";
    } else if (m.type === "video") {
      parsed.mediaUrl = m.video?.link || m.video?.url;
      parsed.caption = m.video?.caption;
    }

    if (!parsed.body && !parsed.mediaUrl && m.body) {
      parsed.body = m.body;
    }

    msgs.push(parsed);
  }

  return msgs;
}

// ─── Main handler ────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method === "GET") {
    return new Response("OK", { status: 200 });
  }

  try {
    const payload = await req.json();
    const incoming = parseWapiPayload(payload);

    if (incoming.length === 0) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    for (const msg of incoming) {
      const phone = msg.from;
      console.log(`WhatsApp von ${phone}: ${msg.body || msg.caption || `[${msg.type}]`}`);

      const emp = await findEmployeeByPhone(phone);

      // Unknown number → ignore silently (no response)
      if (!emp || !emp.user_id) {
        console.log(`Unbekannte Nummer ${phone} – keine Antwort`);
        continue;
      }

      // Known employee but NOT verified by admin → polite rejection
      if (!emp.whatsapp_aktiv) {
        console.log(`${emp.vorname} ${emp.nachname} nicht freigeschaltet`);
        await sendWhatsApp(
          phone,
          `Hallo ${emp.vorname}! Dein WhatsApp-Zugang wurde noch nicht vom Admin freigeschaltet. Bitte wende dich an deinen Vorgesetzten.`
        );
        continue;
      }

      const name = `${emp.vorname} ${emp.nachname}`.trim();
      const userId = emp.user_id;

      let userMessage = "";
      if (msg.type === "image" || msg.mediaUrl) {
        userMessage = msg.caption
          ? `[Foto gesendet] ${msg.caption}`
          : "[Foto gesendet ohne Beschreibung]";
      } else {
        userMessage = msg.body || "";
      }

      if (!userMessage.trim()) continue;

      await saveMsg(phone, "incoming", userMessage, emp.id, userId);

      const [ctxData, history] = await Promise.all([
        gatherContext(userId),
        loadHistory(phone, 12),
      ]);

      const systemPrompt = buildSystemPrompt(name, ctxData.context, ctxData.todayHours);

      const reply = await askGPT(
        systemPrompt,
        history,
        userMessage,
        userId,
        name,
        msg.mediaUrl
      );

      await saveMsg(phone, "outgoing", reply, emp.id, userId);
      await sendWhatsApp(phone, reply);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Webhook error:", err);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
