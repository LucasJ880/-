import { PricingControlCenter } from "@/components/quote-engine/pricing-control-center";

export default async function QuoteEnginePage({ params }: { params: Promise<{ id: string; quoteId: string }> }) {
  const { id, quoteId } = await params;
  return <PricingControlCenter projectId={id} quoteId={quoteId} />;
}
