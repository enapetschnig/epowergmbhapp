import { useEffect, useState, FormEvent, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Shield, User as UserIcon, Send, Mail, Phone, MapPin, Shirt, FileText, Clock, Trash2, Settings, Save, Pencil, Calendar, MessageCircle } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import EmployeeDocumentsManager from "@/components/EmployeeDocumentsManager";
import BackupSectionComponent from "@/components/BackupSection";
import { PageHeader } from "@/components/PageHeader";
import { WhatsAppAdminSettings } from "@/components/WhatsAppAdminSettings";

type Profile = {
  id: string;
  vorname: string;
  nachname: string;
  is_active: boolean | null;
};

type UserRole = {
  user_id: string;
  role: string;
};

type SickNote = {
  id: string;
  fileName: string;
  filePath: string;
  uploadDate: string;
  userId: string;
  employeeName: string;
  source: "storage" | "time_entry";
  timeEntryId?: string;
};

interface Employee {
  id: string;
  user_id: string | null;
  vorname: string;
  nachname: string;
  geburtsdatum: string | null;
  adresse: string | null;
  plz: string | null;
  ort: string | null;
  telefon: string | null;
  email: string | null;
  sv_nummer: string | null;
  eintritt_datum: string | null;
  austritt_datum: string | null;
  position: string | null;
  beschaeftigung_art: string | null;
  stundenlohn: number | null;
  iban: string | null;
  bic: string | null;
  bank_name: string | null;
  kleidungsgroesse: string | null;
  schuhgroesse: string | null;
  notizen: string | null;
  land: string | null;
  whatsapp_aktiv: boolean | null;
}

export default function Admin() {
  const navigate = useNavigate();
  const { toast } = useToast();
  
  // User roles states
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [userRoles, setUserRoles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [inviteTelefon, setInviteTelefon] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [sendingInvite, setSendingInvite] = useState(false);
  const [sendingEmailInvite, setSendingEmailInvite] = useState(false);
  
  // Employee management states
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [showSizesDialog, setShowSizesDialog] = useState(false);
  const [formData, setFormData] = useState<Partial<Employee>>({});
  const [activeEmployeeTab, setActiveEmployeeTab] = useState<'stammdaten' | 'dokumente' | 'stunden'>('stammdaten');
  
  // Sick notes states
  const [sickNotes, setSickNotes] = useState<SickNote[]>([]);

  // Delete user dialog states
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<Profile | null>(null);

  // App settings states
  const [regiereportEmail, setRegiereportEmail] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(true);

  const fetchAppSettings = useCallback(async () => {
    setLoadingSettings(true);
    try {
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "disturbance_report_email")
        .maybeSingle();

      if (error) {
        console.error("Error fetching app settings:", error);
      } else if (data) {
        setRegiereportEmail(data.value);
      }
    } catch (err) {
      console.error("Error fetching app settings:", err);
    } finally {
      setLoadingSettings(false);
    }
  }, []);

  const saveRegiereportEmail = async () => {
    if (!regiereportEmail.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      toast({
        variant: "destructive",
        title: "Ungültige E-Mail",
        description: "Bitte geben Sie eine gültige E-Mail-Adresse ein.",
      });
      return;
    }

    setSavingSettings(true);
    try {
      const { error } = await supabase
        .from("app_settings")
        .upsert({ 
          key: "disturbance_report_email", 
          value: regiereportEmail,
          updated_at: new Date().toISOString()
        });

      if (error) throw error;

      toast({
        title: "Gespeichert",
        description: "E-Mail-Adresse wurde aktualisiert.",
      });
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: err.message || "Einstellung konnte nicht gespeichert werden.",
      });
    } finally {
      setSavingSettings(false);
    }
  };

  useEffect(() => {
    checkAdminAccess();
    fetchUsers();
    fetchEmployees();
    fetchSickNotes();
    fetchAppSettings();
  }, [fetchAppSettings]);

  const checkAdminAccess = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      navigate("/auth");
      return;
    }

    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .single();

    if (!roleData || roleData.role !== "administrator") {
      navigate("/");
    }
  };

  const fetchUsers = async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) setLoading(true);

    const { data: profilesData } = await supabase
      .from("profiles")
      .select("id, vorname, nachname, is_active")
      .order("nachname");

    const { data: rolesData } = await supabase
      .from("user_roles")
      .select("user_id, role");

    if (profilesData) {
      setProfiles(profilesData);
    }

    if (rolesData) {
      const rolesMap: Record<string, string> = {};
      rolesData.forEach((role: UserRole) => {
        rolesMap[role.user_id] = role.role;
      });
      setUserRoles(rolesMap);
    }

    if (!silent) setLoading(false);
  };

  const scrollToRegisteredUser = (userId: string) => {
    // Wait a tick so the list can re-render after state updates
    window.setTimeout(() => {
      const el = document.getElementById(`registered-user-${userId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("ring-2", "ring-primary", "ring-offset-2", "ring-offset-background");
        window.setTimeout(() => {
          el.classList.remove("ring-2", "ring-primary", "ring-offset-2", "ring-offset-background");
        }, 1600);
      }
    }, 50);
  };

  const handleActivateUser = async (userId: string, activate: boolean) => {
    const { data: updatedProfile, error } = await supabase
      .from("profiles")
      .update({ is_active: activate })
      .eq("id", userId)
      .select("id, is_active")
      .single();

    if (error || !updatedProfile) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: error?.message || "Aktivierung fehlgeschlagen (keine Berechtigung oder Benutzer nicht gefunden).",
      });
      return;
    }

    // Optimistic UI update (avoids full-page loading spinner + losing scroll position)
    setProfiles((prev) =>
      prev.map((p) => (p.id === userId ? { ...p, is_active: activate } : p))
    );

    toast({
      title: activate ? "Benutzer aktiviert" : "Benutzer deaktiviert",
      description: activate
        ? "Der Benutzer kann sich jetzt anmelden."
        : "Der Benutzer kann sich nicht mehr anmelden.",
    });

    // Refresh in background to stay in sync
    fetchUsers({ silent: true });

    // If activated, jump to the user in the "Registrierte Benutzer" list
    if (activate) scrollToRegisteredUser(userId);
  };

  const fetchEmployees = async () => {
    const { data, error } = await supabase
      .from("employees")
      .select("*")
      .order("nachname");

    if (error) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
    } else {
      setEmployees(data || []);
    }
  };

  const fetchSickNotes = async () => {
    try {
      // Get all profiles to find user IDs
      const { data: profilesData } = await supabase
        .from("profiles")
        .select("id, vorname, nachname");

      if (!profilesData || profilesData.length === 0) {
        setSickNotes([]);
        return;
      }

      const profileMap = new Map(profilesData.map(p => [p.id, p]));
      const allNotes: SickNote[] = [];

      // 1. Storage-based sick notes
      for (const profile of profilesData) {
        const { data: files, error } = await supabase.storage
          .from("employee-documents")
          .list(`${profile.id}/krankmeldung`, {
            sortBy: { column: "created_at", order: "desc" },
          });

        if (error || !files) continue;

        for (const file of files) {
          if (!file.id) continue;
          allNotes.push({
            id: `storage_${profile.id}/${file.name}`,
            fileName: file.name,
            filePath: `${profile.id}/krankmeldung/${file.name}`,
            uploadDate: file.created_at || new Date().toISOString(),
            userId: profile.id,
            employeeName: `${profile.vorname} ${profile.nachname}`,
            source: "storage",
          });
        }
      }

      // 2. time_entries-based sick notes
      const { data: timeEntries } = await supabase
        .from("time_entries")
        .select("id, user_id, datum, notizen, created_at")
        .ilike("notizen", "Krankmeldung:%")
        .order("datum", { ascending: false })
        .limit(50);

      if (timeEntries) {
        for (const entry of timeEntries) {
          const profile = profileMap.get(entry.user_id);
          const employeeName = profile
            ? `${profile.vorname} ${profile.nachname}`
            : "Unbekannt";
          const noteText = entry.notizen?.replace("Krankmeldung:", "").trim() || "Krankmeldung";

          // Check if notizen contains a file path (has a "/" indicating storage path)
          let entrySource: "storage" | "time_entry" = "time_entry";
          let entryFilePath = "";
          if (noteText.includes("/")) {
            entrySource = "storage";
            entryFilePath = noteText;
          }

          allNotes.push({
            id: `te_${entry.id}`,
            fileName: entryFilePath ? entryFilePath.split("/").pop() || noteText : noteText,
            filePath: entryFilePath,
            uploadDate: entry.datum || entry.created_at,
            userId: entry.user_id,
            employeeName,
            source: entrySource,
            timeEntryId: entry.id,
          });
        }
      }

      // Deduplicate: if same user + same date has both storage and time_entry, keep only storage
      const seen = new Map<string, SickNote>();
      for (const note of allNotes) {
        const dateStr = new Date(note.uploadDate).toISOString().slice(0, 10);
        const key = `${note.userId}_${dateStr}`;
        const existing = seen.get(key);
        if (!existing || (note.source === "storage" && existing.source === "time_entry")) {
          seen.set(key, note);
        }
      }

      const deduplicated = Array.from(seen.values());
      deduplicated.sort((a, b) => new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime());
      setSickNotes(deduplicated.slice(0, 30));
    } catch (err) {
      console.error("Error fetching sick notes:", err);
    }
  };

  const handleDeleteSickNote = async (note: SickNote) => {
    if (!confirm("Möchten Sie diese Krankmeldung wirklich löschen?")) {
      return;
    }

    try {
      if (note.source === "storage") {
        const { error } = await supabase.storage
          .from("employee-documents")
          .remove([note.filePath]);
        if (error) throw error;
      } else if (note.source === "time_entry" && note.timeEntryId) {
        const { error } = await supabase
          .from("time_entries")
          .delete()
          .eq("id", note.timeEntryId);
        if (error) throw error;
      }

      toast({
        title: "Gelöscht",
        description: "Krankmeldung wurde erfolgreich gelöscht.",
      });

      fetchSickNotes();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: error.message || "Krankmeldung konnte nicht gelöscht werden",
      });
    }
  };

  const handleInviteSend = async (e: FormEvent) => {
    e.preventDefault();
    
    if (!inviteTelefon.match(/^\+43\d{9,13}$/)) {
      toast({
        variant: "destructive",
        title: "Ungültige Telefonnummer",
        description: "Bitte Format +43... verwenden",
      });
      return;
    }

    setSendingInvite(true);

    try {
      const { data, error } = await supabase.functions.invoke('send-invitation', {
        body: { telefonnummer: inviteTelefon }
      });

      if (error) throw error;

      if (data && !data.success) {
        toast({
          variant: "destructive",
          title: "Fehler beim Senden",
          description: data.error || "Ein Fehler ist aufgetreten",
        });
        return;
      }

      toast({
        title: "SMS gesendet!",
        description: `Einladung wurde an ${inviteTelefon} gesendet.`,
      });
      setInviteTelefon("");
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Fehler beim Senden",
        description: error.message || "Ein Fehler ist aufgetreten",
      });
    } finally {
      setSendingInvite(false);
    }
  };

  const handleEmailInviteSend = async () => {
    if (!inviteEmail || !inviteEmail.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      toast({
        variant: "destructive",
        title: "Ungültige E-Mail",
        description: "Bitte eine gültige E-Mail-Adresse eingeben",
      });
      return;
    }

    setSendingEmailInvite(true);

    try {
      const { data, error } = await supabase.functions.invoke('send-email-invitation', {
        body: { email: inviteEmail }
      });

      if (error) throw error;

      if (data && !data.success) {
        toast({
          variant: "destructive",
          title: "Fehler beim Senden",
          description: data.error || "Ein Fehler ist aufgetreten",
        });
        return;
      }

      toast({
        title: "E-Mail gesendet!",
        description: `Einladung wurde an ${inviteEmail} gesendet.`,
      });
      setInviteEmail("");
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Fehler beim Senden",
        description: error.message || "Ein Fehler ist aufgetreten",
      });
    } finally {
      setSendingEmailInvite(false);
    }
  };

  const handleRoleChange = async (userId: string, newRole: "administrator" | "mitarbeiter") => {
    const { error } = await supabase
      .from("user_roles")
      .update({ role: newRole })
      .eq("user_id", userId);

    if (error) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: error.message,
      });
    } else {
      toast({
        title: "Erfolg",
        description: "Rolle wurde geändert.",
      });
      setUserRoles((prev) => ({ ...prev, [userId]: newRole }));
    }
  };

  const ensureEmployeeForUser = async (userId: string) => {
    // 1) Try to find existing employee linked to this user
    const { data: existing, error: findErr } = await supabase
      .from('employees')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (findErr) {
      toast({ variant: 'destructive', title: 'Fehler', description: findErr.message });
      return null;
    }
    if (existing) return existing as Employee;

    // 2) If not found, try to attach an existing employee record by name (user_id currently null)
    const profile = profiles.find(p => p.id === userId);
    if (!profile) {
      toast({ variant: 'destructive', title: 'Fehler', description: 'Profil nicht gefunden' });
      return null;
    }

    const { data: byName, error: byNameErr } = await supabase
      .from('employees')
      .select('*')
      .is('user_id', null)
      .eq('vorname', profile.vorname)
      .eq('nachname', profile.nachname);

    if (byNameErr) {
      toast({ variant: 'destructive', title: 'Fehler', description: byNameErr.message });
      return null;
    }

    if (byName && byName.length === 1) {
      const candidate = byName[0] as Employee;
      const { data: updated, error: attachErr } = await supabase
        .from('employees')
        .update({ user_id: userId })
        .eq('id', candidate.id)
        .select()
        .single();

      if (attachErr) {
        toast({ variant: 'destructive', title: 'Fehler', description: attachErr.message });
        return null;
      }

      toast({ title: 'Verbunden', description: 'Bestehender Mitarbeiterdatensatz wurde verknüpft.' });
      fetchEmployees();
      return updated as Employee;
    }

    // 3) Otherwise create a fresh employee record linked to the user
    const insertPayload = {
      user_id: userId,
      vorname: profile.vorname || '',
      nachname: profile.nachname || '',
    };

    const { data: inserted, error: insertErr } = await supabase
      .from('employees')
      .insert(insertPayload)
      .select()
      .single();

    if (insertErr) {
      toast({ variant: 'destructive', title: 'Fehler', description: insertErr.message });
      return null;
    }

    fetchEmployees();
    return inserted as Employee;
  };

  const openEmployeeEditorForUser = async (userId: string, tab: 'stammdaten' | 'dokumente' = 'stammdaten') => {
    setActiveEmployeeTab(tab);
    const emp = await ensureEmployeeForUser(userId);
    if (emp) setSelectedEmployee(emp);
  };

  const handleSaveEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmployee) return;

    try {
      const { error } = await supabase
        .from("employees")
        .update(formData)
        .eq("id", selectedEmployee.id);

      if (error) throw error;

      toast({ title: "Erfolg", description: "Änderungen gespeichert" });
      fetchEmployees();
      setSelectedEmployee(null);
    } catch (error: any) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
    }
  };

  useEffect(() => {
    if (selectedEmployee) {
      setFormData(selectedEmployee);
    }
  }, [selectedEmployee]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Lädt...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title="Verwaltung" backPath="/" />

      <main className="container mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-6 lg:py-8 space-y-8">
        {/* ===== WARTENDE AKTIVIERUNGEN ===== */}
        {profiles.filter(p => !p.is_active).length > 0 && (
          <section>
            <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
              Wartende Aktivierungen
              <span className="bg-destructive text-destructive-foreground text-sm px-2 py-1 rounded-full">
                {profiles.filter(p => !p.is_active).length}
              </span>
            </h2>
            
            <Card className="mb-6 border-destructive/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UserIcon className="h-5 w-5 text-destructive" />
                  Neue Registrierungen
                </CardTitle>
                <CardDescription>
                  Diese Benutzer haben sich registriert und warten auf Freischaltung
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {profiles.filter(p => !p.is_active).map((profile) => (
                    <div key={profile.id} className="flex items-center justify-between p-4 rounded-lg border bg-card">
                      <div className="flex items-center gap-3">
                        <Avatar>
                          <AvatarFallback className="bg-destructive/10 text-destructive">
                            {profile.vorname[0]}
                            {profile.nachname[0]}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium">
                            {profile.vorname} {profile.nachname}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Wartet auf Freischaltung
                          </p>
                        </div>
                      </div>
                      <Button onClick={() => handleActivateUser(profile.id, true)}>
                        Aktivieren
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </section>
        )}

        {/* ===== BENUTZERROLLEN SEKTION ===== */}
        <section>
          <h2 className="text-2xl font-bold mb-4">Benutzerrollen & Einladungen</h2>
          
          {/* Invitation Form */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Send className="h-5 w-5" />
                Neuen Mitarbeiter einladen
              </CardTitle>
              <CardDescription>
                Senden Sie eine Einladung per SMS oder E-Mail an einen neuen Mitarbeiter
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleInviteSend} className="space-y-4">
                <div>
                  <Label htmlFor="telefon">Telefonnummer (Format: +43...)</Label>
                  <Input
                    id="telefon"
                    type="tel"
                    placeholder="+43664..."
                    value={inviteTelefon}
                    onChange={(e) => setInviteTelefon(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Format: +43 gefolgt von der Nummer ohne Leerzeichen
                  </p>
                </div>
                <Button type="submit" disabled={sendingInvite || !inviteTelefon}>
                  {sendingInvite ? "Sendet..." : "SMS senden"}
                </Button>
              </form>
              
              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">oder</span>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <Label htmlFor="invite-email">E-Mail-Adresse</Label>
                  <Input
                    id="invite-email"
                    type="email"
                    placeholder="mitarbeiter@example.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                  />
                </div>
                <Button onClick={handleEmailInviteSend} disabled={sendingEmailInvite || !inviteEmail}>
                  {sendingEmailInvite ? "Sendet..." : "E-Mail senden"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                  <Shield className="h-5 w-5 text-primary" />
                  Administratoren
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-primary">
                  {profiles.filter(p => userRoles[p.id] === "administrator").length}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                  <UserIcon className="h-5 w-5 text-accent" />
                  Mitarbeiter
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-accent">
                  {profiles.filter(p => userRoles[p.id] === "mitarbeiter").length}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Users List */}
          <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <CardTitle>Registrierte Benutzer</CardTitle>
            <CardDescription>
              Rollen verwalten und Mitarbeiterdaten/Dokumente bearbeiten
            </CardDescription>
          </div>
          <Button variant="outline" onClick={() => setShowSizesDialog(true)}>
            <Shirt className="w-4 h-4 mr-2" />
            Arbeitskleidung/Schuhe Größen
          </Button>
        </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {profiles.filter(p => p.is_active).map((profile) => (
                  <div
                    key={profile.id}
                    id={`registered-user-${profile.id}`}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 sm:p-4 rounded-lg border bg-card transition-shadow"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar>
                        <AvatarFallback>
                          {profile.vorname[0]}
                          {profile.nachname[0]}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium">
                          {profile.vorname} {profile.nachname}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {userRoles[profile.id] === "administrator" ? "Administrator" : "Mitarbeiter"}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                      <Select
                        value={userRoles[profile.id]}
                        onValueChange={(val) => handleRoleChange(profile.id, val as "administrator" | "mitarbeiter")}
                      >
                        <SelectTrigger className="w-full sm:w-[200px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="administrator">Administrator</SelectItem>
                          <SelectItem value="mitarbeiter">Mitarbeiter</SelectItem>
                        </SelectContent>
                      </Select>

                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          onClick={() => openEmployeeEditorForUser(profile.id, 'stammdaten')}
                        >
                          Bearbeiten
                        </Button>
                        <Button onClick={() => openEmployeeEditorForUser(profile.id, 'dokumente')}>
                          <FileText className="w-4 h-4 mr-2" />
                          Dokumente
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setUserToDelete(profile);
                            setDeleteDialogOpen(true);
                          }}
                        >
                          Deaktivieren
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Sick Notes Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Neue Krankmeldungen
              </CardTitle>
              <CardDescription>
                Zuletzt hochgeladene Krankmeldungen der Mitarbeiter
              </CardDescription>
            </CardHeader>
            <CardContent>
              {sickNotes.length === 0 ? (
                <p className="text-muted-foreground text-center py-4">
                  Keine Krankmeldungen vorhanden
                </p>
              ) : (
                <div className="space-y-3">
                  {sickNotes.map((note) => {
                    // Display name without timestamp prefix
                    const displayName = note.fileName.includes("_") 
                      ? note.fileName.split("_").slice(1).join("_") 
                      : note.fileName;

                    return (
                      <div key={note.id} className="flex items-center justify-between p-4 rounded-lg border bg-card">
                        <div className="flex items-center gap-3">
                          <Avatar>
                            <AvatarFallback>
                              {note.employeeName.split(" ").map(n => n[0]).join("")}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium">
                              {note.employeeName}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {displayName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {format(new Date(note.uploadDate), "dd.MM.yyyy")}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={async () => {
                              if (note.source === "storage" && note.filePath) {
                                const { data, error } = await supabase.storage
                                  .from("employee-documents")
                                  .createSignedUrl(note.filePath, 300);

                                if (error || !data?.signedUrl) {
                                  toast({ 
                                    variant: "destructive", 
                                    title: "Fehler", 
                                    description: "Dokument konnte nicht geöffnet werden" 
                                  });
                                  return;
                                }
                                window.open(data.signedUrl, "_blank");
                              } else {
                                toast({
                                  title: "Keine Datei",
                                  description: "Für diese Krankmeldung wurde keine Datei hochgeladen.",
                                });
                              }
                            }}
                          >
                            Ansehen
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDeleteSickNote(note)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        {/* ===== WHATSAPP EINSTELLUNGEN ===== */}
        <section>
          <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
            <MessageCircle className="h-6 w-6 text-green-600" />
            WhatsApp Einstellungen
          </h2>
          <WhatsAppAdminSettings />
        </section>

      </main>

      {/* Employee Detail Dialog */}
      <Dialog open={!!selectedEmployee} onOpenChange={() => setSelectedEmployee(null)}>
        <DialogContent className="max-w-5xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>
              {selectedEmployee?.vorname} {selectedEmployee?.nachname}
            </DialogTitle>
          </DialogHeader>

          <Tabs value={activeEmployeeTab} onValueChange={(val) => setActiveEmployeeTab(val as any)}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="stammdaten">
                <UserIcon className="w-4 h-4 mr-2" />
                Stammdaten
              </TabsTrigger>
              <TabsTrigger value="dokumente">
                <FileText className="w-4 h-4 mr-2" />
                Dokumente
              </TabsTrigger>
              <TabsTrigger value="stunden">
                <Clock className="w-4 h-4 mr-2" />
                Stunden
              </TabsTrigger>
            </TabsList>

            {/* Tab 1: Stammdaten */}
            <TabsContent value="stammdaten">
              <ScrollArea className="h-[500px] pr-4">
                <form onSubmit={handleSaveEmployee} className="space-y-6">
                  <div>
                    <h3 className="text-lg font-semibold mb-3">Persönliche Daten</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Vorname *</Label>
                        <Input
                          value={formData.vorname || ""}
                          onChange={(e) => setFormData({ ...formData, vorname: e.target.value })}
                          required
                        />
                      </div>
                      <div>
                        <Label>Nachname *</Label>
                        <Input
                          value={formData.nachname || ""}
                          onChange={(e) => setFormData({ ...formData, nachname: e.target.value })}
                          required
                        />
                      </div>
                      <div>
                        <Label>Geburtsdatum</Label>
                        <Input
                          type="date"
                          value={formData.geburtsdatum || ""}
                          onChange={(e) => setFormData({ ...formData, geburtsdatum: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <h3 className="text-lg font-semibold mb-3">Kontaktdaten</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="col-span-2">
                        <Label>Adresse</Label>
                        <Input
                          value={formData.adresse || ""}
                          onChange={(e) => setFormData({ ...formData, adresse: e.target.value })}
                          placeholder="Straße und Hausnummer"
                        />
                      </div>
                      <div>
                        <Label>PLZ</Label>
                        <Input
                          value={formData.plz || ""}
                          onChange={(e) => setFormData({ ...formData, plz: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label>Ort</Label>
                        <Input
                          value={formData.ort || ""}
                          onChange={(e) => setFormData({ ...formData, ort: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label>Telefon</Label>
                        <Input
                          type="tel"
                          value={formData.telefon || ""}
                          onChange={(e) => setFormData({ ...formData, telefon: e.target.value })}
                        />
                      </div>
                      <div className="flex items-center justify-between rounded-lg border p-3">
                        <div>
                          <Label className="font-medium">WhatsApp freigeschalten</Label>
                          <p className="text-xs text-muted-foreground">Mitarbeiter kann den WhatsApp-Bot nutzen</p>
                        </div>
                        <Switch
                          checked={formData.whatsapp_aktiv || false}
                          onCheckedChange={(c) => setFormData({ ...formData, whatsapp_aktiv: c })}
                        />
                      </div>
                      <div>
                        <Label>E-Mail</Label>
                        <Input
                          type="email"
                          value={formData.email || ""}
                          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <h3 className="text-lg font-semibold mb-3">Beschäftigung</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Position</Label>
                        <Input
                          value={formData.position || ""}
                          onChange={(e) => setFormData({ ...formData, position: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label>Beschäftigungsart</Label>
                        <Select
                          value={formData.beschaeftigung_art || ""}
                          onValueChange={(val) => setFormData({ ...formData, beschaeftigung_art: val })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Wählen..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="vollzeit">Vollzeit</SelectItem>
                            <SelectItem value="teilzeit">Teilzeit</SelectItem>
                            <SelectItem value="geringfuegig">Geringfügig</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Eintrittsdatum</Label>
                        <Input
                          type="date"
                          value={formData.eintritt_datum || ""}
                          onChange={(e) => setFormData({ ...formData, eintritt_datum: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label>Austrittsdatum</Label>
                        <Input
                          type="date"
                          value={formData.austritt_datum || ""}
                          onChange={(e) => setFormData({ ...formData, austritt_datum: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label>Stundenlohn (€)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={formData.stundenlohn || ""}
                          onChange={(e) => setFormData({ ...formData, stundenlohn: parseFloat(e.target.value) || null })}
                        />
                      </div>
                      <div>
                        <Label>SV-Nummer</Label>
                        <Input
                          value={formData.sv_nummer || ""}
                          onChange={(e) => setFormData({ ...formData, sv_nummer: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <h3 className="text-lg font-semibold mb-3">Bankverbindung</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="col-span-2">
                        <Label>IBAN</Label>
                        <Input
                          value={formData.iban || ""}
                          onChange={(e) => setFormData({ ...formData, iban: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label>BIC</Label>
                        <Input
                          value={formData.bic || ""}
                          onChange={(e) => setFormData({ ...formData, bic: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label>Bank</Label>
                        <Input
                          value={formData.bank_name || ""}
                          onChange={(e) => setFormData({ ...formData, bank_name: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <h3 className="text-lg font-semibold mb-3">Arbeitskleidung</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Kleidungsgröße</Label>
                        <Input
                          value={formData.kleidungsgroesse || ""}
                          onChange={(e) => setFormData({ ...formData, kleidungsgroesse: e.target.value })}
                          placeholder="z.B. L, XL, XXL"
                        />
                      </div>
                      <div>
                        <Label>Schuhgröße</Label>
                        <Input
                          value={formData.schuhgroesse || ""}
                          onChange={(e) => setFormData({ ...formData, schuhgroesse: e.target.value })}
                          placeholder="z.B. 42, 43, 44"
                        />
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <h3 className="text-lg font-semibold mb-3">Notizen</h3>
                    <Textarea
                      value={formData.notizen || ""}
                      onChange={(e) => setFormData({ ...formData, notizen: e.target.value })}
                      rows={4}
                      placeholder="Interne Notizen zum Mitarbeiter..."
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-4">
                    <Button type="button" variant="outline" onClick={() => setSelectedEmployee(null)}>
                      Abbrechen
                    </Button>
                    <Button type="submit">Speichern</Button>
                  </div>
                </form>
              </ScrollArea>
            </TabsContent>

            {/* Tab 2: Dokumente */}
            <TabsContent value="dokumente">
              <ScrollArea className="h-[500px]">
                {selectedEmployee && (
                  <EmployeeDocumentsManager 
                    employeeId={selectedEmployee.id}
                    userId={selectedEmployee.user_id || undefined}
                  />
                )}
              </ScrollArea>
            </TabsContent>

            {/* Tab 3: Stunden */}
            <TabsContent value="stunden">
              <ScrollArea className="h-[500px]">
                <div className="p-4">
                  <Button
                    onClick={() => {
                      if (selectedEmployee) {
                        navigate(`/hours-report?employeeId=${selectedEmployee.id}`);
                      }
                    }}
                    className="w-full"
                  >
                    Zur Stundenauswertung
                  </Button>
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Sizes Overview Dialog */}
      <Dialog open={showSizesDialog} onOpenChange={setShowSizesDialog}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shirt className="w-5 h-5" />
              Arbeitskleidung & Schuhgrößen
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="h-[500px]">
            <div className="space-y-2">
              {employees
                .filter(emp => emp.kleidungsgroesse || emp.schuhgroesse)
                .sort((a, b) => a.nachname.localeCompare(b.nachname))
                .map((emp) => (
                  <div
                    key={emp.id}
                    className="p-4 border rounded-lg hover:bg-accent/50 cursor-pointer transition-colors"
                    onClick={() => {
                      setShowSizesDialog(false);
                      setSelectedEmployee(emp);
                    }}
                  >
                    <div className="grid grid-cols-4 gap-4 items-center">
                      <div className="col-span-2">
                        <p className="font-medium">
                          {emp.vorname} {emp.nachname}
                        </p>
                        <p className="text-sm text-muted-foreground">{emp.position || "Mitarbeiter"}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Kleidung</p>
                        <p className="font-semibold text-lg">
                          {emp.kleidungsgroesse || "-"}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Schuhe</p>
                        <p className="font-semibold text-lg">
                          {emp.schuhgroesse || "-"}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              
              {employees.filter(emp => emp.kleidungsgroesse || emp.schuhgroesse).length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <Shirt className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>Noch keine Größenangaben vorhanden</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Delete User Dialog - Step 1: Deaktivieren oder Löschen? */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Benutzer deaktivieren</DialogTitle>
            <DialogDescription>
              Möchten Sie {userToDelete?.vorname} {userToDelete?.nachname} nur deaktivieren oder komplett löschen?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                if (userToDelete) {
                  handleActivateUser(userToDelete.id, false);
                }
                setDeleteDialogOpen(false);
                setUserToDelete(null);
              }}
            >
              Nur deaktivieren
            </Button>
            <Button
              variant="destructive"
              className="w-full"
              onClick={() => {
                setDeleteDialogOpen(false);
                setDeleteConfirmOpen(true);
              }}
            >
              Benutzer löschen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete User Dialog - Step 2: Bestätigung */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sind Sie sicher?</AlertDialogTitle>
            <AlertDialogDescription>
              Möchten Sie {userToDelete?.vorname} {userToDelete?.nachname} wirklich löschen?
              <br /><br />
              <strong>Hinweis:</strong> Alle Arbeitszeiterfassungen und Dokumente bleiben vorerst gespeichert.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setDeleteConfirmOpen(false);
              setUserToDelete(null);
            }}>
              Abbrechen
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (!userToDelete) return;
                
                try {
                  // Delete the employee record if exists
                  const { error: empError } = await supabase
                    .from("employees")
                    .delete()
                    .eq("user_id", userToDelete.id);
                  
                  if (empError) {
                    console.error("Employee delete error:", empError);
                  }

                  // Delete user roles
                  const { error: roleError } = await supabase
                    .from("user_roles")
                    .delete()
                    .eq("user_id", userToDelete.id);
                  
                  if (roleError) {
                    console.error("Role delete error:", roleError);
                  }

                  // Delete the profile
                  const { error: profileError } = await supabase
                    .from("profiles")
                    .delete()
                    .eq("id", userToDelete.id);
                  
                  if (profileError) throw profileError;

                  toast({
                    title: "Benutzer gelöscht",
                    description: `${userToDelete.vorname} ${userToDelete.nachname} wurde erfolgreich gelöscht.`,
                  });

                  fetchUsers({ silent: true });
                  fetchEmployees();
                } catch (error: any) {
                  toast({
                    variant: "destructive",
                    title: "Fehler",
                    description: error.message || "Benutzer konnte nicht gelöscht werden",
                  });
                }
                
                setDeleteConfirmOpen(false);
                setUserToDelete(null);
              }}
            >
              Ja, löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ===== EINSTELLUNGEN SEKTION ===== */}
      <section className="mt-8">
        <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
          <Settings className="h-6 w-6" />
          Einstellungen
        </h2>
        
        <Card>
          <CardHeader>
            <CardTitle>E-Mail-Einstellungen</CardTitle>
            <CardDescription>
              Konfigurieren Sie die E-Mail-Adressen für automatische Benachrichtigungen
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="disturbance-email">Regiebericht E-Mail-Empfänger</Label>
              <div className="flex gap-2">
                <Input
                  id="disturbance-email"
                  type="email"
                  placeholder="office@example.com"
                  value={regiereportEmail}
                  onChange={(e) => setRegiereportEmail(e.target.value)}
                  disabled={loadingSettings}
                  className="flex-1"
                />
                <Button 
                  onClick={saveRegiereportEmail} 
                  disabled={savingSettings || loadingSettings}
                >
                  <Save className="h-4 w-4 mr-2" />
                  {savingSettings ? "Speichert..." : "Speichern"}
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                Diese E-Mail-Adresse erhält alle Regieberichte als Kopie.
              </p>
            </div>
          </CardContent>
        </Card>
      </section>

        {/* ===== ZEITAUSGLEICH-ÜBERSICHT ===== */}
        <ZAOverviewSection profiles={profiles} />

        {/* ===== URLAUBSKONTO ===== */}
        <VacationOverviewSection profiles={profiles} />

        {/* ===== DATENSICHERUNG ===== */}
        <BackupSectionComponent />
    </div>
  );
}

/* ZA Overview Component - calculates ZA balance per employee */
function ZAOverviewSection({ profiles }: { profiles: { id: string; vorname: string; nachname: string; is_active: boolean | null }[] }) {
  const { toast } = useToast();
  const [zaData, setZaData] = useState<{ userId: string; name: string; accrued: number; taken: number; adjustments: number }[]>([]);
  const [loadingZA, setLoadingZA] = useState(true);

  // Dialog state
  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [adjustHours, setAdjustHours] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [savingAdjust, setSavingAdjust] = useState(false);
  const [adjustHistory, setAdjustHistory] = useState<{ id: string; hours: number; reason: string; created_at: string; admin_name: string }[]>([]);

  useEffect(() => {
    fetchZAData();
  }, [profiles]);

  const fetchZAData = async () => {
    if (profiles.length === 0) return;
    setLoadingZA(true);

    const activeProfiles = profiles.filter(p => p.is_active);

    const [{ data: allEntries }, { data: allAdjustments }] = await Promise.all([
      supabase.from("time_entries").select("user_id, datum, stunden, taetigkeit").order("datum"),
      supabase.from("za_adjustments").select("user_id, hours"),
    ]);

    if (!allEntries) {
      setLoadingZA(false);
      return;
    }

    // Sum adjustments per user
    const adjMap: Record<string, number> = {};
    (allAdjustments || []).forEach(a => {
      adjMap[a.user_id] = (adjMap[a.user_id] || 0) + Number(a.hours);
    });

    const result = activeProfiles.map(profile => {
      const userEntries = allEntries.filter(e => e.user_id === profile.id);

      const fridayDates = new Set<string>();
      userEntries.forEach(e => {
        const d = new Date(e.datum);
        if (d.getDay() === 5 && !["Urlaub", "Krankenstand", "Weiterbildung", "Arztbesuch", "Zeitausgleich"].includes(e.taetigkeit)) {
          fridayDates.add(e.datum);
        }
      });
      const accrued = fridayDates.size * 0.5;

      const taken = userEntries
        .filter(e => e.taetigkeit === "Zeitausgleich")
        .reduce((sum, e) => sum + Number(e.stunden), 0);

      return {
        userId: profile.id,
        name: `${profile.vorname} ${profile.nachname}`,
        accrued,
        taken,
        adjustments: adjMap[profile.id] || 0,
      };
    });

    setZaData(result);
    setLoadingZA(false);
  };

  const openAdjustDialog = async (userId: string) => {
    setEditUserId(userId);
    setAdjustHours("");
    setAdjustReason("");

    // Fetch history for this user
    const { data } = await supabase
      .from("za_adjustments")
      .select("id, hours, reason, created_at, adjusted_by")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (data && data.length > 0) {
      // Resolve admin names
      const adminIds = [...new Set(data.map(d => d.adjusted_by))];
      const { data: adminProfiles } = await supabase
        .from("profiles")
        .select("id, vorname, nachname")
        .in("id", adminIds);

      const adminMap: Record<string, string> = {};
      (adminProfiles || []).forEach(p => {
        adminMap[p.id] = `${p.vorname} ${p.nachname}`.trim();
      });

      setAdjustHistory(data.map(d => ({
        id: d.id,
        hours: Number(d.hours),
        reason: d.reason,
        created_at: d.created_at,
        admin_name: adminMap[d.adjusted_by] || "Unbekannt",
      })));
    } else {
      setAdjustHistory([]);
    }
  };

  const handleSaveAdjustment = async () => {
    if (!editUserId || !adjustReason.trim()) {
      toast({ variant: "destructive", title: "Fehler", description: "Bitte Grund angeben." });
      return;
    }
    const hrs = Number(adjustHours.replace(",", "."));
    if (!Number.isFinite(hrs) || hrs === 0) {
      toast({ variant: "destructive", title: "Fehler", description: "Bitte gültige Stunden angeben (≠ 0)." });
      return;
    }

    setSavingAdjust(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setSavingAdjust(false);
      return;
    }

    const { error } = await supabase.from("za_adjustments").insert({
      user_id: editUserId,
      hours: hrs,
      reason: adjustReason.trim(),
      adjusted_by: user.id,
    });

    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
    } else {
      toast({ title: "Gespeichert", description: "ZA-Korrektur wurde eingetragen." });
      setEditUserId(null);
      fetchZAData();
    }
    setSavingAdjust(false);
  };

  const editRow = zaData.find(r => r.userId === editUserId);
  const editSaldo = editRow ? editRow.accrued - editRow.taken + editRow.adjustments : 0;

  return (
    <section>
      <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
        <Clock className="h-6 w-6" />
        Zeitausgleich-Übersicht
      </h2>
      <Card>
        <CardHeader>
          <CardTitle>ZA-Kontostand pro Mitarbeiter</CardTitle>
          <CardDescription>
            Gutschrift: +0,5h pro gearbeitetem Freitag • Abbuchung: Zeitausgleich-Einträge
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingZA ? (
            <p className="text-muted-foreground">Lädt ZA-Daten...</p>
          ) : zaData.length === 0 ? (
            <p className="text-muted-foreground">Keine aktiven Mitarbeiter</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 font-medium">Mitarbeiter</th>
                    <th className="text-right p-3 font-medium">ZA angesammelt</th>
                    <th className="text-right p-3 font-medium">ZA genommen</th>
                    <th className="text-right p-3 font-medium">Korrekturen</th>
                    <th className="text-right p-3 font-medium">Saldo</th>
                    <th className="p-3 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {zaData.map(row => {
                    const saldo = row.accrued - row.taken + row.adjustments;
                    return (
                      <tr key={row.userId} className="border-b">
                        <td className="p-3 font-medium">{row.name}</td>
                        <td className="p-3 text-right text-muted-foreground">+{row.accrued.toFixed(1)}h</td>
                        <td className="p-3 text-right text-muted-foreground">-{row.taken.toFixed(1)}h</td>
                        <td className="p-3 text-right text-muted-foreground">
                          {row.adjustments !== 0 ? `${row.adjustments > 0 ? "+" : ""}${row.adjustments.toFixed(1)}h` : "–"}
                        </td>
                        <td className={`p-3 text-right font-bold ${saldo < 0 ? 'text-destructive' : 'text-primary'}`}>
                          {saldo.toFixed(1)}h
                        </td>
                        <td className="p-3 text-right">
                          <Button variant="ghost" size="icon" onClick={() => openAdjustDialog(row.userId)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ZA Adjustment Dialog */}
      <Dialog open={!!editUserId} onOpenChange={(open) => { if (!open) setEditUserId(null); }}>
        <DialogContent className="max-w-lg max-h-[85vh]">
          <DialogHeader>
            <DialogTitle>ZA-Korrektur: {editRow?.name}</DialogTitle>
            <DialogDescription>
              Aktueller Saldo: <span className="font-bold">{editSaldo.toFixed(1)}h</span>
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-4 p-1">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Stunden (+/-)</Label>
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder="z.B. -3,0 oder +2,0"
                    value={adjustHours}
                    onChange={(e) => setAdjustHours(e.target.value)}
                  />
                </div>
                <div className="col-span-2">
                  <Label>Grund (Pflicht)</Label>
                  <Textarea
                    placeholder="z.B. Auszahlung März 2026"
                    value={adjustReason}
                    onChange={(e) => setAdjustReason(e.target.value)}
                    rows={2}
                  />
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setEditUserId(null)}>Abbrechen</Button>
                <Button onClick={handleSaveAdjustment} disabled={savingAdjust}>
                  {savingAdjust ? "Speichert..." : "Korrektur speichern"}
                </Button>
              </DialogFooter>

              {adjustHistory.length > 0 && (
                <div className="pt-2">
                  <Separator className="mb-3" />
                  <h4 className="font-semibold text-sm mb-2">Bisherige Korrekturen</h4>
                  <div className="space-y-2">
                    {adjustHistory.map(h => (
                      <div key={h.id} className="text-sm border rounded-md p-2 bg-muted/30">
                        <div className="flex justify-between">
                          <span className="font-medium">{h.hours > 0 ? "+" : ""}{h.hours.toFixed(1)}h</span>
                          <span className="text-muted-foreground text-xs">
                            {format(new Date(h.created_at), "dd.MM.yyyy HH:mm")}
                          </span>
                        </div>
                        <p className="text-muted-foreground">{h.reason}</p>
                        <p className="text-xs text-muted-foreground">von {h.admin_name}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/* Vacation Overview Component - calculates vacation balance per employee */
function VacationOverviewSection({ profiles }: { profiles: { id: string; vorname: string; nachname: string; is_active: boolean | null }[] }) {
  const { toast } = useToast();
  const [vacData, setVacData] = useState<{ userId: string; name: string; entitled: number; taken: number }[]>([]);
  const [loadingVac, setLoadingVac] = useState(true);

  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [adjustDays, setAdjustDays] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [savingAdjust, setSavingAdjust] = useState(false);
  const [adjustHistory, setAdjustHistory] = useState<{ id: string; days: number; reason: string; created_at: string; admin_name: string }[]>([]);

  useEffect(() => {
    fetchVacData();
  }, [profiles]);

  const fetchVacData = async () => {
    if (profiles.length === 0) return;
    setLoadingVac(true);

    const activeProfiles = profiles.filter(p => p.is_active);

    const [{ data: allEntries }, { data: allAdjustments }] = await Promise.all([
      supabase.from("time_entries").select("user_id, taetigkeit, datum").eq("taetigkeit", "Urlaub"),
      supabase.from("vacation_adjustments" as any).select("user_id, days"),
    ]);

    // Sum adjustments (entitled days) per user
    const adjMap: Record<string, number> = {};
    ((allAdjustments as any[]) || []).forEach((a: any) => {
      adjMap[a.user_id] = (adjMap[a.user_id] || 0) + Number(a.days);
    });

    // Count unique vacation days per user
    const takenMap: Record<string, Set<string>> = {};
    (allEntries || []).forEach(e => {
      if (!takenMap[e.user_id]) takenMap[e.user_id] = new Set();
      takenMap[e.user_id].add(e.datum);
    });

    const result = activeProfiles.map(profile => ({
      userId: profile.id,
      name: `${profile.vorname} ${profile.nachname}`,
      entitled: adjMap[profile.id] || 0,
      taken: takenMap[profile.id]?.size || 0,
    }));

    setVacData(result);
    setLoadingVac(false);
  };

  const openAdjustDialog = async (userId: string) => {
    setEditUserId(userId);
    setAdjustDays("");
    setAdjustReason("");

    const { data } = await supabase
      .from("vacation_adjustments" as any)
      .select("id, days, reason, created_at, adjusted_by")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (data && data.length > 0) {
      const adminIds = [...new Set((data as any[]).map((d: any) => d.adjusted_by))];
      const { data: adminProfiles } = await supabase
        .from("profiles")
        .select("id, vorname, nachname")
        .in("id", adminIds);

      const adminMap: Record<string, string> = {};
      (adminProfiles || []).forEach(p => {
        adminMap[p.id] = `${p.vorname} ${p.nachname}`.trim();
      });

      setAdjustHistory((data as any[]).map((d: any) => ({
        id: d.id,
        days: Number(d.days),
        reason: d.reason,
        created_at: d.created_at,
        admin_name: adminMap[d.adjusted_by] || "Unbekannt",
      })));
    } else {
      setAdjustHistory([]);
    }
  };

  const handleSaveAdjustment = async () => {
    if (!editUserId || !adjustReason.trim()) {
      toast({ variant: "destructive", title: "Fehler", description: "Bitte Grund angeben." });
      return;
    }
    const d = Number(adjustDays.replace(",", "."));
    if (!Number.isFinite(d) || d === 0) {
      toast({ variant: "destructive", title: "Fehler", description: "Bitte gültige Tage angeben (≠ 0)." });
      return;
    }

    setSavingAdjust(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSavingAdjust(false); return; }

    const { error } = await supabase.from("vacation_adjustments" as any).insert({
      user_id: editUserId,
      days: d,
      reason: adjustReason.trim(),
      adjusted_by: user.id,
    } as any);

    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
    } else {
      toast({ title: "Gespeichert", description: "Urlaubskorrektur wurde eingetragen." });
      setEditUserId(null);
      fetchVacData();
    }
    setSavingAdjust(false);
  };

  const editRow = vacData.find(r => r.userId === editUserId);
  const editSaldo = editRow ? editRow.entitled - editRow.taken : 0;

  return (
    <section>
      <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
        <Calendar className="h-6 w-6" />
        Urlaubskonto
      </h2>
      <Card>
        <CardHeader>
          <CardTitle>Urlaubssaldo pro Mitarbeiter</CardTitle>
          <CardDescription>
            Guthaben aus Admin-Korrekturen (z.B. +25 Tage Jahresurlaub) • Verbrauch: Urlaubs-Einträge in der Zeiterfassung
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingVac ? (
            <p className="text-muted-foreground">Lädt Urlaubsdaten...</p>
          ) : vacData.length === 0 ? (
            <p className="text-muted-foreground">Keine aktiven Mitarbeiter</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 font-medium">Mitarbeiter</th>
                    <th className="text-right p-3 font-medium">Guthaben (Tage)</th>
                    <th className="text-right p-3 font-medium">Verbraucht (Tage)</th>
                    <th className="text-right p-3 font-medium">Saldo</th>
                    <th className="p-3 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {vacData.map(row => {
                    const saldo = row.entitled - row.taken;
                    return (
                      <tr key={row.userId} className="border-b">
                        <td className="p-3 font-medium">{row.name}</td>
                        <td className="p-3 text-right text-muted-foreground">{row.entitled.toFixed(0)}</td>
                        <td className="p-3 text-right text-muted-foreground">{row.taken}</td>
                        <td className={`p-3 text-right font-bold ${saldo < 0 ? 'text-destructive' : 'text-primary'}`}>
                          {saldo.toFixed(0)} Tage
                        </td>
                        <td className="p-3 text-right">
                          <Button variant="ghost" size="icon" onClick={() => openAdjustDialog(row.userId)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Vacation Adjustment Dialog */}
      <Dialog open={!!editUserId} onOpenChange={(open) => { if (!open) setEditUserId(null); }}>
        <DialogContent className="max-w-lg max-h-[85vh]">
          <DialogHeader>
            <DialogTitle>Urlaubskorrektur: {editRow?.name}</DialogTitle>
            <DialogDescription>
              Aktueller Saldo: <span className="font-bold">{editSaldo.toFixed(0)} Tage</span>
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-4 p-1">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Tage (+/-)</Label>
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder="z.B. +25 oder -2"
                    value={adjustDays}
                    onChange={(e) => setAdjustDays(e.target.value)}
                  />
                </div>
                <div className="col-span-2">
                  <Label>Grund (Pflicht)</Label>
                  <Textarea
                    placeholder="z.B. Jahresurlaub 2026"
                    value={adjustReason}
                    onChange={(e) => setAdjustReason(e.target.value)}
                    rows={2}
                  />
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setEditUserId(null)}>Abbrechen</Button>
                <Button onClick={handleSaveAdjustment} disabled={savingAdjust}>
                  {savingAdjust ? "Speichert..." : "Korrektur speichern"}
                </Button>
              </DialogFooter>

              {adjustHistory.length > 0 && (
                <div className="pt-2">
                  <Separator className="mb-3" />
                  <h4 className="font-semibold text-sm mb-2">Bisherige Korrekturen</h4>
                  <div className="space-y-2">
                    {adjustHistory.map(h => (
                      <div key={h.id} className="text-sm border rounded-md p-2 bg-muted/30">
                        <div className="flex justify-between">
                          <span className="font-medium">{h.days > 0 ? "+" : ""}{h.days.toFixed(0)} Tage</span>
                          <span className="text-muted-foreground text-xs">
                            {format(new Date(h.created_at), "dd.MM.yyyy HH:mm")}
                          </span>
                        </div>
                        <p className="text-muted-foreground">{h.reason}</p>
                        <p className="text-xs text-muted-foreground">von {h.admin_name}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </section>
  );
}
