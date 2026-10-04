import { registerUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    storeName?: string;
  };

  const email = body.email?.trim() ?? "";
  const password = body.password ?? "";

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return Response.json({ ok: false, error: "Enter a valid email address." }, { status: 400 });
  }
  if (password.length < 8) {
    return Response.json({ ok: false, error: "Password must be at least 8 characters." }, { status: 400 });
  }

  try {
    const result = await registerUser(email, password, body.storeName);
    if (!result.ok) return Response.json(result, { status: 409 });
    return Response.json({ ok: true });
  } catch (error) {
    console.error("SIGNUP_ERROR", error);
    return Response.json({ ok: false, error: "Could not create the account. Try again." }, { status: 500 });
  }
}
