import { Suspense } from "react";
import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Enter" };

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-5 py-10">
      <div className="space-y-2 text-center">
        <div className="text-4xl" aria-hidden>
          🏠
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Belfield Hunt</h1>
        <p className="text-muted-foreground text-sm">
          Private hub for our Dublin rental search. Use the same name each time so your claims and votes stay yours.
        </p>
      </div>
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
