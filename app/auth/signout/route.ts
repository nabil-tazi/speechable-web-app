import { createClient } from "@/app/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const supabase = await createClient();

  // Check if we have a session
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session) {
    await supabase.auth.signOut();
    revalidatePath("/", "layout");
  }

  return NextResponse.redirect(new URL("/", req.url), {
    status: 302,
  });
}
