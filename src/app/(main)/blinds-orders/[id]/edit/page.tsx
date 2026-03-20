"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { BlindsOrderForm } from "@/components/blinds-order-form";
import { apiFetch } from "@/lib/api-fetch";

interface OrderData {
  id: string;
  code: string;
  status: string;
  customerName: string;
  phone: string | null;
  address: string | null;
  installDate: string | null;
  remarks: string | null;
  projectId: string | null;
  items: Array<{
    location: string;
    width: number;
    height: number;
    fabricSku: string;
    productType: string;
    measureType: string;
    controlType: string;
    controlSide: string;
    headrailType: string;
    mountType: string;
    fabricRatio: number | null;
    silkRatio: number | null;
    bottomBarWidth: number | null;
    itemRemark: string | null;
  }>;
}

export default function EditBlindsOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [order, setOrder] = useState<OrderData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch(`/api/blinds-orders/${id}`)
      .then((res) => res.json())
      .then((data) => {
        setOrder(data);
        setLoading(false);
      });
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-400">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-gray-500">工艺单不存在</p>
        <Link href="/blinds-orders" className="mt-4 text-blue-600 hover:underline">
          返回列表
        </Link>
      </div>
    );
  }

  const initialOrder = {
    code: order.code,
    customerName: order.customerName,
    phone: order.phone || "",
    address: order.address || "",
    installDate: order.installDate || "",
    remarks: order.remarks || "",
    projectId: order.projectId || "",
  };

  const initialItems = order.items.map((item) => ({
    key: crypto.randomUUID(),
    location: item.location,
    width: String(item.width),
    height: String(item.height),
    fabricSku: item.fabricSku,
    productType: item.productType,
    measureType: item.measureType,
    controlType: item.controlType,
    controlSide: item.controlSide,
    headrailType: item.headrailType,
    mountType: item.mountType,
    fabricRatio: item.fabricRatio != null ? String(item.fabricRatio) : "3",
    silkRatio: item.silkRatio != null ? String(item.silkRatio) : "2",
    bottomBarWidth: item.bottomBarWidth != null ? String(item.bottomBarWidth) : "",
    itemRemark: item.itemRemark || "",
  }));

  return (
    <div className="mx-auto max-w-7xl p-6">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">
        编辑工艺单 · {order.code}
      </h1>
      <BlindsOrderForm
        initialOrder={initialOrder}
        initialItems={initialItems}
        orderId={id}
        mode="edit"
        orderStatus={order.status}
      />
    </div>
  );
}
