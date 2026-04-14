export const SCENES = [
  { key: "all", label: "全部场景" },
  { key: "first_contact", label: "首次接触" },
  { key: "follow_up", label: "跟进回访" },
  { key: "price_objection", label: "价格异议" },
  { key: "product_intro", label: "产品介绍" },
  { key: "closing", label: "促单成交" },
  { key: "after_sale", label: "售后关怀" },
  { key: "upsell", label: "追加推荐" },
  { key: "measurement", label: "预约测量" },
  { key: "installation", label: "安装安排" },
];

export const CHANNELS = [
  { key: "all", label: "全部渠道" },
  { key: "wechat", label: "微信" },
  { key: "xiaohongshu", label: "小红书" },
  { key: "facebook", label: "Facebook" },
  { key: "email", label: "邮件" },
];

export const FAQ_CATEGORIES = [
  { key: "all", label: "全部分类" },
  { key: "product", label: "产品相关" },
  { key: "pricing", label: "价格相关" },
  { key: "installation", label: "安装相关" },
  { key: "warranty", label: "保修售后" },
  { key: "delivery", label: "交付物流" },
  { key: "process", label: "流程说明" },
  { key: "measurement", label: "测量相关" },
  { key: "other", label: "其他" },
];

export const CHANNEL_COLORS: Record<string, string> = {
  wechat: "bg-green-100 text-green-700",
  xiaohongshu: "bg-red-100 text-red-700",
  facebook: "bg-blue-100 text-blue-700",
  email: "bg-amber-100 text-amber-700",
  phone: "bg-purple-100 text-purple-700",
};
