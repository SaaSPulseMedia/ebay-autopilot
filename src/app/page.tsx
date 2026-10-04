import { BuiltFor } from "@/components/landing/BuiltFor";
import { BulkListing } from "@/components/landing/BulkListing";
import { CTA } from "@/components/landing/CTA";
import { FAQ } from "@/components/landing/FAQ";
import { Features } from "@/components/landing/Features";
import { Footer } from "@/components/landing/Footer";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { NoSetup } from "@/components/landing/NoSetup";
import { Nav } from "@/components/landing/Nav";
import { Pricing } from "@/components/landing/Pricing";
import { Screenshots } from "@/components/landing/Screenshots";
import { getCatalogStats } from "@/lib/suppliers";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const stats = await getCatalogStats();

  return (
    <>
      <Nav />
      <main>
        <Hero stats={stats} />
        <BulkListing />
        <Features />
        <HowItWorks />
        <NoSetup />
        <Screenshots />
        <BuiltFor stats={stats} />
        <Pricing />
        <FAQ />
        <CTA />
      </main>
      <Footer />
    </>
  );
}
