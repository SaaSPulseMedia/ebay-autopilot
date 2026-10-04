import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth/AuthForm";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const metadata = { title: "Log in" };

export default async function LoginPage() {
  const user = await getCurrentUser().catch(() => null);
  if (user) redirect("/dashboard");

  return (
    <main className="ap-grid-bg grid min-h-screen place-items-center px-5 py-16">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-6 flex items-center justify-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/mark.svg" alt="" width={34} height={34} className="h-[34px] w-[34px]" />
          <span className="text-[15px] font-bold tracking-tight text-white">AutoPilot</span>
        </Link>
        <AuthForm mode="login" />
      </div>
    </main>
  );
}
