import { notFound } from "next/navigation";
import { Landing, VARIANTS, type Variant } from "../../landing";

// Design iterations, side by side: /v/stacked, /v/split, /v/paper.
export function generateStaticParams() {
  return VARIANTS.map((variant) => ({ variant }));
}

export default async function Page({ params }: { params: Promise<{ variant: string }> }) {
  const { variant } = await params;
  if (!VARIANTS.includes(variant as Variant)) notFound();
  return <Landing variant={variant as Variant} />;
}
