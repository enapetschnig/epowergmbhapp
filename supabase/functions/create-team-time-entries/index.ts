import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface TimeEntryData {
  user_id: string;
  datum: string;
  project_id?: string | null;
  disturbance_id?: string | null;
  taetigkeit: string;
  stunden: number;
  start_time: string;
  end_time: string;
  pause_minutes: number;
  pause_start?: string | null;
  pause_end?: string | null;
  location_type: string;
  notizen?: string | null;
  week_type?: string | null;
}

interface TeamTimeEntriesRequest {
  mainEntry: TimeEntryData;
  teamEntries: TimeEntryData[];
  disturbanceIds?: string[];
  createWorkerLinks?: boolean;
  skipMainEntry?: boolean;
}

const jsonResponse = (body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const createDisturbanceLinks = async (
  supabaseAdmin: ReturnType<typeof createClient>,
  timeEntryId: string,
  disturbanceIds: string[]
) => {
  if (disturbanceIds.length === 0) return;

  const { error } = await supabaseAdmin
    .from("time_entry_disturbances")
    .insert(
      disturbanceIds.map((disturbanceId) => ({
        time_entry_id: timeEntryId,
        disturbance_id: disturbanceId,
      }))
    );

  if (error) {
    throw error;
  }
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ success: false, error: "Kein Auth-Header vorhanden" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser(token);

    if (userError || !user) {
      return jsonResponse({ success: false, error: `Auth fehlgeschlagen: ${userError?.message || "Kein User"}` });
    }

    const userId = user.id;
    const {
      mainEntry,
      teamEntries,
      disturbanceIds = [],
      createWorkerLinks = true,
      skipMainEntry = false,
    }: TeamTimeEntriesRequest = await req.json();

    console.log("Request:", JSON.stringify({ userId, mainEntry: { ...mainEntry, user_id: mainEntry.user_id }, teamEntriesCount: teamEntries.length }));

    if (mainEntry.user_id !== userId) {
      return jsonResponse({ success: false, error: `User-ID stimmt nicht überein (auth: ${userId}, entry: ${mainEntry.user_id})` });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    if (teamEntries.length > 0) {
      const teamUserIds = teamEntries.map((entry) => entry.user_id);
      const { data: profiles, error: profilesError } = await supabaseAdmin
        .from("profiles")
        .select("id, is_active")
        .in("id", teamUserIds);

      if (profilesError) {
        return jsonResponse({ success: false, error: `Team-Validierung fehlgeschlagen: ${profilesError.message}` });
      }

      const activeIds = new Set(profiles?.filter((profile: any) => profile.is_active).map((profile: any) => profile.id) || []);
      const invalidIds = teamUserIds.filter((id) => !activeIds.has(id));

      if (invalidIds.length > 0) {
        return jsonResponse({ success: false, error: `${invalidIds.length} Team-Mitglieder sind inaktiv oder ungültig` });
      }
    }

    let mainEntryResult: { id: string } | null = null;
    let totalCreated = 0;

    if (!skipMainEntry) {
      const insertData = {
        user_id: mainEntry.user_id,
        datum: mainEntry.datum,
        project_id: mainEntry.project_id || null,
        disturbance_id: mainEntry.disturbance_id || null,
        taetigkeit: mainEntry.taetigkeit || "",
        stunden: mainEntry.stunden,
        start_time: mainEntry.start_time,
        end_time: mainEntry.end_time,
        pause_minutes: mainEntry.pause_minutes,
        pause_start: mainEntry.pause_start || null,
        pause_end: mainEntry.pause_end || null,
        location_type: mainEntry.location_type,
        notizen: mainEntry.notizen || null,
        week_type: mainEntry.week_type || null,
      };

      console.log("Inserting main entry:", JSON.stringify(insertData));

      const { data: mainResult, error: mainError } = await supabaseAdmin
        .from("time_entries")
        .insert(insertData)
        .select()
        .single();

      if (mainError) {
        console.error("Main entry error:", JSON.stringify(mainError));
        return jsonResponse({ success: false, error: `DB-Fehler: ${mainError.message} (Code: ${mainError.code}, Details: ${mainError.details})` });
      }

      mainEntryResult = mainResult;
      totalCreated = 1;

      try {
        await createDisturbanceLinks(supabaseAdmin, mainResult.id, disturbanceIds);
      } catch (linkError: any) {
        return jsonResponse({ success: false, error: `Regiebericht-Verknüpfung fehlgeschlagen: ${linkError?.message || linkError}` });
      }
    }

    const teamEntryIds: string[] = [];

    for (const teamEntry of teamEntries) {
      const { data: teamEntryResult, error: teamError } = await supabaseAdmin
        .from("time_entries")
        .insert({
          user_id: teamEntry.user_id,
          datum: teamEntry.datum,
          project_id: teamEntry.project_id || null,
          disturbance_id: teamEntry.disturbance_id || null,
          taetigkeit: teamEntry.taetigkeit || "",
          stunden: teamEntry.stunden,
          start_time: teamEntry.start_time,
          end_time: teamEntry.end_time,
          pause_minutes: teamEntry.pause_minutes,
          pause_start: teamEntry.pause_start || null,
          pause_end: teamEntry.pause_end || null,
          location_type: teamEntry.location_type,
          notizen: teamEntry.notizen || null,
          week_type: teamEntry.week_type || null,
        })
        .select()
        .single();

      if (teamError) {
        console.error("Team entry error:", JSON.stringify(teamError));
        continue;
      }

      try {
        await createDisturbanceLinks(supabaseAdmin, teamEntryResult.id, disturbanceIds);
      } catch (linkError) {
        console.error("Disturbance link error:", linkError);
        continue;
      }

      teamEntryIds.push(teamEntryResult.id);
      totalCreated++;

      if (createWorkerLinks && mainEntryResult) {
        const { error: linkError } = await supabaseAdmin
          .from("time_entry_workers")
          .insert({
            source_entry_id: mainEntryResult.id,
            user_id: teamEntry.user_id,
            target_entry_id: teamEntryResult.id,
          });

        if (linkError) {
          console.error("Worker link error:", linkError);
        }
      }
    }

    console.log(`Created ${totalCreated} time entries`);

    return jsonResponse({
      success: true,
      mainEntryId: mainEntryResult?.id || undefined,
      teamEntryIds,
      totalCreated,
    });
  } catch (error: any) {
    console.error("Unexpected error:", error);
    return jsonResponse({ success: false, error: `Unerwarteter Fehler: ${error?.message || String(error)}` });
  }
});
