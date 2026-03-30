-- Only admin-verified phone numbers can use the WhatsApp bot
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS whatsapp_aktiv BOOLEAN DEFAULT false;

COMMENT ON COLUMN public.employees.whatsapp_aktiv IS 'Admin muss Telefonnummer für WhatsApp-Bot freischalten';
