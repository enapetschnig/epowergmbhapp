-- Add contact fields to projects for Regiebericht autofill
ALTER TABLE public.projects
ADD COLUMN IF NOT EXISTS kunde_name TEXT,
ADD COLUMN IF NOT EXISTS kunde_email TEXT,
ADD COLUMN IF NOT EXISTS kunde_telefon TEXT;
