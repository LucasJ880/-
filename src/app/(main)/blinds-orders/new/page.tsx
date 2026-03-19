"use client";

import { BlindsOrderForm } from "@/components/blinds-order-form";

export default function NewBlindsOrderPage() {
  return (
    <div className="mx-auto max-w-7xl p-6">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">新建工艺单</h1>
      <BlindsOrderForm />
    </div>
  );
}
