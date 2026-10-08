import { getCurrentUser } from "@/lib/auth";
import { publishListing } from "@/lib/ebay/inventory";

/**
 * TEMPORARY: publishes one test listing to the signed-in seller's connected
 * eBay store to verify the Sell API flow end to end. Delete after testing.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  // ?categoryId=… tries another category without a redeploy (see /api/admin/debug-category).
  const categoryId = new URL(request.url).searchParams.get("categoryId")?.trim() || "9355";

  const result = await publishListing({
    userId: user.id,
    sku: `autopilot-test-${Date.now()}`,
    title: "AutoPilot Sandbox Test — Do Not Buy",
    description: "Test listing created by AutoPilot to verify the eBay Sell API publish flow. Do not purchase.",
    imageUrls: ["https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/Example.jpg/640px-Example.jpg"],
    price: 9.99,
    quantity: 1,
    categoryId,
    brand: "AutoPilot",
    mpn: "TEST-SANDBOX-001",
    condition: "NEW",
    aspects: {
      Color: ["Black"],
    },
  });

  return Response.json(result);
}
