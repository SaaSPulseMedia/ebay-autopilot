import { loginUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { email?: string; password?: string };
  const email = body.email?.trim() ?? "";
  const password = body.password ?? "";

  if (!email || !password) {
    return Response.json({ ok: false, error: "Email and password are required." }, { status: 400 });
  }

  try {
    const result = await loginUser(email, password);
    if (!result.ok) return Response.json(result, { status: 401 });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false, error: "Could not sign you in. Try again." }, { status: 500 });
  }
}
