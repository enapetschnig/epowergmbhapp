import { useState, useEffect } from "react";
import { Clock, Plus, AlertTriangle, CheckCircle2, Calendar, Sun, Trash2, Timer } from "lucide-react";
import { MultiEmployeeSelect } from "@/components/MultiEmployeeSelect";
import { FillRemainingHoursDialog } from "@/components/FillRemainingHoursDialog";
import { PageHeader } from "@/components/PageHeader";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { toast as sonnerToast } from "sonner";
import {
  calculateSuggestedStartTime,
  calculateWorkTimeRange,
  getNormalWorkingHours,
  getWeeklyTargetHours,
  getTotalWorkingHours,
  timeToMinutes,
} from "@/lib/workingHours";

type Project = {
  id: string;
  name: string;
  status: string;
  plz: string;
};

type ExistingEntry = {
  id: string;
  start_time: string;
  end_time: string;
  stunden: number;
  taetigkeit: string;
  project_name: string | null;
  plz: string | null;
  location_type?: string | null;
};

interface TimeBlock {
  id: string;
  locationType: "baustelle" | "werkstatt";
  projectId: string;
  
  taetigkeit: string;
  startTime: string;
  endTime: string;
  pauseStart: string;
  pauseEnd: string;
  selectedEmployees: string[];
  directHours: string;
}

const createDefaultBlock = (): TimeBlock => ({
  id: crypto.randomUUID(),
  locationType: "baustelle",
  projectId: "",
  taetigkeit: "",
  startTime: "07:00",
  endTime: "",
  pauseStart: "",
  pauseEnd: "",
  selectedEmployees: [],
  directHours: "",
});

const ABSENCE_TYPES = ["Urlaub", "Krankenstand", "Weiterbildung", "Arztbesuch", "Zeitausgleich"];

const TimeTracking = () => {
  const { toast } = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [submittingAbsence, setSubmittingAbsence] = useState(false);
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectPlz, setNewProjectPlz] = useState("");
  const [newProjectAddress, setNewProjectAddress] = useState("");
  const [pendingBlockIdForNewProject, setPendingBlockIdForNewProject] = useState<string | null>(null);
  const [existingDayEntries, setExistingDayEntries] = useState<ExistingEntry[]>([]);
  const [loadingDayEntries, setLoadingDayEntries] = useState(false);
  const [showAbsenceDialog, setShowAbsenceDialog] = useState(false);
  const [showFillHoursDialog, setShowFillHoursDialog] = useState(false);
  const [absenceData, setAbsenceData] = useState({
    date: new Date().toISOString().split("T")[0],
    type: "urlaub" as "urlaub" | "krankenstand" | "weiterbildung" | "arztbesuch" | "zeitausgleich",
    document: null as File | null,
    customHours: "",
    rangeMode: false,
    dateFrom: new Date().toISOString().split("T")[0],
    dateTo: new Date().toISOString().split("T")[0],
  });
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0]);
  const [timeBlocks, setTimeBlocks] = useState<TimeBlock[]>([createDefaultBlock()]);

  const parseDirectHours = (value: string): number => {
    const normalized = value.replace(",", ".").trim();
    if (!normalized) return 0;

    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const getLastExistingEndTime = (entries: ExistingEntry[] = existingDayEntries): string | null => {
    if (!entries.length) return null;
    return entries[entries.length - 1].end_time;
  };

  const recalculateTimeBlocks = (blocks: TimeBlock[], lastExistingEndTime = getLastExistingEndTime()): TimeBlock[] => {
    const currentDate = new Date(selectedDate);
    let previousEndTime = lastExistingEndTime;

    return blocks.map((block) => {
      const suggestedStartTime = calculateSuggestedStartTime(currentDate, previousEndTime, 0);
      const hours = parseDirectHours(block.directHours);

      if (hours <= 0) {
        return {
          ...block,
          startTime: suggestedStartTime,
          endTime: "",
          pauseStart: "",
          pauseEnd: "",
        };
      }

      const calculatedTimes = calculateWorkTimeRange(currentDate, hours, suggestedStartTime);
      previousEndTime = calculatedTimes.endTime || previousEndTime;

      return {
        ...block,
        startTime: calculatedTimes.startTime,
        endTime: calculatedTimes.endTime,
        pauseStart: calculatedTimes.pauseStart,
        pauseEnd: calculatedTimes.pauseEnd,
      };
    });
  };

  const updateBlocks = (updater: (blocks: TimeBlock[]) => TimeBlock[], lastExistingEndTime?: string | null) => {
    setTimeBlocks((prev) => recalculateTimeBlocks(updater(prev), lastExistingEndTime));
  };

  const getAbsenceLabel = (type: string) => {
    const map: Record<string, string> = {
      urlaub: "Urlaub",
      krankenstand: "Krankenstand",
      weiterbildung: "Weiterbildung",
      arztbesuch: "Arztbesuch",
      zeitausgleich: "Zeitausgleich",
    };
    return map[type] || type;
  };

  const getEntryLabel = (entry: ExistingEntry) => {
    if (entry.location_type === "regie") return "Regie";
    return entry.project_name || entry.taetigkeit;
  };

  const fetchProjects = async () => {
    const { data } = await supabase
      .from("projects")
      .select("id, name, status, plz")
      .eq("status", "aktiv")
      .order("name");

    if (data) setProjects(data);
    setLoading(false);
  };


  const fetchExistingDayEntries = async (date: string) => {
    setLoadingDayEntries(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoadingDayEntries(false);
      return;
    }

    const { data, error } = await supabase
      .from("time_entries")
      .select(`
        id,
        start_time,
        end_time,
        stunden,
        taetigkeit,
        location_type,
        projects (name, plz)
      `)
      .eq("user_id", user.id)
      .eq("datum", date)
      .order("start_time");

    if (!error && data) {
      const entries: ExistingEntry[] = data.map((entry: any) => ({
        id: entry.id,
        start_time: entry.start_time,
        end_time: entry.end_time,
        stunden: entry.stunden,
        taetigkeit: entry.taetigkeit,
        location_type: entry.location_type,
        project_name: entry.projects?.name || null,
        plz: entry.projects?.plz || null,
      }));
      setExistingDayEntries(entries);
      setTimeBlocks(recalculateTimeBlocks([createDefaultBlock()], getLastExistingEndTime(entries)));
    } else {
      setExistingDayEntries([]);
      setTimeBlocks(recalculateTimeBlocks([createDefaultBlock()], null));
    }

    setLoadingDayEntries(false);
  };

  useEffect(() => {
    fetchExistingDayEntries(selectedDate);
  }, [selectedDate]);

  useEffect(() => {
    fetchProjects();

    const channel = supabase
      .channel("time-tracking-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, fetchProjects)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const updateBlock = (blockId: string, updates: Partial<TimeBlock>) => {
    updateBlocks((prev) => prev.map((block) => (
      block.id === blockId ? { ...block, ...updates } : block
    )));
  };

  const updateBlockEmployees = (blockId: string, employees: string[]) => {
    setTimeBlocks((prev) => prev.map((block) => (
      block.id === blockId ? { ...block, selectedEmployees: employees } : block
    )));
  };

  const addTimeBlock = () => {
    updateBlocks((prev) => [...prev, createDefaultBlock()]);
  };

  const removeBlock = (blockId: string) => {
    updateBlocks((prev) => prev.filter((block) => block.id !== blockId));
  };

  const calculateBlockPauseMinutes = (block: TimeBlock): number => {
    if (!block.pauseStart || !block.pauseEnd) return 0;
    return Math.max(0, timeToMinutes(block.pauseEnd) - timeToMinutes(block.pauseStart));
  };

  const calculateBlockHours = (block: TimeBlock): number => {
    return parseDirectHours(block.directHours);
  };

  const calculateTotalHours = (): string => {
    return timeBlocks.reduce((sum, block) => sum + calculateBlockHours(block), 0).toFixed(2);
  };

  const allBlocksValid = timeBlocks.every((block) => {
    const hours = calculateBlockHours(block);
    return hours > 0 && block.startTime && block.endTime;
  });

  const applyFullDayPreset = () => {
    if (!timeBlocks.length) return;

    const totalHours = getTotalWorkingHours(new Date(selectedDate));
    if (totalHours <= 0) {
      toast({ variant: "destructive", title: "Arbeitsfrei", description: "Am Wochenende wird nicht gearbeitet" });
      return;
    }

    updateBlocks((prev) => prev.map((block, index) => (
      index === 0 ? { ...block, directHours: totalHours.toFixed(2) } : block
    )));
  };

  const calculateAbsenceTimes = (date: Date, hours: number) => {
    const calculated = calculateWorkTimeRange(date, hours, "07:00");
    return {
      start_time: calculated.startTime,
      end_time: calculated.endTime,
      pause_minutes: calculated.pauseMinutes,
      pause_start: calculated.pauseStart || null,
      pause_end: calculated.pauseEnd || null,
    };
  };

  const getWorkdaysInRange = (from: string, to: string): string[] => {
    const days: string[] = [];
    const start = new Date(from);
    const end = new Date(to);
    const current = new Date(start);

    while (current <= end) {
      const dow = current.getDay();
      if (dow >= 1 && dow <= 5) {
        days.push(current.toISOString().split("T")[0]);
      }
      current.setDate(current.getDate() + 1);
    }

    return days;
  };

  const handleCreateNewProject = async () => {
    if (creatingProject) return;
    if (!newProjectName.trim() || !newProjectPlz.trim()) {
      sonnerToast.error("Name und PLZ sind Pflichtfelder");
      return;
    }
    if (!/^\d{4,5}$/.test(newProjectPlz)) {
      sonnerToast.error("PLZ muss 4-5 Ziffern haben");
      return;
    }

    setCreatingProject(true);

    const { data, error } = await supabase
      .from("projects")
      .insert({
        name: newProjectName.trim(),
        plz: newProjectPlz.trim(),
        adresse: newProjectAddress.trim() || null,
        status: "aktiv",
      })
      .select()
      .single();

    if (error) {
      sonnerToast.error(error.code === "23505" ? "Ein Projekt mit diesem Namen und PLZ existiert bereits" : "Projekt konnte nicht erstellt werden");
      setCreatingProject(false);
      return;
    }

    sonnerToast.success("Projekt erfolgreich erstellt");

    if (pendingBlockIdForNewProject) {
      updateBlock(pendingBlockIdForNewProject, { projectId: data.id });
    }

    setShowNewProjectDialog(false);
    setNewProjectName("");
    setNewProjectPlz("");
    setNewProjectAddress("");
    setPendingBlockIdForNewProject(null);
    setCreatingProject(false);
  };

  const handleAbsenceSubmit = async () => {
    if (submittingAbsence) return;
    setSubmittingAbsence(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast({ variant: "destructive", title: "Fehler", description: "Sie müssen angemeldet sein" });
      setSubmittingAbsence(false);
      return;
    }

    if (absenceData.rangeMode) {
      const workdays = getWorkdaysInRange(absenceData.dateFrom, absenceData.dateTo);
      if (workdays.length === 0) {
        toast({ variant: "destructive", title: "Fehler", description: "Keine Werktage im gewählten Zeitraum." });
        setSubmittingAbsence(false);
        return;
      }

      const { data: allExisting } = await supabase
        .from("time_entries")
        .select("datum, stunden, taetigkeit")
        .eq("user_id", user.id)
        .gte("datum", absenceData.dateFrom)
        .lte("datum", absenceData.dateTo);

      const existingByDate = new Map<string, { hours: number; absenceHours: number }>();
      (allExisting || []).forEach((entry) => {
        const prev = existingByDate.get(entry.datum) || { hours: 0, absenceHours: 0 };
        prev.hours += Number(entry.stunden);
        if (ABSENCE_TYPES.includes(entry.taetigkeit || "")) prev.absenceHours += Number(entry.stunden);
        existingByDate.set(entry.datum, prev);
      });

      const inserts: any[] = [];
      const skipped: string[] = [];

      for (const day of workdays) {
        const dateObj = new Date(day);
        const dailyTarget = getTotalWorkingHours(dateObj);
        const hours = getNormalWorkingHours(dateObj);
        const existing = existingByDate.get(day);

        if (existing && (existing.hours + hours > dailyTarget + 0.01 || existing.absenceHours >= dailyTarget)) {
          skipped.push(day);
          continue;
        }

        const absenceTimes = calculateAbsenceTimes(dateObj, hours);
        inserts.push({
          user_id: user.id,
          datum: day,
          project_id: null,
          taetigkeit: getAbsenceLabel(absenceData.type),
          stunden: hours,
          start_time: absenceTimes.start_time,
          end_time: absenceTimes.end_time,
          pause_minutes: absenceTimes.pause_minutes,
          pause_start: absenceTimes.pause_start,
          pause_end: absenceTimes.pause_end,
          location_type: "baustelle",
          notizen: null,
          week_type: null,
        });
      }

      if (inserts.length === 0) {
        toast({ variant: "destructive", title: "Keine Buchung möglich", description: "Alle Tage im Zeitraum sind bereits belegt." });
        setSubmittingAbsence(false);
        return;
      }

      const { error } = await supabase.from("time_entries").insert(inserts);
      if (error) {
        toast({ variant: "destructive", title: "Fehler", description: "Konnte nicht gespeichert werden" });
      } else {
        toast({ title: "Erfolg", description: skipped.length ? `${inserts.length} Tage gebucht, ${skipped.length} übersprungen.` : `${inserts.length} Tage ${getAbsenceLabel(absenceData.type)} gebucht.` });
        setShowAbsenceDialog(false);
        fetchExistingDayEntries(selectedDate);
      }

      setSubmittingAbsence(false);
      return;
    }

    const selectedDateObj = new Date(absenceData.date);
    const workingHours = absenceData.customHours ? parseFloat(absenceData.customHours) : getNormalWorkingHours(selectedDateObj);
    const { data: existingEntries } = await supabase
      .from("time_entries")
      .select("id, stunden, taetigkeit")
      .eq("user_id", user.id)
      .eq("datum", absenceData.date);

    const existingHours = (existingEntries || []).reduce((sum, entry) => sum + Number(entry.stunden), 0);
    const dailyTarget = getTotalWorkingHours(selectedDateObj);
    if (existingHours + workingHours > dailyTarget + 0.01) {
      toast({ variant: "destructive", title: "Stunden überschritten", description: `Bereits ${existingHours.toFixed(1)}h gebucht.` });
      setSubmittingAbsence(false);
      return;
    }

    const absenceTimes = calculateAbsenceTimes(selectedDateObj, workingHours);
    const { error } = await supabase.from("time_entries").insert({
      user_id: user.id,
      datum: absenceData.date,
      project_id: null,
      taetigkeit: getAbsenceLabel(absenceData.type),
      stunden: workingHours,
      start_time: absenceTimes.start_time,
      end_time: absenceTimes.end_time,
      pause_minutes: absenceTimes.pause_minutes,
      pause_start: absenceTimes.pause_start,
      pause_end: absenceTimes.pause_end,
      location_type: "baustelle",
      notizen: null,
      week_type: null,
    });

    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: "Konnte nicht gespeichert werden" });
    } else {
      toast({ title: "Erfolg", description: `${getAbsenceLabel(absenceData.type)} (${workingHours}h) erfasst` });
      setShowAbsenceDialog(false);
      fetchExistingDayEntries(selectedDate);
    }

    setSubmittingAbsence(false);
  };


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast({ variant: "destructive", title: "Fehler", description: "Sie müssen angemeldet sein" });
      setSaving(false);
      return;
    }

    for (let i = 0; i < timeBlocks.length; i++) {
      const block = timeBlocks[i];
      const blockNum = i + 1;
      const blockHours = calculateBlockHours(block);

      if (blockHours <= 0) {
        toast({ variant: "destructive", title: "Fehler", description: `Block ${blockNum}: Bitte gültige Stunden eingeben` });
        setSaving(false);
        return;
      }

      if (!block.startTime || !block.endTime) {
        toast({ variant: "destructive", title: "Fehler", description: `Block ${blockNum}: Zeiten konnten nicht berechnet werden` });
        setSaving(false);
        return;
      }

      if (timeToMinutes(block.endTime) <= timeToMinutes(block.startTime)) {
        toast({ variant: "destructive", title: "Fehler", description: `Block ${blockNum}: Endzeit muss nach Startzeit liegen` });
        setSaving(false);
        return;
      }
    }

    const { data: existingEntries } = await supabase
      .from("time_entries")
      .select("id, start_time, end_time, taetigkeit, stunden")
      .eq("user_id", user.id)
      .eq("datum", selectedDate);

    if (existingEntries && existingEntries.length > 0) {
      const absenceEntries = existingEntries.filter((entry) => ABSENCE_TYPES.includes(entry.taetigkeit));
      const absenceHours = absenceEntries.reduce((sum, entry) => sum + Number(entry.stunden), 0);
      const dailyTarget = getTotalWorkingHours(new Date(selectedDate));

      if (absenceHours >= dailyTarget) {
        toast({ variant: "destructive", title: "Tag blockiert", description: `Für diesen Tag sind bereits ${absenceHours.toFixed(1)}h Abwesenheit eingetragen.` });
        setSaving(false);
        return;
      }

      const existingHoursTotal = existingEntries.reduce((sum, entry) => sum + Number(entry.stunden), 0);
      const newHoursTotal = timeBlocks.reduce((sum, block) => sum + calculateBlockHours(block), 0);
      if (existingHoursTotal + newHoursTotal > dailyTarget + 4) {
        toast({ variant: "destructive", title: "Zu viele Stunden", description: `Tagessumme würde ${(existingHoursTotal + newHoursTotal).toFixed(1)}h betragen.` });
        setSaving(false);
        return;
      }

      for (const entry of existingEntries) {
        if (ABSENCE_TYPES.includes(entry.taetigkeit)) continue;
        const existingStart = timeToMinutes(entry.start_time);
        const existingEnd = timeToMinutes(entry.end_time);

        for (let i = 0; i < timeBlocks.length; i++) {
          const block = timeBlocks[i];
          const blockStart = timeToMinutes(block.startTime);
          const blockEnd = timeToMinutes(block.endTime);
          if (blockStart < existingEnd && blockEnd > existingStart) {
            toast({ variant: "destructive", title: "Zeitüberschneidung", description: `Block ${i + 1} überschneidet mit bestehendem Eintrag.` });
            setSaving(false);
            return;
          }
        }
      }
    }

    let totalEntriesCreated = 0;
    let hasError = false;

    for (const block of timeBlocks) {
      const blockHours = calculateBlockHours(block);
      const pauseMinutes = calculateBlockPauseMinutes(block);

      const mainEntry = {
        user_id: user.id,
        datum: selectedDate,
        project_id: block.locationType === "baustelle" ? (block.projectId || null) : null,
        disturbance_id: null,
        taetigkeit: block.taetigkeit || "",
        stunden: blockHours,
        start_time: block.startTime,
        end_time: block.endTime,
        pause_minutes: pauseMinutes,
        pause_start: block.pauseStart || null,
        pause_end: block.pauseEnd || null,
        location_type: block.locationType,
        notizen: null,
        week_type: null,
      };

      const teamEntries = block.selectedEmployees.map((workerId) => ({
            user_id: workerId,
            datum: selectedDate,
            project_id: block.locationType === "baustelle" ? (block.projectId || null) : null,
            disturbance_id: null,
            taetigkeit: block.taetigkeit || "",
            stunden: blockHours,
            start_time: block.startTime,
            end_time: block.endTime,
            pause_minutes: pauseMinutes,
            pause_start: block.pauseStart || null,
            pause_end: block.pauseEnd || null,
            location_type: block.locationType,
            notizen: null,
            week_type: null,
          }));

      let result: any = null;
      let functionError: any = null;

      try {
        const response = await supabase.functions.invoke("create-team-time-entries", {
          body: {
            mainEntry,
            teamEntries,
            disturbanceIds: [],
            createWorkerLinks: true,
          },
        });
        result = response.data;
        functionError = response.error;

        // Bei FunctionsHttpError den Body auslesen
        if (functionError && functionError.context instanceof Response) {
          try {
            const errorBody = await functionError.context.json();
            functionError = { ...functionError, detail: errorBody };
          } catch {}
        }
      } catch (invokeError: any) {
        functionError = invokeError;
      }

      if (functionError || !result?.success) {
        hasError = true;
        const errorDetail = functionError?.detail?.error || functionError?.message || result?.error || "Unbekannter Fehler";
        console.error("Error creating time entries:", { functionError, result, mainEntry, teamEntries });
        toast({ variant: "destructive", title: "Fehler beim Speichern", description: String(errorDetail) });
        continue;
      }

      totalEntriesCreated += result.totalCreated || 1;
    }

    if (!hasError) {
      const teamInfo = timeBlocks.some((block) => block.selectedEmployees.length > 0)
        ? " (inkl. Team-Mitglieder)"
        : "";
      toast({ title: "Erfolg", description: `${totalEntriesCreated} Eintrag/Einträge gespeichert${teamInfo}` });
      await fetchExistingDayEntries(selectedDate);
    }

    setSaving(false);
  };

  const absenceEntries = existingDayEntries.filter((entry) => ABSENCE_TYPES.includes(entry.taetigkeit));
  const absenceHoursTotal = absenceEntries.reduce((sum, entry) => sum + Number(entry.stunden), 0);
  const dailyTargetForDate = getTotalWorkingHours(new Date(selectedDate));
  const isDayBlocked = absenceHoursTotal >= dailyTargetForDate && dailyTargetForDate > 0;
  const isPartialAbsence = absenceEntries.length > 0 && !isDayBlocked;

  if (loading) return <div className="p-4">Lädt...</div>;

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title="Zeiterfassung" backPath="/" />
      <div className="p-4">
        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                <CardTitle>Zeiterfassung</CardTitle>
              </div>
              <Button variant="outline" onClick={() => setShowAbsenceDialog(true)} className="gap-2">
                <Calendar className="h-4 w-4" />
                Abwesenheit
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="date">Datum</Label>
                <Input id="date" type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} required />
                <p className="text-sm text-muted-foreground">{format(new Date(selectedDate), "EEEE, dd. MMMM yyyy", { locale: de })}</p>
              </div>

              <div className="rounded-lg border bg-card p-4">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">{getWeeklyTargetHours()}h Wochensoll</Badge>
                  <span className="text-xs text-muted-foreground">Mo-Do: 8,5h • Fr: 5h (inkl. 0,5h Überstunde/ZA)</span>
                </div>
              </div>

              {loadingDayEntries ? (
                <div className="bg-muted/50 rounded-lg p-3 text-sm text-muted-foreground flex items-center gap-2">
                  <Calendar className="w-4 h-4 animate-pulse" />
                  Lade Tageseinträge...
                </div>
              ) : existingDayEntries.length > 0 ? (
                <div className={`rounded-lg p-4 space-y-3 ${isDayBlocked ? "bg-destructive/10 border border-destructive/30" : isPartialAbsence ? "bg-primary/5 border border-primary/20" : "bg-muted/40 border border-border"}`}>
                  <div className="flex items-center gap-2 font-medium text-sm">
                    {isDayBlocked ? (
                      <>
                        <AlertTriangle className="w-4 h-4 text-destructive" />
                        <span className="text-destructive">Tag blockiert ({absenceEntries[0]?.taetigkeit})</span>
                      </>
                    ) : isPartialAbsence ? (
                      <>
                        <Calendar className="w-4 h-4 text-primary" />
                        <span className="text-foreground">Teilweise abwesend</span>
                      </>
                    ) : (
                      <>
                        <Calendar className="w-4 h-4 text-muted-foreground" />
                        <span className="text-foreground">Bereits gebuchte Zeiten</span>
                      </>
                    )}
                  </div>

                  {!isDayBlocked && (
                    <div className="space-y-1.5">
                      {existingDayEntries.map((entry) => (
                        <div key={entry.id} className="flex items-center justify-between text-sm bg-background/60 rounded px-2 py-1.5">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="font-mono text-xs">{entry.start_time.substring(0, 5)} - {entry.end_time.substring(0, 5)}</Badge>
                            <span className="truncate max-w-[150px]">{getEntryLabel(entry)}</span>
                          </div>
                          <span className="font-medium">{Number(entry.stunden).toFixed(2)}h</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 text-sm text-muted-foreground">
                  <p className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-primary" />Noch keine Einträge für diesen Tag</p>
                </div>
              )}

              {!isDayBlocked && (
                <>
                  <div className="flex flex-wrap gap-2 justify-end">
                    <Button type="button" variant="outline" size="sm" onClick={applyFullDayPreset} className="flex items-center gap-1.5">
                      <Sun className="w-3.5 h-3.5" />Regelarbeitszeit ausfüllen
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setShowFillHoursDialog(true)} className="flex items-center gap-1.5">
                      <Timer className="w-3.5 h-3.5" />Reststunden auffüllen
                    </Button>
                  </div>

                  <div className="space-y-4">
                    {timeBlocks.map((block, index) => (
                      <div key={block.id} className="border rounded-lg p-4 space-y-4 bg-card">
                        <div className="flex items-center justify-between">
                          <h3 className="font-semibold text-sm flex items-center gap-2"><Clock className="w-4 h-4" />{timeBlocks.length > 1 ? `Zeitblock ${index + 1}` : "Arbeitszeit"}</h3>
                          {timeBlocks.length > 1 && (
                            <Button type="button" variant="ghost" size="sm" onClick={() => removeBlock(block.id)} className="text-destructive hover:text-destructive hover:bg-destructive/10">
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>

                        <div className="space-y-2">
                          <Label>Arbeitsort</Label>
                          <RadioGroup
                            value={block.locationType}
                            onValueChange={(value: "baustelle" | "werkstatt") => updateBlock(block.id, {
                              locationType: value,
                              projectId: value === "baustelle" ? block.projectId : "",
                            })}
                            className="grid grid-cols-1 sm:grid-cols-2 gap-3"
                          >
                            <div>
                              <RadioGroupItem value="baustelle" id={`baustelle-${block.id}`} className="peer sr-only" />
                              <Label htmlFor={`baustelle-${block.id}`} className="flex h-12 cursor-pointer items-center justify-center rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent peer-data-[state=checked]:border-primary text-sm">🏗️ Baustelle</Label>
                            </div>
                            <div>
                              <RadioGroupItem value="werkstatt" id={`werkstatt-${block.id}`} className="peer sr-only" />
                              <Label htmlFor={`werkstatt-${block.id}`} className="flex h-12 cursor-pointer items-center justify-center rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent peer-data-[state=checked]:border-primary text-sm">🔧 Werkstatt</Label>
                            </div>
                          </RadioGroup>
                        </div>

                        {block.locationType === "baustelle" && (
                          <div className="space-y-2">
                            <Label>Projekt <span className="text-muted-foreground font-normal">(optional)</span></Label>
                            <Select value={block.projectId} onValueChange={(value) => value === "new" ? (setPendingBlockIdForNewProject(block.id), setShowNewProjectDialog(true)) : updateBlock(block.id, { projectId: value })}>
                              <SelectTrigger><SelectValue placeholder="Projekt auswählen" /></SelectTrigger>
                              <SelectContent>
                                {projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name} ({project.plz})</SelectItem>)}
                                <SelectItem value="new" className="text-primary font-semibold"><div className="flex items-center gap-2"><Plus className="w-4 h-4" />Neues Projekt erstellen</div></SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        )}


                        <div className="space-y-2">
                          <Label>Tätigkeit <span className="text-muted-foreground font-normal">(optional)</span></Label>
                          <Input value={block.taetigkeit} onChange={(e) => updateBlock(block.id, { taetigkeit: e.target.value })} placeholder="Optional - z.B. Montage, Aufmaß..." />
                        </div>

                        <div className="space-y-2">
                          <Label>Stunden <span className="text-destructive">*</span></Label>
                          <Input
                            type="number"
                            step="0.25"
                            min="0.25"
                            max="12"
                            required
                            value={block.directHours}
                            onChange={(e) => updateBlock(block.id, { directHours: e.target.value })}
                            placeholder="z.B. 8.5"
                            className="text-center text-lg font-mono"
                          />
                          <p className="text-xs text-muted-foreground">
                            Berechnet: {block.startTime || "07:00"} – {block.endTime || "—"}
                            {block.pauseStart && block.pauseEnd && ` (Pause ${block.pauseStart}–${block.pauseEnd})`}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Die Mittagspause 12:00–12:30 wird automatisch berücksichtigt, wenn der Block über Mittag läuft.
                          </p>
                        </div>

                        <div className="border-t pt-3">
                          <MultiEmployeeSelect selectedEmployees={block.selectedEmployees} onSelectionChange={(employees) => updateBlockEmployees(block.id, employees)} date={selectedDate} startTime={block.startTime} endTime={block.endTime} label="Weitere Mitarbeiter (optional)" />
                        </div>

                        <div className="bg-muted/50 rounded px-3 py-2 flex items-center justify-between text-sm">
                          <span>Stunden</span>
                          <span className="font-bold">{calculateBlockHours(block).toFixed(2)} h</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <Button type="button" variant="outline" onClick={addTimeBlock} className="w-full gap-2 border-dashed"><Plus className="w-4 h-4" />Weitere Stunden hinzufügen</Button>
                  <div className="bg-primary/10 border border-primary/30 rounded-lg p-4 flex items-center justify-between"><span className="font-medium">Gesamt zu buchen</span><span className="text-2xl font-bold">{calculateTotalHours()} h</span></div>
                  <Button type="submit" className="w-full" disabled={saving || !allBlocksValid}>{saving ? "Wird gespeichert..." : !allBlocksValid ? "Bitte Stunden eingeben" : `${timeBlocks.length > 1 ? "Alle Einträge" : "Stunden"} erfassen`}</Button>
                </>
              )}
            </form>
          </CardContent>
        </Card>

        <Dialog open={showNewProjectDialog} onOpenChange={setShowNewProjectDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Neues Projekt erstellen</DialogTitle>
              <DialogDescription>Geben Sie die Details ein.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div><Label>Projektname *</Label><Input value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} /></div>
              <div><Label>PLZ *</Label><Input value={newProjectPlz} onChange={(e) => setNewProjectPlz(e.target.value)} maxLength={5} /></div>
              <div><Label>Adresse</Label><Input value={newProjectAddress} onChange={(e) => setNewProjectAddress(e.target.value)} /></div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => { setShowNewProjectDialog(false); setNewProjectName(""); setNewProjectPlz(""); setNewProjectAddress(""); setPendingBlockIdForNewProject(null); }} disabled={creatingProject}>Abbrechen</Button>
                <Button onClick={handleCreateNewProject} disabled={creatingProject}>{creatingProject ? "Wird erstellt..." : "Erstellen"}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={showAbsenceDialog} onOpenChange={setShowAbsenceDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Abwesenheit erfassen</DialogTitle>
              <DialogDescription>Erfassen Sie Urlaub, Krankenstand, Weiterbildung, Arztbesuch oder Zeitausgleich</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Label className="text-sm">Modus:</Label>
                <div className="flex items-center gap-2">
                  <Button type="button" variant={!absenceData.rangeMode ? "default" : "outline"} size="sm" onClick={() => setAbsenceData({ ...absenceData, rangeMode: false })}>Einzelner Tag</Button>
                  <Button type="button" variant={absenceData.rangeMode ? "default" : "outline"} size="sm" onClick={() => setAbsenceData({ ...absenceData, rangeMode: true })}>Zeitraum</Button>
                </div>
              </div>

              {absenceData.rangeMode ? (
                <div className="grid grid-cols-2 gap-4">
                  <div><Label>Von</Label><Input type="date" value={absenceData.dateFrom} onChange={(e) => setAbsenceData({ ...absenceData, dateFrom: e.target.value })} /></div>
                  <div><Label>Bis</Label><Input type="date" value={absenceData.dateTo} onChange={(e) => setAbsenceData({ ...absenceData, dateTo: e.target.value })} /></div>
                </div>
              ) : (
                <div><Label>Datum</Label><Input type="date" value={absenceData.date} onChange={(e) => setAbsenceData({ ...absenceData, date: e.target.value })} /></div>
              )}

              <div>
                <Label>Art</Label>
                <Select value={absenceData.type} onValueChange={(value: any) => setAbsenceData({ ...absenceData, type: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="urlaub">Urlaub</SelectItem>
                    <SelectItem value="krankenstand">Krankenstand</SelectItem>
                    <SelectItem value="weiterbildung">Weiterbildung</SelectItem>
                    <SelectItem value="arztbesuch">Arztbesuch</SelectItem>
                    <SelectItem value="zeitausgleich">Zeitausgleich</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {!absenceData.rangeMode && <div><Label>Stunden (optional)</Label><Input type="number" step="0.5" min="0" max="24" value={absenceData.customHours} onChange={(e) => setAbsenceData({ ...absenceData, customHours: e.target.value })} placeholder="Leer lassen für automatische Berechnung" /></div>}

              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setShowAbsenceDialog(false)} disabled={submittingAbsence}>Abbrechen</Button>
                <Button onClick={handleAbsenceSubmit} disabled={submittingAbsence}>{submittingAbsence ? "Wird gespeichert..." : "Speichern"}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <FillRemainingHoursDialog
          open={showFillHoursDialog}
          onOpenChange={setShowFillHoursDialog}
          date={selectedDate}
          remainingHours={Math.max(dailyTargetForDate - existingDayEntries.reduce((sum, entry) => sum + Number(entry.stunden), 0), 0)}
          bookedHours={existingDayEntries.reduce((sum, entry) => sum + Number(entry.stunden), 0)}
          targetHours={dailyTargetForDate}
          projects={projects}
          lastEndTime={getLastExistingEndTime()}
          onSubmit={async ({ projectId, locationType, description, hours, startTime, endTime, pauseMinutes, pauseStart, pauseEnd }) => {
            const { data: { user } } = await supabase.auth.getUser();

            if (!user) {
              toast({ variant: "destructive", title: "Fehler", description: "Sie müssen angemeldet sein" });
              return;
            }

            const { error } = await supabase.from("time_entries").insert({
              user_id: user.id,
              datum: selectedDate,
              project_id: locationType === "baustelle" ? projectId : null,
              disturbance_id: null,
              taetigkeit: description || null,
              stunden: hours,
              start_time: startTime,
              end_time: endTime,
              pause_minutes: pauseMinutes,
              pause_start: pauseStart,
              pause_end: pauseEnd,
              location_type: locationType,
              notizen: null,
              week_type: null,
            });

            if (error) {
              toast({ variant: "destructive", title: "Fehler", description: "Reststunden konnten nicht gebucht werden" });
              throw error;
            }

            toast({ title: "Erfolg", description: "Reststunden wurden gebucht" });
            await fetchExistingDayEntries(selectedDate);
          }}
        />
      </div>
    </div>
  );
};

export default TimeTracking;
