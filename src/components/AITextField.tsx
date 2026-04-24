import { useState, useRef, useEffect } from "react";
import { Mic, Square, Sparkles, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface AITextFieldProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  required?: boolean;
  minHeight?: string;
  /** Zusätzlicher Kontext für die KI-Verbesserung (z.B. Projektname, Feldtyp) */
  aiContext?: string;
  /** Disable AI features (e.g. for email/phone inputs) */
  disableAI?: boolean;
  className?: string;
  id?: string;
  type?: string;
  inputMode?: "text" | "email" | "tel" | "numeric" | "decimal";
}

export const AITextField = ({
  label,
  value,
  onChange,
  placeholder,
  multiline = false,
  required = false,
  minHeight = "min-h-20",
  aiContext,
  disableAI = false,
  className,
  id,
  type,
  inputMode,
}: AITextFieldProps) => {
  const { toast } = useToast();
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [improving, setImproving] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        await transcribe(blob);
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setRecording(true);
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Mikrofon-Zugriff fehlgeschlagen",
        description: err?.message || "Bitte Berechtigung prüfen",
      });
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
  };

  const transcribe = async (blob: Blob) => {
    setTranscribing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Nicht angemeldet");

      const form = new FormData();
      form.append("audio", blob, "recording.webm");

      const supabaseUrl = (supabase as any).supabaseUrl || (import.meta as any).env?.VITE_SUPABASE_URL;
      const res = await fetch(`${supabaseUrl}/functions/v1/ai-text`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Transkription fehlgeschlagen");

      const newText = value ? `${value.trim()} ${data.text}` : data.text;
      onChange(newText);
      toast({ title: "Transkribiert", description: "Sprache wurde in Text umgewandelt" });
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Transkription fehlgeschlagen",
        description: err?.message || "Unbekannter Fehler",
      });
    } finally {
      setTranscribing(false);
    }
  };

  const improve = async () => {
    if (!value.trim()) {
      toast({ variant: "destructive", title: "Kein Text", description: "Bitte zuerst Text eingeben" });
      return;
    }
    setImproving(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-text", {
        body: { action: "improve", text: value, context: aiContext },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Verbesserung fehlgeschlagen");
      onChange(data.text);
      toast({ title: "Text verbessert", description: "KI hat den Text überarbeitet" });
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Verbesserung fehlgeschlagen",
        description: err?.message || "Unbekannter Fehler",
      });
    } finally {
      setImproving(false);
    }
  };

  const busy = recording || transcribing || improving;

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-center justify-between">
        {label && (
          <Label htmlFor={id} className="text-sm">
            {label}
            {required && <span className="text-destructive"> *</span>}
          </Label>
        )}
        {!disableAI && (
          <div className="flex gap-1">
            <Button
              type="button"
              variant={recording ? "destructive" : "ghost"}
              size="sm"
              className="h-7 px-2 gap-1 text-xs"
              onClick={recording ? stopRecording : startRecording}
              disabled={transcribing || improving}
              title={recording ? "Aufnahme stoppen" : "Sprachaufnahme starten"}
            >
              {transcribing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : recording ? (
                <Square className="h-3.5 w-3.5 fill-current" />
              ) : (
                <Mic className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">
                {transcribing ? "Wandle um…" : recording ? "Stopp" : "Sprechen"}
              </span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 gap-1 text-xs"
              onClick={improve}
              disabled={busy || !value.trim()}
              title="Text per KI verbessern"
            >
              {improving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">
                {improving ? "Verbessere…" : "Verbessern"}
              </span>
            </Button>
          </div>
        )}
      </div>
      {multiline ? (
        <Textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={minHeight}
          required={required}
        />
      ) : (
        <Input
          id={id}
          type={type}
          inputMode={inputMode}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
        />
      )}
    </div>
  );
};
