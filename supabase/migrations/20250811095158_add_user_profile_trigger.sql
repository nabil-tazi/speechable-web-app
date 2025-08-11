-- Add profile_image_url column to existing users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS profile_image_url TEXT;

-- Create function to handle new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, display_name, profile_image_url)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create the trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill existing users who don't have profiles yet
INSERT INTO public.users (id, display_name, profile_image_url)
SELECT 
  au.id,
  au.raw_user_meta_data->>'full_name',
  au.raw_user_meta_data->>'avatar_url'
FROM auth.users au
LEFT JOIN public.users up ON au.id = up.id
WHERE up.id IS NULL
ON CONFLICT (id) DO NOTHING;