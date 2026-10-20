-- Update handle_new_user() to save the full name collected at registration
-- into profiles.display_name, reading from the user_metadata supplied to
-- supabase.auth.signUp({ options: { data: { full_name } } }).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_name text;
BEGIN
  v_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, NULLIF(TRIM(v_name), ''));
  RETURN NEW;
END;
$$;
