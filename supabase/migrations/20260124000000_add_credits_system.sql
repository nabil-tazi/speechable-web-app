-- Add credits system columns to users table
ALTER TABLE users
ADD COLUMN IF NOT EXISTS credits DECIMAL(10, 2) NOT NULL DEFAULT 10.00,
ADD COLUMN IF NOT EXISTS plan_started_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS next_refill_date TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '1 month'),
ADD COLUMN IF NOT EXISTS monthly_credit_allowance DECIMAL(10, 2) NOT NULL DEFAULT 10.00;

-- Create function to check and refill credits if due
CREATE OR REPLACE FUNCTION public.check_and_refill_credits(p_user_id UUID)
RETURNS TABLE(credits DECIMAL, was_refilled BOOLEAN, next_refill_date TIMESTAMPTZ) AS $$
DECLARE
  v_user RECORD;
  v_was_refilled BOOLEAN := FALSE;
BEGIN
  -- Lock the row to prevent concurrent refills
  SELECT u.credits, u.next_refill_date, u.monthly_credit_allowance
  INTO v_user
  FROM users u
  WHERE u.id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- Check if refill is due
  IF v_user.next_refill_date <= NOW() THEN
    -- Reset credits to monthly allowance (no rollover)
    UPDATE users
    SET
      credits = monthly_credit_allowance,
      next_refill_date = NOW() + INTERVAL '1 month'
    WHERE id = p_user_id;

    v_was_refilled := TRUE;

    -- Return updated values
    RETURN QUERY
    SELECT u.credits, v_was_refilled, u.next_refill_date
    FROM users u
    WHERE u.id = p_user_id;
  ELSE
    -- Return current values
    RETURN QUERY
    SELECT v_user.credits, v_was_refilled, v_user.next_refill_date;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create atomic credit deduction function
CREATE OR REPLACE FUNCTION public.deduct_credits(p_user_id UUID, p_amount DECIMAL)
RETURNS TABLE(success BOOLEAN, new_balance DECIMAL, error_message TEXT) AS $$
DECLARE
  v_current_credits DECIMAL;
  v_was_refilled BOOLEAN;
  v_next_refill TIMESTAMPTZ;
BEGIN
  -- First check and apply any due refill
  SELECT r.credits, r.was_refilled, r.next_refill_date
  INTO v_current_credits, v_was_refilled, v_next_refill
  FROM public.check_and_refill_credits(p_user_id) r;

  -- Check if user has sufficient credits
  IF v_current_credits < p_amount THEN
    RETURN QUERY SELECT FALSE, v_current_credits, 'Insufficient credits'::TEXT;
    RETURN;
  END IF;

  -- Deduct credits atomically
  UPDATE users
  SET credits = credits - p_amount
  WHERE id = p_user_id;

  -- Return success with new balance
  RETURN QUERY
  SELECT TRUE, (v_current_credits - p_amount), NULL::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update handle_new_user() to initialize credits for new signups
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (
    id,
    display_name,
    profile_image_url,
    credits,
    plan_started_at,
    next_refill_date,
    monthly_credit_allowance
  )
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url',
    10.00,  -- Default credits
    NOW(),
    NOW() + INTERVAL '1 month',
    10.00   -- Default monthly allowance
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Initialize credits for existing users who don't have them set
UPDATE users
SET
  credits = COALESCE(credits, 10.00),
  plan_started_at = COALESCE(plan_started_at, created_at),
  next_refill_date = COALESCE(next_refill_date, created_at + INTERVAL '1 month'),
  monthly_credit_allowance = COALESCE(monthly_credit_allowance, 10.00)
WHERE credits IS NULL
   OR plan_started_at IS NULL
   OR next_refill_date IS NULL
   OR monthly_credit_allowance IS NULL;
