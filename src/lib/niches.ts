/**
 * Product niches for the Winning page's "✨ Auto-Suggest Winners". Kept here
 * rather than read from CJ's category API, which isn't reliable enough to
 * build on. Each niche carries 5 generic, unbranded CJ search keywords used
 * when Claude can't suggest any.
 */
export const NICHES = [
  { name: "Home & Garden", fallback: ["led cloud light", "electric spin scrubber", "sunset lamp", "solar garden lights", "vacuum storage bags"] },
  { name: "Kitchen & Dining", fallback: ["silicone stretch lids", "vegetable chopper", "magnetic knife strip", "oil sprayer bottle", "reusable food storage bags"] },
  { name: "Pet Supplies", fallback: ["self cleaning cat brush", "dog slow feeder bowl", "pet hair remover roller", "cat window perch", "dog paw cleaner cup"] },
  { name: "Beauty & Personal Care", fallback: ["ice roller face", "scalp massager shampoo brush", "heatless hair curler", "makeup brush cleaner", "electric callus remover"] },
  { name: "Health & Fitness", fallback: ["resistance bands set", "posture corrector", "massage gun mini", "ab roller wheel", "yoga mat strap"] },
  { name: "Phone Accessories", fallback: ["magnetic car phone mount", "phone ring holder", "wireless charger stand", "phone tripod selfie stick", "waterproof phone pouch"] },
  { name: "Car Accessories", fallback: ["car seat gap filler", "car trash can", "car vacuum cleaner portable", "headrest hook organizer", "car sun shade windshield"] },
  { name: "Computer & Office", fallback: ["laptop stand adjustable", "desk cable organizer", "monitor riser shelf", "ergonomic mouse pad", "usb c hub"] },
  { name: "Toys & Games", fallback: ["fidget toy set", "magnetic building tiles", "bubble machine", "kids drawing tablet", "slime making kit"] },
  { name: "Baby & Kids", fallback: ["baby bath thermometer", "silicone baby bib", "toddler sippy cup", "baby nail trimmer electric", "kids night light"] },
  { name: "Sports & Outdoors", fallback: ["camping lantern rechargeable", "cooling towel", "collapsible water bottle", "jump rope weighted", "hammock straps"] },
  { name: "Tools & Home Improvement", fallback: ["magnetic wristband tool holder", "stud finder", "cordless screwdriver mini", "tape measure laser", "drill brush attachment"] },
  { name: "Jewelry & Watches", fallback: ["stainless steel chain necklace", "hoop earrings set", "watch band silicone", "ring set stackable", "jewelry organizer box"] },
  { name: "Bags & Luggage", fallback: ["packing cubes set", "crossbody phone bag", "luggage scale digital", "toiletry bag hanging", "waterproof dry bag"] },
] as const satisfies ReadonlyArray<{ name: string; fallback: readonly string[] }>;

export type NicheName = (typeof NICHES)[number]["name"];

export function findNiche(name: string) {
  return NICHES.find((n) => n.name === name) ?? null;
}
